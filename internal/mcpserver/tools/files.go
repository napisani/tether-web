package tools

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/napisani/tether-web/internal/gateway"
)

const (
	// Shorter than the gateway's staging expiry and the record retention, so a send
	// with no result becomes unknown before either of them lapses.
	sendFileTimeout = 50 * time.Minute
	uploadIDPrefix  = "mcp-upload-"
)

type beginUploadInput struct {
	Filename string `json:"filename" jsonschema:"File name only, without any directory; at most 255 bytes"`
	Size     int64  `json:"size" jsonschema:"Exact file size in bytes; at most 268435456"`
}

type beginUploadResult struct {
	UploadID      string `json:"upload_id"`
	MaxChunkBytes int    `json:"max_chunk_bytes"`
	Message       string `json:"message"`
}

type appendUploadInput struct {
	UploadID   string `json:"upload_id" jsonschema:"upload_id from begin_upload"`
	ChunkIndex int    `json:"chunk_index" jsonschema:"Zero-based chunk number; chunks must arrive in order"`
	Data       string `json:"data_base64" jsonschema:"Standard base64 of the next chunk of file bytes; at most 49152 bytes before encoding"`
}

type appendUploadResult struct {
	UploadID       string `json:"upload_id"`
	NextChunkIndex int    `json:"next_chunk_index"`
}

type uploadIDInput struct {
	UploadID string `json:"upload_id" jsonschema:"upload_id from begin_upload"`
}

func (t *Set) registerFileTools(server *mcp.Server) {
	notDestructive := false
	mcp.AddTool(server, &mcp.Tool{
		Name: "begin_upload",
		Description: "Start staging a file to send to a connected, paired Wi-Fi device. The agent supplies the file bytes; " +
			"server file paths are never used. Send chunks with append_upload, then call send_upload. tetherd chooses the " +
			"recipient, as in the web UI. Large files need many chunk calls, so this suits small files. Staging is shared " +
			"with the browser, which allows two active uploads, and an idle upload is discarded after two minutes.",
		Annotations: &mcp.ToolAnnotations{DestructiveHint: &notDestructive},
	}, t.beginUpload)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "append_upload",
		Description: "Stage the next chunk of an upload. Chunks are numbered from 0 and must arrive in order.",
		Annotations: &mcp.ToolAnnotations{DestructiveHint: &notDestructive},
	}, t.appendUpload)
	mcp.AddTool(server, &mcp.Tool{
		Name: "send_upload",
		Description: "Send a fully staged file. The result is correlated to this send, so correlated_success means tetherd " +
			"reported delivery. A pending or unknown outcome does not prove the file was not sent: check get_operation and the " +
			"receiving device before sending again.",
		Annotations: &mcp.ToolAnnotations{DestructiveHint: &notDestructive},
	}, t.sendUpload)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "cancel_upload",
		Description: "Discard an upload that has not been sent. Once sent, delivery cannot be recalled.",
		Annotations: &mcp.ToolAnnotations{DestructiveHint: &notDestructive},
	}, t.cancelUpload)
}

func (t *Set) filesReady() error { return t.featureReady("files") }

func (t *Set) requireUploads() error {
	if t.uploads == nil {
		return errors.New("file upload is not available on this server")
	}
	return nil
}

// ownUpload keeps agents from finishing or cancelling a browser's upload.
func ownUpload(id string) error {
	if !strings.HasPrefix(id, uploadIDPrefix) {
		return errors.New("unknown upload_id; use the one begin_upload returned")
	}
	return nil
}

func (t *Set) beginUpload(ctx context.Context, _ *mcp.CallToolRequest, input beginUploadInput) (*mcp.CallToolResult, beginUploadResult, error) {
	if err := t.requireUploads(); err != nil {
		return nil, beginUploadResult{}, err
	}
	if err := t.filesCapability(); err != nil {
		return nil, beginUploadResult{}, err
	}
	// Refuse before staging bytes when no paired device could receive them.
	peers, err := t.currentPeers(ctx)
	if err != nil {
		return nil, beginUploadResult{}, err
	}
	if !slices.ContainsFunc(peers.ConnectedClients, func(peer connectedPeer) bool { return peer.Paired }) {
		return nil, beginUploadResult{}, errors.New("no paired Wi-Fi device is connected; use list_peers")
	}
	id := uploadIDPrefix + rand.Text()
	if err := t.uploads.Start(id, input.Filename, input.Size); err != nil {
		return nil, beginUploadResult{}, err
	}
	return nil, beginUploadResult{UploadID: id, MaxChunkBytes: gateway.MaxUploadChunk,
		Message: "Append chunks from index 0, then call send_upload. The upload is discarded after two idle minutes."}, nil
}

func (t *Set) filesCapability() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.filesReady()
}

func (t *Set) appendUpload(_ context.Context, _ *mcp.CallToolRequest, input appendUploadInput) (*mcp.CallToolResult, appendUploadResult, error) {
	if err := t.requireUploads(); err != nil {
		return nil, appendUploadResult{}, err
	}
	if err := ownUpload(input.UploadID); err != nil {
		return nil, appendUploadResult{}, err
	}
	data, err := base64.StdEncoding.DecodeString(input.Data)
	if err != nil {
		return nil, appendUploadResult{}, errors.New("data_base64 must be standard base64")
	}
	if err := t.uploads.Append(input.UploadID, input.ChunkIndex, data); err != nil {
		return nil, appendUploadResult{}, err
	}
	return nil, appendUploadResult{UploadID: input.UploadID, NextChunkIndex: input.ChunkIndex + 1}, nil
}

func (t *Set) sendUpload(ctx context.Context, _ *mcp.CallToolRequest, input uploadIDInput) (*mcp.CallToolResult, operationResult, error) {
	if err := t.requireUploads(); err != nil {
		return nil, operationResult{}, err
	}
	if err := ownUpload(input.UploadID); err != nil {
		return nil, operationResult{}, err
	}
	result, err := t.dispatch(ctx, action{
		id: input.UploadID, subject: "file", timeout: sendFileTimeout, ready: t.filesReady,
		deliver: func(ctx context.Context) error { return t.uploads.Send(ctx, input.UploadID) },
		start: func(id string) (any, observer) {
			return nil, func(event gateway.Event, name string) (observation, bool) {
				var reply struct {
					OperationID string `json:"operation_id"`
					Success     *bool  `json:"success"`
					Message     string `json:"message"`
				}
				if name != "file_send_complete" || json.Unmarshal(event.Data, &reply) != nil || reply.OperationID != id || reply.Success == nil {
					return observation{}, false
				}
				if *reply.Success {
					return observation{status: statusSuccess, message: reply.Message}, true
				}
				return observation{status: statusFailure, message: reply.Message}, true
			}
		},
	})
	return nil, result, err
}

func (t *Set) cancelUpload(_ context.Context, _ *mcp.CallToolRequest, input uploadIDInput) (*mcp.CallToolResult, operationResult, error) {
	if err := t.requireUploads(); err != nil {
		return nil, operationResult{}, err
	}
	if err := ownUpload(input.UploadID); err != nil {
		return nil, operationResult{}, err
	}
	if err := t.uploads.Cancel(input.UploadID); err != nil {
		return nil, operationResult{}, err
	}
	return nil, operationResult{Status: statusCancelled, Message: "Upload discarded; nothing was sent.", ExpiresAt: time.Now()}, nil
}
