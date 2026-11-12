package mcpserver

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestSlowSSEReaderHasFiniteWriteAndCancellation(t *testing.T) {
	done := make(chan error, 1)
	cancelled := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithCancel(r.Context())
		defer cancel()
		writer := &privateWriter{ResponseWriter: w, stream: true, cancel: cancel}
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: {}\n\n"))
		writer.Flush()
		// More than the kernel's send window, without consuming the body client-side.
		_, err := writer.Write(bytes.Repeat([]byte("x"), 32<<20))
		done <- err
		if ctx.Err() != nil {
			close(cancelled)
		}
	}))
	defer server.Close()
	response, err := http.Get(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("slow reader accepted unbounded write")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("SSE write exceeded finite deadline")
	}
	select {
	case <-cancelled:
	case <-time.After(time.Second):
		t.Fatal("failed SSE write did not cancel listen")
	}
}
