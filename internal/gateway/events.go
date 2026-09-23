package gateway

import (
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"time"
)

const (
	heartbeatInterval = 15 * time.Second
	eventWriteTimeout = 10 * time.Second
)

func registerEventHandler(mux *http.ServeMux, bus Bus) {
	mux.HandleFunc(eventsRoute, func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming is unavailable", http.StatusInternalServerError)
			return
		}

		subscription, err := bus.Subscribe(parseLastEventID(r.Header.Get("Last-Event-ID")))
		if err != nil {
			http.Error(w, "event stream capacity reached", http.StatusServiceUnavailable)
			return
		}
		defer subscription.Close()

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("X-Accel-Buffering", "no")
		controller := http.NewResponseController(w)
		if err := controller.SetWriteDeadline(time.Now().Add(eventWriteTimeout)); err != nil {
			http.Error(w, "streaming deadlines are unavailable", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
		writer := deadlineWriter{writer: w, controller: controller}

		for _, event := range subscription.Replay {
			if err := writeEvent(writer, event); err != nil {
				return
			}
		}
		if err := writeSnapshot(writer, subscription.Snapshot); err != nil {
			return
		}
		flusher.Flush()

		heartbeat := time.NewTicker(heartbeatInterval)
		defer heartbeat.Stop()
		for {
			select {
			case <-r.Context().Done():
				return
			case <-heartbeat.C:
				if _, err := writer.Write([]byte(": keepalive\n\n")); err != nil {
					return
				}
				flusher.Flush()
			case event, open := <-subscription.Events:
				if !open {
					return
				}
				if err := writeEvent(writer, event); err != nil {
					return
				}
				flusher.Flush()
			}
		}
	})
}

func writeSnapshot(w io.Writer, snapshot Snapshot) error {
	status, ok := snapshot.Events["gateway_status"]
	if !ok {
		return fmt.Errorf("snapshot is missing gateway_status")
	}
	if err := writeEvent(w, Event{Data: status}); err != nil {
		return err
	}

	commands := make([]string, 0, len(snapshot.Events))
	for command := range snapshot.Events {
		if command != "gateway_status" {
			commands = append(commands, command)
		}
	}
	sort.Strings(commands)
	for _, command := range commands {
		if err := writeEvent(w, Event{Data: snapshot.Events[command]}); err != nil {
			return err
		}
	}
	return nil
}

type deadlineWriter struct {
	writer     io.Writer
	controller *http.ResponseController
}

func (w deadlineWriter) Write(data []byte) (int, error) {
	if err := w.controller.SetWriteDeadline(time.Now().Add(eventWriteTimeout)); err != nil {
		return 0, fmt.Errorf("setting event-stream write deadline: %w", err)
	}
	return w.writer.Write(data)
}

func writeEvent(w io.Writer, event Event) error {
	if event.ID != 0 {
		if _, err := fmt.Fprintf(w, "id: %d\n", event.ID); err != nil {
			return err
		}
	}
	_, err := fmt.Fprintf(w, "data: %s\n\n", event.Data)
	return err
}

func parseLastEventID(value string) *uint64 {
	if value == "" {
		return nil
	}
	id, err := strconv.ParseUint(value, 10, 64)
	if err != nil {
		return nil
	}
	return &id
}
