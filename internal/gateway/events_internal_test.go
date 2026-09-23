package gateway

import (
	"bytes"
	"net/http"
	"testing"
	"time"
)

type deadlineResponseWriter struct {
	bytes.Buffer
	header    http.Header
	deadlines []time.Time
}

func (w *deadlineResponseWriter) Header() http.Header {
	if w.header == nil {
		w.header = make(http.Header)
	}
	return w.header
}

func (w *deadlineResponseWriter) WriteHeader(_ int) {}

func (w *deadlineResponseWriter) SetWriteDeadline(deadline time.Time) error {
	w.deadlines = append(w.deadlines, deadline)
	return nil
}

func TestDeadlineWriterBoundsEveryEventWrite(t *testing.T) {
	response := &deadlineResponseWriter{}
	writer := deadlineWriter{writer: response, controller: http.NewResponseController(response)}

	if err := writeEvent(writer, Event{ID: 7, Data: []byte(`{"command":"bt_status"}`)}); err != nil {
		t.Fatal(err)
	}
	if len(response.deadlines) < 2 {
		t.Fatalf("write deadlines = %d, want one for each event write", len(response.deadlines))
	}
	for _, deadline := range response.deadlines {
		if time.Until(deadline) <= 0 || time.Until(deadline) > eventWriteTimeout {
			t.Fatalf("write deadline %v is outside the expected window", deadline)
		}
	}
}
