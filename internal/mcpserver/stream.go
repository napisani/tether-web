package mcpserver

import (
	"context"
	"fmt"
	"github.com/napisani/tether-web/internal/mcpserver/tools"
	"net/http"
	"sync"
	"time"
)

const listenKeepaliveInterval = 15 * time.Second
const listenWriteTimeout = 2 * time.Second

func validateChangeURI(uri string) error {
	if uri != tools.MessagesChangesURI && uri != tools.CallsChangesURI {
		return fmt.Errorf("unknown change resource")
	}
	return nil
}

// The SDK sets its own cache headers. Protect no-store at the commit point.
// Serialize SSE comments with SDK writes, and bound every socket write/flush.
// No sensitive content or arbitrary JSON-RPC notifications originate here.
type privateWriter struct {
	http.ResponseWriter
	mu        sync.Mutex
	committed bool
	stream    bool
	cancel    context.CancelFunc
	ready     chan struct{}
	readyOnce sync.Once
}

func (w *privateWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (w *privateWriter) commit() {
	if w.committed {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	if w.Header().Get("Content-Type") == "text/event-stream" {
		w.Header().Set("X-Accel-Buffering", "no")
	}
	w.committed = true
}
func (w *privateWriter) deadline() {
	if w.stream {
		_ = http.NewResponseController(w.ResponseWriter).SetWriteDeadline(time.Now().Add(listenWriteTimeout))
	}
}
func (w *privateWriter) clearDeadline() {
	if w.stream {
		_ = http.NewResponseController(w.ResponseWriter).SetWriteDeadline(time.Time{})
	}
}
func (w *privateWriter) fail(err error) {
	if err != nil && w.cancel != nil {
		w.cancel()
	}
}
func (w *privateWriter) WriteHeader(status int) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.commit()
	w.deadline()
	defer w.clearDeadline()
	w.ResponseWriter.WriteHeader(status)
}
func (w *privateWriter) Write(data []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.commit()
	w.deadline()
	defer w.clearDeadline()
	n, err := w.ResponseWriter.Write(data)
	w.fail(err)
	return n, err
}
func (w *privateWriter) Flush() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.commit()
	w.deadline()
	defer w.clearDeadline()
	err := http.NewResponseController(w.ResponseWriter).Flush()
	w.fail(err)
	if w.ready != nil {
		w.readyOnce.Do(func() { close(w.ready) })
	}
}
func (w *privateWriter) keepalive(ctx context.Context) {
	select {
	case <-ctx.Done():
		return
	case <-w.ready:
	}
	ticker := time.NewTicker(listenKeepaliveInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		w.mu.Lock()
		w.deadline()
		_, err := w.ResponseWriter.Write([]byte(": keepalive\n\n"))
		if err == nil {
			err = http.NewResponseController(w.ResponseWriter).Flush()
		}
		w.clearDeadline()
		w.mu.Unlock()
		if err != nil {
			w.fail(err)
			return
		}
	}
}
