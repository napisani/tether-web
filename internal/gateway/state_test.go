package gateway_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/napisani/tether-web/internal/gateway"
)

func TestStateEndpointExposesDaemonSnapshot(t *testing.T) {
	bus := &fakeBus{
		ready: true,
		snapshot: gateway.Snapshot{
			DaemonConnected: true,
			Events: map[string]json.RawMessage{
				"gateway_status": json.RawMessage(`{"command":"gateway_status","daemon_connected":true}`),
				"bt_status":      json.RawMessage(`{"command":"bt_status","available":true}`),
			},
		},
	}
	handler := gateway.NewHandler(bus, testAssets(), gateway.Config{})
	request := httptest.NewRequest(http.MethodGet, "http://tether.test/api/v1/state", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d; body = %s", response.Code, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("Cache-Control = %q", response.Header().Get("Cache-Control"))
	}
	if got := response.Body.String(); got != "{\"daemon_connected\":true,\"events\":{\"bt_status\":{\"command\":\"bt_status\",\"available\":true},\"gateway_status\":{\"command\":\"gateway_status\",\"daemon_connected\":true}}}\n" {
		t.Fatalf("state = %s", got)
	}
}
