package mcpserver_test

import (
	"bufio"
	"context"
	"encoding/json"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/napisani/tether-web/internal/gateway"
	"net/http"
	"strings"
	"testing"
	"time"
)

func protectedWire(t *testing.T, ctx context.Context, url string, credentials *gateway.BasicCredentials, origin, method string, params map[string]any) *http.Response {
	t.Helper()
	params["_meta"] = map[string]any{mcp.MetaKeyProtocolVersion: "2026-07-28", mcp.MetaKeyClientCapabilities: map[string]any{}}
	body, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": "protected-listen", "method": method, "params": params})
	req, err := http.NewRequestWithContext(ctx, "POST", url+"/mcp", strings.NewReader(string(body)))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("MCP-Protocol-Version", "2026-07-28")
	req.Header.Set("Mcp-Method", method)
	if uri, ok := params["uri"].(string); ok {
		req.Header.Set("Mcp-Name", uri)
	}
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	if credentials != nil {
		req.SetBasicAuth(credentials.Username, credentials.Password)
	}
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return response
}
func TestNewProtocolReadsArePrivateZeroTTLAndShareListenSecurity(t *testing.T) {
	credentials := &gateway.BasicCredentials{Username: "owner", Password: "a-long-private-password"}
	_, server := startServer(t, credentials)
	filter := func() map[string]any {
		return map[string]any{"notifications": map[string]any{"resourceSubscriptions": []string{"tether://messages/changes"}}}
	}
	for _, tc := range []struct {
		credentials *gateway.BasicCredentials
		origin      string
		status      int
	}{
		{nil, "", 401}, {credentials, "https://attacker.invalid", 403},
	} {
		response := protectedWire(t, t.Context(), server.URL, tc.credentials, tc.origin, "subscriptions/listen", filter())
		response.Body.Close()
		if response.StatusCode != tc.status {
			t.Fatalf("security status=%d want=%d", response.StatusCode, tc.status)
		}
	}
	for _, method := range []string{"server/discover", "resources/list", "resources/read"} {
		params := map[string]any{}
		if method == "resources/read" {
			params["uri"] = "tether://messages/changes"
		}
		response := protectedWire(t, t.Context(), server.URL, credentials, "", method, params)
		var envelope struct {
			Result map[string]any `json:"result"`
			Error  any            `json:"error"`
		}
		err := json.NewDecoder(response.Body).Decode(&envelope)
		response.Body.Close()
		if err != nil || response.StatusCode != 200 || envelope.Error != nil || response.Header.Get("Cache-Control") != "no-store" || response.Header.Get("Content-Type") != "application/json" {
			t.Fatalf("%s: status=%d headers=%v reply=%v err=%v", method, response.StatusCode, response.Header, envelope, err)
		}
		if envelope.Result["ttlMs"] != float64(0) || envelope.Result["cacheScope"] != "private" {
			t.Fatalf("unsafe cache hint: %v", envelope.Result)
		}
	}
	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	response := protectedWire(t, ctx, server.URL, credentials, "", "subscriptions/listen", filter())
	defer response.Body.Close()
	scanner := bufio.NewScanner(response.Body)
	for scanner.Scan() {
		if strings.HasPrefix(scanner.Text(), "data: ") {
			if !strings.Contains(scanner.Text(), "notifications/subscriptions/acknowledged") {
				t.Fatalf("not acknowledgment: %s", scanner.Text())
			}
			return
		}
	}
	t.Fatal("authenticated listen did not acknowledge")
}
