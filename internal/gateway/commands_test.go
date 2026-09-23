package gateway_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/napisani/tether-web/internal/gateway"
)

func TestCommandEndpointRequiresExactJSONMediaType(t *testing.T) {
	for _, contentType := range []string{"application/jsonp", "text/plain", "application/json nonsense"} {
		t.Run(contentType, func(t *testing.T) {
			bus := &fakeBus{ready: true}
			handler := gateway.NewHandler(bus, testAssets(), gateway.Config{})
			req := httptest.NewRequest(http.MethodPost, "http://tether.test/api/v1/commands", strings.NewReader(`{"command":"bt_scan"}`))
			req.Header.Set("Content-Type", contentType)
			response := httptest.NewRecorder()

			handler.ServeHTTP(response, req)

			if response.Code != http.StatusUnsupportedMediaType {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusUnsupportedMediaType)
			}
			if response.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("Cache-Control = %q", response.Header().Get("Cache-Control"))
			}
		})
	}
}

func TestCommandEndpointRejectsTrailingJSON(t *testing.T) {
	bus := &fakeBus{ready: true}
	handler := gateway.NewHandler(bus, testAssets(), gateway.Config{})
	req := httptest.NewRequest(http.MethodPost, "http://tether.test/api/v1/commands", strings.NewReader(`{"command":"bt_scan"} {"command":"bt_unpair"}`))
	req.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, req)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusBadRequest, response.Body.String())
	}
	if len(bus.commands) != 0 {
		t.Fatalf("forwarded commands = %q, want none", bus.commands)
	}
}

func TestCommandEndpointForwardsDaemonCommand(t *testing.T) {
	bus := &fakeBus{ready: true}
	handler := gateway.NewHandler(bus, testAssets(), gateway.Config{AllowedHosts: []string{"tether.test"}})
	req := httptest.NewRequest(http.MethodPost, "http://tether.test/api/v1/commands", strings.NewReader(`{"command":"bt_scan"}`))
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, req)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusAccepted, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("Cache-Control = %q", response.Header().Get("Cache-Control"))
	}
	if len(bus.commands) != 1 || string(bus.commands[0]) != `{"command":"bt_scan"}` {
		t.Fatalf("forwarded commands = %q", bus.commands)
	}
}
