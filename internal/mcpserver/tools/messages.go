package tools

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/napisani/tether-web/internal/gateway"
)

const (
	messageResultTimeout = 60 * time.Second
	maxRequestKeyBytes   = 128
	maxThreadIDBytes     = 1024
	maxBodyBytes         = 64 << 10
)

type sendMessageInput struct {
	InstanceID string `json:"instance_id" jsonschema:"Current instance_id from get_status; prevents replay across server restart"`
	RequestKey string `json:"request_key" jsonschema:"Unique caller-generated key for this exact send; reuse only to check a retry within the record retention period"`
	ThreadID   string `json:"thread_id" jsonschema:"Exact daemon thread ID or tel:/email: recipient identifier, not a contact display name"`
	Body       string `json:"body" jsonschema:"Message text to send"`
}

func (t *Set) registerMessageTools(server *mcp.Server) {
	notDestructive := false
	mcp.AddTool(server, &mcp.Tool{
		Name: "send_message",
		Description: "Send a message or reply through the connected iPhone. " +
			"Returns a tracked operation, not a delivery guarantee. Use get_operation to check it. " +
			"Do not automatically resend after an unknown outcome. Request-key protection lasts " + retentionText + ".",
		Annotations: &mcp.ToolAnnotations{DestructiveHint: &notDestructive},
	}, t.sendMessage)
}

func (t *Set) sendMessage(ctx context.Context, _ *mcp.CallToolRequest, input sendMessageInput) (*mcp.CallToolResult, operationResult, error) {
	if err := ctx.Err(); err != nil {
		return nil, operationResult{}, err
	}
	if strings.TrimSpace(input.RequestKey) == "" || len(input.RequestKey) > maxRequestKeyBytes ||
		strings.TrimSpace(input.ThreadID) == "" || len(input.ThreadID) > maxThreadIDBytes ||
		strings.TrimSpace(input.Body) == "" || len(input.Body) > maxBodyBytes {
		return nil, operationResult{}, fmt.Errorf("nonempty request_key, thread_id and body are required; limits are %d, %d and %d bytes",
			maxRequestKeyBytes, maxThreadIDBytes, maxBodyBytes)
	}
	encoded, err := json.Marshal(input)
	if err != nil {
		return nil, operationResult{}, err
	}
	inputHash := sha256.Sum256(encoded)
	now := time.Now()
	t.mu.Lock()
	t.expireOperations(now)
	if input.InstanceID != t.instanceID {
		t.mu.Unlock()
		return nil, operationResult{}, errors.New("server instance changed; check get_status and the iPhone before issuing a new send")
	}
	if id, exists := t.requestKeys[input.RequestKey]; exists {
		op := t.operations[id]
		if op.inputHash != inputHash {
			t.mu.Unlock()
			return nil, operationResult{}, errors.New("request_key already belongs to a different message")
		}
		result := op.result
		t.mu.Unlock()
		return nil, result, nil
	}
	if !t.currentConnection() || t.protocol == nil || !slices.Contains(t.protocol.Capabilities, "messages") ||
		t.connection == nil || !t.connection.MAPOpen {
		t.mu.Unlock()
		return nil, operationResult{}, errors.New("messaging unavailable; inspect get_status for daemon capabilities and phone permissions")
	}
	if len(t.operations) >= maxOperationRecords {
		t.mu.Unlock()
		return nil, operationResult{}, errors.New("message operation capacity reached; no message was dispatched")
	}
	id := "mcp-" + rand.Text()
	op := &operation{
		result:     operationResult{OperationID: id, Status: statusPending, ExpiresAt: now.Add(operationRetention)},
		requestKey: input.RequestKey, inputHash: inputHash,
		threadHash: sha256.Sum256([]byte(input.ThreadID)), deadline: now.Add(messageResultTimeout),
	}
	t.operations[id] = op
	t.requestKeys[input.RequestKey] = id
	t.mu.Unlock()

	command, err := json.Marshal(sendMessageCommand{
		Command: "bt_send_message", Thread: input.ThreadID, Body: input.Body, OperationID: id,
	})
	if err != nil {
		return nil, operationResult{}, err
	}
	writeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	sendErr := t.bus.Send(writeCtx, command)

	t.mu.Lock()
	defer t.mu.Unlock()
	// A daemon result can arrive before the socket write returns.
	if sendErr != nil && op.result.Status == statusPending {
		op.result.Status = statusUnknown
		op.result.Message = "Could not confirm the send request; check the iPhone before retrying."
	}
	return nil, op.result, nil
}

func (t *Set) applyMessageResult(event gateway.Event) {
	var input struct {
		OperationID string `json:"operation_id"`
		Thread      string `json:"thread"`
		Success     *bool  `json:"success"`
		Message     string `json:"message"`
	}
	if json.Unmarshal(event.Data, &input) != nil || input.Success == nil || input.OperationID == "" || input.Thread == "" {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.isClosed || !t.isConnected || event.Generation != t.generation {
		return
	}
	op := t.operations[input.OperationID]
	if op == nil || op.threadHash != sha256.Sum256([]byte(input.Thread)) ||
		(op.result.Status != statusPending && op.result.Status != statusUnknown) {
		return
	}
	op.result.Status = statusFailure
	if *input.Success {
		op.result.Status = statusSuccess
	}
	op.result.Message = boundedText(input.Message, 1024)
}
