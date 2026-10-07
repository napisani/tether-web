package gateway_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/napisani/tether-web/internal/gateway"
)

func TestMCPMountIsOptIn(t *testing.T) {
	t.Parallel()
	for _, enabled := range []bool{false, true} {
		var mounted http.Handler
		if enabled {
			mounted = http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
		}
		handler := gateway.NewHandler(&fakeBus{}, testAssets(), gateway.Config{MCPHandler: mounted})
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "http://localhost/mcp", nil))
		want := http.StatusNotFound
		if enabled {
			want = http.StatusNoContent
		}
		if response.Code != want {
			t.Fatalf("enabled=%v, status=%d, want=%d", enabled, response.Code, want)
		}
	}
}

func TestMCPMountInheritsAuthenticationAndOriginProtection(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name       string
		method     string
		host       string
		origin     string
		fetchSite  string
		authorized bool
		status     int
	}{
		{name: "anonymous", method: http.MethodPost, host: "tether.test", status: http.StatusUnauthorized},
		{name: "unrecognized host", method: http.MethodPost, host: "evil.test", authorized: true, status: http.StatusMisdirectedRequest},
		{name: "cross origin post", method: http.MethodPost, host: "tether.test", origin: "https://evil.test", authorized: true, status: http.StatusForbidden},
		{name: "cross origin get", method: http.MethodGet, host: "tether.test", origin: "https://evil.test", authorized: true, status: http.StatusForbidden},
		{name: "cross origin delete", method: http.MethodDelete, host: "tether.test", origin: "https://evil.test", authorized: true, status: http.StatusForbidden},
		{name: "cross site get", method: http.MethodGet, host: "tether.test", fetchSite: "cross-site", authorized: true, status: http.StatusForbidden},
		{name: "null origin", method: http.MethodPost, host: "tether.test", origin: "null", authorized: true, status: http.StatusForbidden},
		{name: "agent without origin", method: http.MethodPost, host: "tether.test", authorized: true, status: http.StatusNoContent},
		{name: "same origin", method: http.MethodPost, host: "tether.test", origin: "https://tether.test", authorized: true, status: http.StatusNoContent},
	} {
		t.Run(test.name, func(t *testing.T) {
			called := false
			handler := gateway.NewHandler(&fakeBus{}, testAssets(), gateway.Config{
				AllowedHosts: []string{"tether.test"},
				Auth:         &gateway.BasicCredentials{Username: "owner", Password: "a-long-private-password"},
				MCPHandler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
					called = true
					w.WriteHeader(http.StatusNoContent)
				}),
			})
			request := httptest.NewRequest(test.method, "http://"+test.host+"/mcp", nil)
			if test.authorized {
				request.SetBasicAuth("owner", "a-long-private-password")
			}
			request.Header.Set("Origin", test.origin)
			request.Header.Set("Sec-Fetch-Site", test.fetchSite)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != test.status || called != (test.status == http.StatusNoContent) {
				t.Fatalf("status=%d, called=%v", response.Code, called)
			}
		})
	}
}
