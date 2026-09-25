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

func TestAuthenticatedGatewayProtectsCommandsAndPrivateEvents(t *testing.T) {
	bus := &fakeBus{ready: true}
	handler := gateway.NewHandler(bus, testAssets(), gateway.Config{Auth: &gateway.BasicCredentials{
		Username: "owner", Password: "a-long-private-password",
	}})
	for _, path := range []string{"/", "/api/v1/state", "/api/v1/events"} {
		request := httptest.NewRequest(http.MethodGet, "http://localhost"+path, nil)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusUnauthorized || response.Header().Get("WWW-Authenticate") == "" {
			t.Fatalf("%s: status = %d, challenge = %q", path, response.Code, response.Header().Get("WWW-Authenticate"))
		}
	}
	for _, test := range []struct {
		name     string
		username string
		password string
		status   int
	}{
		{name: "anonymous", status: http.StatusUnauthorized},
		{name: "bad password", username: "owner", password: "bad-password", status: http.StatusUnauthorized},
		{name: "valid", username: "owner", password: "a-long-private-password", status: http.StatusAccepted},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "http://localhost/api/v1/commands",
				strings.NewReader(`{"command":"bt_call_dial","number":"+15550100"}`))
			request.Header.Set("Content-Type", "application/json")
			if test.username != "" {
				request.SetBasicAuth(test.username, test.password)
			}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != test.status {
				t.Fatalf("status = %d, want %d", response.Code, test.status)
			}
		})
	}
	if len(bus.commands) != 1 {
		t.Fatalf("forwarded commands = %d, want 1", len(bus.commands))
	}
	for _, path := range []string{"/healthz", "/readyz"} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "http://localhost"+path, nil))
		if response.Code == http.StatusUnauthorized {
			t.Fatalf("%s requires browser credentials", path)
		}
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
