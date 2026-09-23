package gateway_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/napisani/tether-web/internal/gateway"
)

func TestCommandEndpointRejectsUntrustedBrowserRequests(t *testing.T) {
	for _, test := range []struct {
		name       string
		host       string
		origin     string
		fetchSite  string
		wantStatus int
	}{
		{name: "unknown host", host: "attacker.test", wantStatus: http.StatusMisdirectedRequest},
		{name: "cross origin", host: "tether.test", origin: "https://attacker.test", wantStatus: http.StatusForbidden},
		{name: "cross site", host: "tether.test", fetchSite: "cross-site", wantStatus: http.StatusForbidden},
		{name: "same origin", host: "tether.test", origin: "https://tether.test", fetchSite: "same-origin", wantStatus: http.StatusAccepted},
	} {
		t.Run(test.name, func(t *testing.T) {
			bus := &fakeBus{ready: true}
			handler := gateway.NewHandler(bus, testAssets(), gateway.Config{AllowedHosts: []string{"tether.test"}})
			req := httptest.NewRequest(http.MethodPost, "http://"+test.host+"/api/v1/commands", strings.NewReader(`{"command":"bt_scan"}`))
			req.Header.Set("Content-Type", "application/json")
			if test.origin != "" {
				req.Header.Set("Origin", test.origin)
			}
			if test.fetchSite != "" {
				req.Header.Set("Sec-Fetch-Site", test.fetchSite)
			}
			response := httptest.NewRecorder()

			handler.ServeHTTP(response, req)

			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d; body = %s", response.Code, test.wantStatus, response.Body.String())
			}
		})
	}
}

func TestHandlerSetsBrowserSecurityHeaders(t *testing.T) {
	handler := gateway.NewHandler(&fakeBus{}, testAssets(), gateway.Config{})
	request := httptest.NewRequest(http.MethodGet, "http://tether.test/", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Header().Get("Content-Security-Policy") == "" || response.Header().Get("X-Frame-Options") != "DENY" {
		t.Fatalf("security headers = %#v", response.Header())
	}
}
