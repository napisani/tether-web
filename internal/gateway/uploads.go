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

// uploadNotForwardedError means this finish request never reached send_file.
// Other failures may be ambiguous and must retain staging until a result or expiry.
type uploadNotForwardedError string

func (e uploadNotForwardedError) Error() string { return string(e) }

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

type uploadStore struct {
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

func newUploadStore(bus Bus, baseDir string) *uploadStore {
	return &uploadStore{bus: bus, baseDir: baseDir, uploads: make(map[string]*stagedUpload)}
}

// handle stages transport bytes locally, then forwards the existing daemon
// send_file command. The daemon remains responsible for file delivery.
func (s *uploadStore) handle(ctx context.Context, raw json.RawMessage, command string) (int, error) {
	if command != "file_upload_start" && command != "file_upload_chunk" && command != "file_upload_finish" && command != "file_upload_cancel" {
		return 0, nil
	}
	var input uploadCommand
	if err := json.Unmarshal(raw, &input); err != nil || !validUploadID(input.OperationID) {
		return 400, errors.New("invalid file upload command")
	}
	switch command {
	case "file_upload_start":
		return s.start(input)
	case "file_upload_chunk":
		return s.chunk(input)
	case "file_upload_finish":
		return s.finish(ctx, input.OperationID)
	default:
		return s.cancel(input.OperationID)
	}
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

func (s *uploadStore) start(input uploadCommand) (int, error) {
	if !validFilename(input.Filename) || input.Size == nil || *input.Size < 0 || *input.Size > maxUploadSize {
		return 400, errors.New("invalid file name or size")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.uploads[input.OperationID]; exists {
		return 409, errors.New("upload already exists")
	}
	if len(s.uploads) >= maxActiveUploads {
		return 429, errors.New("too many active uploads")
	}
	if s.baseDir == "" || !s.bus.Ready() {
		return 503, errors.New("file staging or tetherd is unavailable")
	}
	s.reapStaleLocked()
	dir, err := os.MkdirTemp(s.baseDir, "tether-web-upload-")
	if err != nil {
		return 507, errors.New("could not create staging directory")
	}
	path := filepath.Join(dir, input.Filename)
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		_ = os.RemoveAll(dir)
		return 507, errors.New("could not stage file")
	}
	upload := &stagedUpload{dir: dir, path: path, file: file, size: *input.Size, expiresAt: time.Now().Add(stagingIdleTimeout)}
	upload.timer = time.AfterFunc(stagingIdleTimeout, func() { s.expire(input.OperationID, upload) })
	s.uploads[input.OperationID] = upload
	return 202, nil
}

func (s *uploadStore) chunk(input uploadCommand) (int, error) {
	data, err := base64.StdEncoding.DecodeString(input.Data)
	if err != nil || len(data) == 0 || len(data) > maxUploadChunk {
		return 400, errors.New("invalid upload chunk")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	upload := s.uploads[input.OperationID]
	if upload == nil || upload.sending || input.ChunkIndex == nil || *input.ChunkIndex != upload.nextChunk || upload.written+int64(len(data)) > upload.size {
		return 409, errors.New("unexpected upload chunk")
	}
	if _, err := upload.file.Write(data); err != nil {
		s.cleanupLocked(input.OperationID)
		return 507, errors.New("could not stage upload chunk")
	}
	upload.written += int64(len(data))
	upload.nextChunk++
	upload.expiresAt = time.Now().Add(stagingIdleTimeout)
	upload.timer.Reset(stagingIdleTimeout)
	return 202, nil
}

func (s *uploadStore) finish(ctx context.Context, id string) (int, error) {
	s.mu.Lock()
	upload := s.uploads[id]
	if upload == nil || upload.sending {
		s.mu.Unlock()
		return 409, errors.New("upload is missing or already sending")
	}
	if upload.written != upload.size {
		s.mu.Unlock()
		return 409, uploadNotForwardedError("upload is incomplete")
	}
	if err := upload.file.Close(); err != nil {
		s.cleanupLocked(id)
		s.mu.Unlock()
		return 507, uploadNotForwardedError("could not finish staged file")
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
		return 503, uploadNotForwardedError("file result stream is unavailable")
	}
	s.mu.Lock()
	if s.uploads[id] != upload {
		s.mu.Unlock()
		subscription.Close()
		return 503, uploadNotForwardedError("staged file expired")
	}
	upload.subscription = subscription
	s.mu.Unlock()
	go s.awaitResult(id, subscription.Events)
	command, _ := json.Marshal(map[string]string{"command": "send_file", "path": upload.path, "operation_id": id})
	if err := s.bus.Send(ctx, command); err != nil {
		// A failed write can be ambiguous: tetherd may already be reading the
		// file. Keep it until its terminal event or the bounded expiry.
		return 503, errors.New("tetherd did not confirm the send request")
	}
	return 202, nil
}

func (s *uploadStore) awaitResult(id string, events <-chan Event) {
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

func (s *uploadStore) cancel(id string) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if upload := s.uploads[id]; upload != nil && !upload.sending {
		s.cleanupLocked(id)
		return 202, nil
	}
	return 409, fmt.Errorf("upload %q cannot be cancelled", id)
}

func (s *uploadStore) expire(id string, upload *stagedUpload) {
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
func (s *uploadStore) reapStaleLocked() {
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

func (s *uploadStore) cleanup(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanupLocked(id)
}

func (s *uploadStore) cleanupLocked(id string) {
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
