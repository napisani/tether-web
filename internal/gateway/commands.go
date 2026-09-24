package gateway

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"
)

var (
	errInvalidJSON      = errors.New("invalid JSON command")
	errMultipleCommands = errors.New("request must contain one JSON command")
	errCommandRequired  = errors.New("command is required")
)

func registerCommandHandler(mux *http.ServeMux, bus Bus, uploads *uploadStore) {
	mux.HandleFunc(commandsRoute, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || !strings.EqualFold(mediaType, "application/json") {
			http.Error(w, "Content-Type must be application/json", http.StatusUnsupportedMediaType)
			return
		}

		command, err := decodeCommand(w, r)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		var envelope struct {
			Command string `json:"command"`
		}
		_ = json.Unmarshal(command, &envelope)
		if status, err := uploads.handle(r.Context(), command, envelope.Command); status != 0 {
			if _, notForwarded := err.(uploadNotForwardedError); notForwarded {
				w.Header().Set("X-Tether-Upload-Outcome", "not-forwarded")
			}
			if err != nil {
				http.Error(w, err.Error(), status)
			} else {
				w.WriteHeader(status)
			}
			return
		}
		if err := bus.Send(r.Context(), command); err != nil {
			http.Error(w, "tetherd is unavailable", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusAccepted)
	})
}

func decodeCommand(w http.ResponseWriter, r *http.Request) (json.RawMessage, error) {
	var command json.RawMessage
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxCommandBytes))
	if err := decoder.Decode(&command); err != nil {
		return nil, errInvalidJSON
	}
	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); err != io.EOF {
		return nil, errMultipleCommands
	}
	var envelope struct {
		Command string `json:"command"`
	}
	if err := json.Unmarshal(command, &envelope); err != nil || envelope.Command == "" {
		return nil, errCommandRequired
	}
	return command, nil
}
