package mcpserver

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestAcknowledgmentFlushBeforeReturnRetainsPostBaselineUpdate(t *testing.T) {
	server := mcp.NewServer(&mcp.Implementation{Name: "gate-test", Version: "test"}, &mcp.ServerOptions{
		Capabilities:       &mcp.ServerCapabilities{Resources: &mcp.ResourceCapabilities{Subscribe: true}},
		SubscribeHandler:   func(context.Context, *mcp.SubscribeRequest) error { return nil },
		UnsubscribeHandler: func(context.Context, *mcp.UnsubscribeRequest) error { return nil },
	})
	var revision atomic.Int64
	server.AddResource(&mcp.Resource{URI: "tether://messages/changes", Name: "messages"}, func(context.Context, *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
		return &mcp.ReadResourceResult{Contents: []*mcp.ResourceContents{{URI: "tether://messages/changes", Text: strconv.FormatInt(revision.Load(), 10)}}}, nil
	})
	flushed, release := make(chan struct{}), make(chan struct{})
	defer close(release)
	server.AddSendingMiddleware(func(next mcp.MethodHandler) mcp.MethodHandler {
		return func(ctx context.Context, method string, req mcp.Request) (mcp.Result, error) {
			result, err := next(ctx, method, req)
			if method == "notifications/subscriptions/acknowledged" && err == nil {
				close(flushed)
				select {
				case <-release:
				case <-ctx.Done():
				}
			}
			return result, err
		}
	})
	installAcknowledgmentGate(server)
	handler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, &mcp.StreamableHTTPOptions{Stateless: true})
	httpServer := httptest.NewServer(handler)
	defer httpServer.Close()
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "POST", httpServer.URL, strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"subscriptions/listen","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}},"notifications":{"resourceSubscriptions":["tether://messages/changes"]}}}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("MCP-Protocol-Version", "2026-07-28")
	req.Header.Set("Mcp-Method", "subscriptions/listen")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	scanner := bufio.NewScanner(resp.Body)
	nextEvent := func() string {
		for scanner.Scan() {
			if strings.HasPrefix(scanner.Text(), "data: ") {
				var event struct {
					Method string `json:"method"`
				}
				if err := json.Unmarshal([]byte(strings.TrimPrefix(scanner.Text(), "data: ")), &event); err != nil {
					t.Fatal(err)
				}
				return event.Method
			}
		}
		t.Fatalf("missing notification: %v", scanner.Err())
		return ""
	}
	if got := nextEvent(); got != "notifications/subscriptions/acknowledged" {
		t.Fatalf("first event=%s", got)
	}
	<-flushed
	client := mcp.NewClient(&mcp.Implementation{Name: "baseline", Version: "test"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: httpServer.URL, DisableStandaloneSSE: true}, &mcp.ClientSessionOptions{ProtocolVersion: "2026-07-28"})
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	baseline, err := session.ReadResource(ctx, &mcp.ReadResourceParams{URI: "tether://messages/changes"})
	if err != nil {
		t.Fatal(err)
	}
	if baseline.Contents[0].Text != "0" {
		t.Fatal("unexpected baseline")
	}
	revision.Store(1)
	// The notification worker completes while the flushed acknowledgment is still
	// inside next. No later daemon event will rescue a dropped invalidation.
	if err := server.ResourceUpdated(ctx, &mcp.ResourceUpdatedNotificationParams{URI: "tether://messages/changes"}); err != nil {
		t.Fatal(err)
	}
	release <- struct{}{}
	if got := nextEvent(); got != "notifications/resources/updated" {
		t.Fatalf("post-baseline update=%s", got)
	}
	after, err := session.ReadResource(ctx, &mcp.ReadResourceParams{URI: "tether://messages/changes"})
	if err != nil || after.Contents[0].Text != "1" {
		t.Fatalf("postbaseline observation missing: %v %v", after, err)
	}
}
