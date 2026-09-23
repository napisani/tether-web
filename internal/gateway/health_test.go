package gateway_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/napisani/tether-web/internal/gateway"
)

func TestReadinessExposesDaemonConnection(t *testing.T) {
	handler := gateway.NewHandler(&fakeBus{ready: true}, testAssets(), gateway.Config{})
	request := httptest.NewRequest(http.MethodGet, "http://tether.test/readyz", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d; body = %s", response.Code, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("Cache-Control = %q", response.Header().Get("Cache-Control"))
	}
}
