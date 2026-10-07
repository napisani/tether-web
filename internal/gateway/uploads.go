package gateway

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	maxUploadSize      = 256 << 20
	maxUploadChunk     = 48 << 10
	maxActiveUploads   = 2
	stagingIdleTimeout = 2 * time.Minute
	stagingSendTimeout = time.Hour
)

// MaxUploadChunk is the largest chunk of file bytes Append accepts.
const MaxUploadChunk = maxUploadChunk

// UploadError says why an upload operation was refused. Status is the HTTP
// status the browser adapter reports. NotForwarded means a Send request
// definitely never reached send_file; any other Send failure may be ambiguous
// and keeps the staged file until a result or expiry.
type UploadError struct {
	Status       int
	Message      string
	NotForwarded bool
}

func (e *UploadError) Error() string { return e.Message }

func uploadRefused(status int, message string) error {
	return &UploadError{Status: status, Message: message}
}

func uploadNotForwarded(status int, message string) error {
	return &UploadError{Status: status, Message: message, NotForwarded: true}
}

type stagedUpload struct {
	path         string
	dir          string
	file         *os.File
	size         int64
	written      int64
	nextChunk    int
	sending      bool
	timer        *time.Timer
	expiresAt    time.Time
	subscription Subscription
}

// Uploads stages bounded file bytes beside the daemon socket and forwards the
// existing send_file command. The browser and MCP clients share one instance so
// they share its quota and cleanup.
type Uploads struct {
	mu      sync.Mutex
	baseDir string
	uploads map[string]*stagedUpload
	bus     Bus
}

type uploadCommand struct {
	Command     string `json:"command"`
	OperationID string `json:"operation_id"`
	Filename    string `json:"filename"`
	Size        *int64 `json:"size"`
	ChunkIndex  *int   `json:"chunk_index"`
	Data        string `json:"data"`
}

func NewUploads(bus Bus, baseDir string) *Uploads {
	return &Uploads{bus: bus, baseDir: baseDir, uploads: make(map[string]*stagedUpload)}
}

// handle is the browser adapter: it decodes upload commands and reports typed
// results as HTTP statuses. The daemon remains responsible for file delivery.
func (s *Uploads) handle(ctx context.Context, raw json.RawMessage, command string) (int, error) {
	if command != "file_upload_start" && command != "file_upload_chunk" && command != "file_upload_finish" && command != "file_upload_cancel" {
		return 0, nil
	}
	var input uploadCommand
	if err := json.Unmarshal(raw, &input); err != nil || !validUploadID(input.OperationID) {
		return 400, errors.New("invalid file upload command")
	}
	var err error
	switch command {
	case "file_upload_start":
		if input.Size == nil {
			return 400, errors.New("invalid file name or size")
		}
		err = s.Start(input.OperationID, input.Filename, *input.Size)
	case "file_upload_chunk":
		data, decodeErr := base64.StdEncoding.DecodeString(input.Data)
		if decodeErr != nil {
			return 400, errors.New("invalid upload chunk")
		}
		index := -1
		if input.ChunkIndex != nil {
			index = *input.ChunkIndex
		}
		err = s.Append(input.OperationID, index, data)
	case "file_upload_finish":
		err = s.Send(ctx, input.OperationID)
	default:
		err = s.Cancel(input.OperationID)
	}
	if err == nil {
		return 202, nil
	}
	var refused *UploadError
	if errors.As(err, &refused) {
		return refused.Status, err
	}
	return 500, err
}

func validUploadID(id string) bool {
	if len(id) == 0 || len(id) > 128 || id == "." || id == ".." {
		return false
	}
	for _, ch := range id {
		if (ch < '0' || ch > '9') && (ch < 'A' || ch > 'Z') && (ch < 'a' || ch > 'z') && ch != '-' && ch != '_' && ch != '.' {
			return false
		}
	}
	return true
}

func validFilename(name string) bool {
	return name != "" && name != "." && name != ".." && len(name) <= 255 &&
		!strings.ContainsAny(name, "/\\\x00")
}

// Start begins staging a file of the declared size under the given upload ID.
func (s *Uploads) Start(id, filename string, size int64) error {
	if !validUploadID(id) {
		return uploadRefused(400, "invalid file upload command")
	}
	if !validFilename(filename) || size < 0 || size > maxUploadSize {
		return uploadRefused(400, "invalid file name or size")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.uploads[id]; exists {
		return uploadRefused(409, "upload already exists")
	}
	if len(s.uploads) >= maxActiveUploads {
		return uploadRefused(429, "too many active uploads")
	}
	if s.baseDir == "" || !s.bus.Ready() {
		return uploadRefused(503, "file staging or tetherd is unavailable")
	}
	s.reapStaleLocked()
	dir, err := os.MkdirTemp(s.baseDir, "tether-web-upload-")
	if err != nil {
		return uploadRefused(507, "could not create staging directory")
	}
	path := filepath.Join(dir, filename)
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		_ = os.RemoveAll(dir)
		return uploadRefused(507, "could not stage file")
	}
	upload := &stagedUpload{dir: dir, path: path, file: file, size: size, expiresAt: time.Now().Add(stagingIdleTimeout)}
	upload.timer = time.AfterFunc(stagingIdleTimeout, func() { s.expire(id, upload) })
	s.uploads[id] = upload
	return nil
}

// Append stages the next chunk. Chunks must arrive in order, starting at 0.
func (s *Uploads) Append(id string, index int, data []byte) error {
	if len(data) == 0 || len(data) > maxUploadChunk {
		return uploadRefused(400, "invalid upload chunk")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	upload := s.uploads[id]
	if upload == nil || upload.sending || index != upload.nextChunk || upload.written+int64(len(data)) > upload.size {
		return uploadRefused(409, "unexpected upload chunk")
	}
	if _, err := upload.file.Write(data); err != nil {
		s.cleanupLocked(id)
		return uploadRefused(507, "could not stage upload chunk")
	}
	upload.written += int64(len(data))
	upload.nextChunk++
	upload.expiresAt = time.Now().Add(stagingIdleTimeout)
	upload.timer.Reset(stagingIdleTimeout)
	return nil
}

// Send forwards the staged file to tetherd's send_file command. Success means
// the command was written, not that the file was delivered.
func (s *Uploads) Send(ctx context.Context, id string) error {
	s.mu.Lock()
	upload := s.uploads[id]
	if upload == nil || upload.sending {
		s.mu.Unlock()
		return uploadRefused(409, "upload is missing or already sending")
	}
	if upload.written != upload.size {
		s.mu.Unlock()
		return uploadNotForwarded(409, "upload is incomplete")
	}
	if err := upload.file.Close(); err != nil {
		s.cleanupLocked(id)
		s.mu.Unlock()
		return uploadNotForwarded(507, "could not finish staged file")
	}
	upload.file = nil
	upload.sending = true
	upload.expiresAt = time.Now().Add(stagingSendTimeout)
	upload.timer.Reset(stagingSendTimeout)
	s.mu.Unlock()

	// Subscribe before forwarding: even a fast send can complete before the HTTP
	// write returns. Only the matching daemon operation may release the file.
	subscription, err := s.bus.Subscribe(nil)
	if err != nil {
		s.cleanup(id)
		return uploadNotForwarded(503, "file result stream is unavailable")
	}
	s.mu.Lock()
	if s.uploads[id] != upload {
		s.mu.Unlock()
		subscription.Close()
		return uploadNotForwarded(503, "staged file expired")
	}
	upload.subscription = subscription
	s.mu.Unlock()
	go s.awaitResult(id, subscription.Events)
	command, _ := json.Marshal(map[string]string{"command": "send_file", "path": upload.path, "operation_id": id})
	if err := s.bus.Send(ctx, command); err != nil {
		// A failed write can be ambiguous: tetherd may already be reading the
		// file. Keep it until its terminal event or the bounded expiry.
		return uploadRefused(503, "tetherd did not confirm the send request")
	}
	return nil
}

func (s *Uploads) awaitResult(id string, events <-chan Event) {
	for event := range events {
		var result struct {
			Command     string `json:"command"`
			OperationID string `json:"operation_id"`
		}
		if json.Unmarshal(event.Data, &result) == nil && result.Command == "file_send_complete" && result.OperationID == id {
			s.cleanup(id)
			return
		}
	}
}

// Cancel discards an upload that has not been sent. Once forwarded, delivery
// cannot be recalled.
func (s *Uploads) Cancel(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if upload := s.uploads[id]; upload != nil && !upload.sending {
		s.cleanupLocked(id)
		return nil
	}
	return uploadRefused(409, fmt.Sprintf("upload %q cannot be cancelled", id))
}

func (s *Uploads) expire(id string, upload *stagedUpload) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.uploads[id] != upload {
		return
	}
	if remaining := time.Until(upload.expiresAt); remaining > 0 {
		upload.timer.Reset(remaining)
		return
	}
	s.cleanupLocked(id)
}

// A crashed gateway cannot run its timers. Reclaim only old private staging
// directories on the next upload; never touch the daemon's other runtime files.
func (s *Uploads) reapStaleLocked() {
	entries, err := os.ReadDir(s.baseDir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if !entry.IsDir() || !strings.HasPrefix(entry.Name(), "tether-web-upload-") {
			continue
		}
		dir := filepath.Join(s.baseDir, entry.Name())
		active := false
		for _, upload := range s.uploads {
			if upload.dir == dir {
				active = true
				break
			}
		}
		if active {
			continue
		}
		if info, err := entry.Info(); err == nil && time.Since(info.ModTime()) > stagingSendTimeout {
			_ = os.RemoveAll(dir)
		}
	}
}

func (s *Uploads) cleanup(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanupLocked(id)
}

func (s *Uploads) cleanupLocked(id string) {
	upload := s.uploads[id]
	if upload == nil {
		return
	}
	delete(s.uploads, id)
	upload.timer.Stop()
	if upload.file != nil {
		_ = upload.file.Close()
	}
	if upload.subscription.Close != nil {
		upload.subscription.Close()
	}
	_ = os.RemoveAll(upload.dir)
}
