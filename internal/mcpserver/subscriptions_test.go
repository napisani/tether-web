package mcpserver_test

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	phoneclient "github.com/napisani/tether-web/examples/phone-subscriptions/client"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestPhoneChangeResourcesDiscoverAndRead(t *testing.T) {
	_, server := startServer(t, nil)
	session := connect(t, server, nil)
	listed, err := session.ListResources(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed.Resources) != 2 {
		t.Fatalf("resources = %v, want two aggregate resources", listed.Resources)
	}
	for _, uri := range []string{"tether://messages/changes", "tether://calls/changes"} {
		result, err := session.ReadResource(t.Context(), &mcp.ReadResourceParams{URI: uri})
		if err != nil {
			t.Fatal(err)
		}
		var value map[string]any
		if len(result.Contents) != 1 || json.Unmarshal([]byte(result.Contents[0].Text), &value) != nil {
			t.Fatalf("invalid resource: %+v", result)
		}
		if value["instance_id"] == "" || value["epoch"] == nil || value["revision"] == nil || value["observations"] == nil {
			t.Fatalf("missing baseline fields: %v", value)
		}
	}
}

type phoneWindow struct {
	InstanceID   string `json:"instance_id"`
	Epoch        uint64 `json:"epoch"`
	Revision     uint64 `json:"revision"`
	Available    bool   `json:"available"`
	Observations []struct {
		Revision uint64 `json:"revision"`
		Kind     string `json:"kind"`
		ThreadID string `json:"thread_id"`
		Handle   string `json:"handle"`
		Outgoing bool   `json:"outgoing"`
	} `json:"observations"`
}

func readPhoneWindow(t *testing.T, session *mcp.ClientSession, uri string) phoneWindow {
	t.Helper()
	result, err := session.ReadResource(t.Context(), &mcp.ReadResourceParams{URI: uri})
	if err != nil {
		t.Fatal(err)
	}
	var w phoneWindow
	if err := json.Unmarshal([]byte(result.Contents[0].Text), &w); err != nil {
		t.Fatal(err)
	}
	return w
}
func TestMessageObservationIdentifiesUnknownThreadWithoutReadLoop(t *testing.T) {
	wire, server := startServer(t, nil)
	session := connect(t, server, nil)
	awaitStatus(t, session, func(s status) bool { return s.MetadataReady })
	baseline := readPhoneWindow(t, session, "tether://messages/changes")
	wire.emit(t, map[string]any{"command": "bt_message", "thread": "tel:unknown", "handle": "m1", "outgoing": false, "body": "not retained"})
	var w phoneWindow
	deadline := time.Now().Add(time.Second)
	for {
		w = readPhoneWindow(t, session, "tether://messages/changes")
		if w.Revision > baseline.Revision {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("message did not advance resource")
		}
	}
	if !w.Available || len(w.Observations) != 2 || w.Observations[0].Kind != "thread_observed" || w.Observations[1].Kind != "message_observed" || w.Observations[1].Handle != "m1" || w.Observations[1].ThreadID != "tel:unknown" {
		t.Fatalf("window = %+v", w)
	}
	wire.emit(t, map[string]any{"command": "bt_message", "thread": "tel:unknown", "handle": "m1", "outgoing": false})
	callTool[threadsResult](t, session, "list_threads", map[string]any{})
	wire.emit(t, map[string]any{"command": "bt_status", "available": true, "version": "message-barrier"})
	awaitStatus(t, session, func(s status) bool { return s.Bluetooth != nil && s.Bluetooth.Version == "message-barrier" })
	if after := readPhoneWindow(t, session, "tether://messages/changes"); after.Revision != w.Revision {
		t.Fatalf("duplicate/read reply advanced revision: %+v", after)
	}
}
func wireRequest(t *testing.T, ctx context.Context, url, body string) *http.Response {
	t.Helper()
	var envelope map[string]any
	if json.Unmarshal([]byte(body), &envelope) == nil {
		if params, ok := envelope["params"].(map[string]any); ok {
			params["_meta"] = map[string]any{mcp.MetaKeyProtocolVersion: "2026-07-28", mcp.MetaKeyClientCapabilities: map[string]any{}}
			encoded, _ := json.Marshal(envelope)
			body = string(encoded)
		}
	}
	req, err := http.NewRequestWithContext(ctx, "POST", url+"/mcp", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("MCP-Protocol-Version", "2026-07-28")
	if method, ok := envelope["method"].(string); ok {
		req.Header.Set("Mcp-Method", method)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}
func listenWire(t *testing.T, url string, id int, uris ...string) (*http.Response, <-chan map[string]any, context.CancelFunc) {
	t.Helper()
	data, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "method": "subscriptions/listen", "params": map[string]any{"notifications": map[string]any{"resourceSubscriptions": uris}}})
	ctx, cancel := context.WithCancel(t.Context())
	resp := wireRequest(t, ctx, url, string(data))
	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		cancel()
		t.Fatalf("listen status=%d body=%s", resp.StatusCode, b)
	}
	events := make(chan map[string]any, 64)
	go func() {
		defer close(events)
		scanner := bufio.NewScanner(resp.Body)
		scanner.Buffer(make([]byte, 4096), 1<<20)
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "data: ") {
				var event map[string]any
				if json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &event) == nil {
					select {
					case events <- event:
					case <-ctx.Done():
						return
					}
				}
			}
		}
	}()
	t.Cleanup(func() { cancel(); resp.Body.Close() })
	return resp, events, cancel
}
func nextWire(t *testing.T, events <-chan map[string]any) map[string]any {
	t.Helper()
	select {
	case e, ok := <-events:
		if !ok {
			t.Fatal("listen ended")
		}
		return e
	case <-time.After(3 * time.Second):
		t.Fatal("no SSE event")
		return nil
	}
}
func TestListenAcknowledgesBeforeIdentifiableMessageInvalidation(t *testing.T) {
	wire, server := startServer(t, nil)
	session := connect(t, server, nil)
	awaitStatus(t, session, func(s status) bool { return s.MetadataReady })
	resp, events, _ := listenWire(t, server.URL, 42, "tether://messages/changes")
	if resp.StatusCode != 200 || !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
		t.Fatalf("listen response: %d %v", resp.StatusCode, resp.Header)
	}
	ack := nextWire(t, events)
	if ack["method"] != "notifications/subscriptions/acknowledged" {
		t.Fatalf("first event=%v", ack)
	}
	params := ack["params"].(map[string]any)
	if params["_meta"].(map[string]any)[mcp.MetaKeySubscriptionID] != float64(42) {
		t.Fatalf("ack ID=%v", ack)
	}
	if resp.Header.Get("Cache-Control") != "no-store" || resp.Header.Get("X-Accel-Buffering") != "no" {
		t.Fatalf("unsafe stream headers: %v", resp.Header)
	}
	baseline := readPhoneWindow(t, session, "tether://messages/changes")
	wire.emit(t, map[string]any{"command": "bt_message", "thread": "tel:new", "handle": "m-live", "outgoing": false})
	updated := nextWire(t, events)
	if updated["method"] != "notifications/resources/updated" {
		t.Fatalf("notification=%v", updated)
	}
	p := updated["params"].(map[string]any)
	if p["uri"] != "tether://messages/changes" || p["_meta"].(map[string]any)[mcp.MetaKeySubscriptionID] != float64(42) {
		t.Fatalf("notification filtering/id=%v", updated)
	}
	if w := readPhoneWindow(t, session, "tether://messages/changes"); w.Revision <= baseline.Revision {
		t.Fatal(fmt.Sprintf("notification without identifiable change: %+v", w))
	}
}
func TestListenCapacityCannotStarveToolsAndCancellationReleasesSlot(t *testing.T) {
	_, server := startServer(t, nil)
	session := connect(t, server, nil)
	var cancels []context.CancelFunc
	for i := 0; i < 8; i++ {
		_, events, cancel := listenWire(t, server.URL, 100+i, "tether://messages/changes")
		nextWire(t, events)
		cancels = append(cancels, cancel)
	}
	response := wireRequest(t, t.Context(), server.URL, `{"jsonrpc":"2.0","id":999,"method":"subscriptions/listen","params":{"notifications":{"resourceSubscriptions":["tether://messages/changes"]}}}`)
	response.Body.Close()
	if response.StatusCode != 503 {
		t.Fatalf("ninth listen status=%d, want separate capacity limit", response.StatusCode)
	}
	callTool[status](t, session, "get_status", map[string]any{})
	cancels[0]()
	deadline := time.Now().Add(time.Second)
	for {
		ctx, cancel := context.WithCancel(t.Context())
		r := wireRequest(t, ctx, server.URL, `{"jsonrpc":"2.0","id":1000,"method":"subscriptions/listen","params":{"notifications":{"resourceSubscriptions":["tether://calls/changes"]}}}`)
		cancel()
		r.Body.Close()
		if r.StatusCode == 200 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("cancelled listen retained capacity")
		}
	}
}
func TestListenAckFirstWhileDaemonContinuouslyUpdates(t *testing.T) {
	wire, server := startServer(t, nil)
	session := connect(t, server, nil)
	awaitStatus(t, session, func(s status) bool { return s.MetadataReady })
	ctx, stop := context.WithCancel(t.Context())
	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; ; i++ {
			select {
			case <-ctx.Done():
				return
			default:
			}
			wire.emit(t, map[string]any{"command": "bt_message", "thread": "t", "handle": fmt.Sprint(i), "outgoing": false})
			time.Sleep(100 * time.Microsecond)
		}
	}()
	defer func() { stop(); <-done }()
	for i := 0; i < 100; i++ {
		resp, events, cancel := listenWire(t, server.URL, 2000+i, "tether://messages/changes")
		first := nextWire(t, events)
		if first["method"] != "notifications/subscriptions/acknowledged" {
			t.Fatalf("update overtook SDK ack: %v", first)
		}
		cancel()
		resp.Body.Close()
	}
}
func TestListenValidatesAndDeduplicatesOnlyFixedResourceURIs(t *testing.T) {
	_, server := startServer(t, nil)
	for _, uris := range []string{`["tether://arbitrary"]`, `["tether://messages/changes","tether://calls/changes","tether://messages/changes"]`} {
		ctx, cancel := context.WithTimeout(t.Context(), time.Second)
		r := wireRequest(t, ctx, server.URL, `{"jsonrpc":"2.0","id":71,"method":"subscriptions/listen","params":{"notifications":{"resourceSubscriptions":`+uris+`}}}`)
		r.Body.Close()
		cancel()
		if r.StatusCode != 400 {
			t.Fatalf("invalid URI filter accepted: %s status=%d", uris, r.StatusCode)
		}
	}
	resp, events, _ := listenWire(t, server.URL, 72, "tether://messages/changes", "tether://messages/changes")
	defer resp.Body.Close()
	ack := nextWire(t, events)
	accepted := ack["params"].(map[string]any)["notifications"].(map[string]any)["resourceSubscriptions"].([]any)
	if len(accepted) != 1 {
		t.Fatalf("duplicate subscriptions: %v", ack)
	}
}
func TestServerCloseCancelsListenBeforeHTTPShutdown(t *testing.T) {
	wire, server := startServer(t, nil)
	_, events, _ := listenWire(t, server.URL, 80, "tether://messages/changes")
	nextWire(t, events)
	wire.agent.Close()
	done := make(chan error, 1)
	go func() {
		ctx, cancel := context.WithTimeout(t.Context(), time.Second)
		defer cancel()
		done <- server.Config.Shutdown(ctx)
	}()
	if err := <-done; err != nil {
		t.Fatalf("listen blocked graceful shutdown: %v", err)
	}
}
func TestIdleListenHasSSECommentKeepalive(t *testing.T) {
	_, server := startServer(t, nil)
	ctx, cancel := context.WithTimeout(t.Context(), 18*time.Second)
	defer cancel()
	resp := wireRequest(t, ctx, server.URL, `{"jsonrpc":"2.0","id":81,"method":"subscriptions/listen","params":{"notifications":{"resourceSubscriptions":["tether://messages/changes"]}}}`)
	defer resp.Body.Close()
	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		if strings.HasPrefix(scanner.Text(), ": keepalive") {
			return
		}
	}
	t.Fatalf("idle stream ended without keepalive: %v", scanner.Err())
}
func connectNewProtocol(t *testing.T, server *httptest.Server) *mcp.ClientSession {
	t.Helper()
	client := mcp.NewClient(&mcp.Implementation{Name: "subscription-host", Version: "test"}, nil)
	session, err := client.Connect(t.Context(), &mcp.StreamableClientTransport{Endpoint: server.URL + "/mcp", DisableStandaloneSSE: true, MaxRetries: -1}, &mcp.ClientSessionOptions{ProtocolVersion: "2026-07-28"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { session.Close() })
	return session
}
func TestHostConsumerEnqueuesMessageReviewAfterReadingExistingTool(t *testing.T) {
	wire, server := startServer(t, nil)
	session := connectNewProtocol(t, server)
	awaitStatus(t, session, func(s status) bool { return s.MetadataReady })
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	ready := make(chan struct{})
	jobs := make(chan phoneclient.Work, 4)
	done := make(chan error, 1)
	go func() {
		done <- phoneclient.Run(ctx, server.URL+"/mcp", http.DefaultClient, session, func() { close(ready) }, func(work phoneclient.Work) error { jobs <- work; return nil })
	}()
	select {
	case <-ready:
	case err := <-done:
		t.Fatalf("consumer failed: %v", err)
	case <-time.After(time.Second):
		t.Fatal("no subscribed baseline")
	}
	wire.emit(t, map[string]any{"command": "bt_message", "thread": "tel:new", "handle": "m-review", "outgoing": false})
	select {
	case job := <-jobs:
		if job.Kind != "message_review" || job.ThreadID != "tel:new" || job.Handle != "m-review" || job.Result == nil || job.Result.IsError {
			t.Fatalf("work=%+v", job)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("no host work enqueue")
	}
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}
func TestHostConsumerEnqueuesIncomingCallAfterReadingExistingTool(t *testing.T) {
	wire, server := startServer(t, nil)
	session := connect(t, server, nil)
	awaitStatus(t, session, func(s status) bool { return s.MetadataReady })
	wire.emit(t, map[string]any{"command": "protocol_info", "version": 1, "capabilities": []string{"messages", "calls"}})
	wire.emit(t, map[string]any{"command": "bt_connection_changed", "map_open": true, "calls": map[string]any{"available": true}})
	select {
	case <-wire.callReads:
	case <-time.After(time.Second):
		t.Fatal("available transition did not request a calls baseline")
	}
	wire.emit(t, map[string]any{"command": "bt_status", "available": true, "version": "call-baseline"})
	awaitStatus(t, session, func(s status) bool { return s.Bluetooth != nil && s.Bluetooth.Version == "call-baseline" })
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	ready := make(chan struct{})
	jobs := make(chan phoneclient.Work, 4)
	done := make(chan error, 1)
	go func() {
		done <- phoneclient.Run(ctx, server.URL+"/mcp", http.DefaultClient, session, func() { close(ready) }, func(work phoneclient.Work) error { jobs <- work; return nil })
	}()
	select {
	case <-ready:
	case err := <-done:
		t.Fatalf("consumer failed: %v", err)
	case <-time.After(time.Second):
		t.Fatal("no baseline")
	}
	wire.mu.Lock()
	wire.calls = []map[string]any{{"path": "/call/live", "state": "incoming", "ringing": true, "outgoing": false}}
	wire.mu.Unlock()
	wire.emit(t, map[string]any{"command": "bt_calls", "calls": wire.calls})
	select {
	case job := <-jobs:
		if job.Kind != "incoming_call_review" || job.Path != "/call/live" || job.Result == nil || job.Result.IsError {
			t.Fatalf("work=%+v", job)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("no incoming-call host work")
	}
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}
