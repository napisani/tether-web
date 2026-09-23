package gateway

import (
	"encoding/json"
	"net/http"
)

func registerStateHandler(mux *http.ServeMux, bus Bus) {
	mux.HandleFunc(stateRoute, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(bus.Snapshot())
	})
}
