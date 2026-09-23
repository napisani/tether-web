package gateway_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/napisani/tether-web/internal/gateway"
)

func TestStaticAssetsUseContentSpecificCaching(t *testing.T) {
	handler := gateway.NewHandler(&fakeBus{}, testAssets(), gateway.Config{})
	for _, test := range []struct {
		path string
		want string
	}{
		{path: "/", want: "no-cache"},
		{path: "/assets/app-deadbeef.js", want: "public, max-age=31536000, immutable"},
	} {
		t.Run(test.path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "http://tether.test"+test.path, nil)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, req)
			if response.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
			}
			if got := response.Header().Get("Cache-Control"); got != test.want {
				t.Fatalf("Cache-Control = %q, want %q", got, test.want)
			}
		})
	}
}
