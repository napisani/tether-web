package client

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestRunAcknowledgmentTimeoutIncludesHTTPHeaders(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { io.Copy(io.Discard, r.Body); <-r.Context().Done() }))
	defer server.Close()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- RunWithOptions(ctx, server.URL, server.Client(), nil, nil, func(Work) error { return nil }, Options{AcknowledgmentTimeout: 30 * time.Millisecond})
	}()
	select {
	case err := <-done:
		if err == nil || !strings.Contains(err.Error(), "acknowledgment timeout") || !strings.Contains(err.Error(), "re-baseline") {
			t.Fatalf("expected explicit acknowledgment timeout, got %v", err)
		}
	case <-time.After(time.Second):
		cancel()
		<-done
		t.Fatal("listen headers stalled beyond acknowledgment deadline")
	}
}

// Real SDK resource/tool HTTP reads, with a separately controlled SSE transport.
// No consumer internals are replaced. Every read records a barrier for the host.
type hostFixture struct {
	mu         sync.Mutex
	value      window
	reads      chan string
	stream     chan string
	session    *mcp.ClientSession
	endpoint   string
	httpClient *http.Client
}

func newHostFixture(t *testing.T) *hostFixture {
	t.Helper()
	f := &hostFixture{value: window{InstanceID: "one", Epoch: 1, Available: true, OldestRevision: 1}, reads: make(chan string, 32), stream: make(chan string, 32)}
	sdk := mcp.NewServer(&mcp.Implementation{Name: "fixture", Version: "test"}, nil)
	for _, uri := range []string{MessagesURI, CallsURI} {
		sdk.AddResource(&mcp.Resource{URI: uri, Name: uri}, func(ctx context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
			f.mu.Lock()
			w := f.value
			f.mu.Unlock()
			data, _ := json.Marshal(w)
			f.reads <- req.Params.URI
			return &mcp.ReadResourceResult{Contents: []*mcp.ResourceContents{{URI: req.Params.URI, Text: string(data)}}}, nil
		})
	}
	mcp.AddTool(sdk, &mcp.Tool{Name: "list_messages"}, func(context.Context, *mcp.CallToolRequest, map[string]any) (*mcp.CallToolResult, map[string]any, error) {
		return &mcp.CallToolResult{}, map[string]any{}, nil
	})
	mcp.AddTool(sdk, &mcp.Tool{Name: "list_calls"}, func(context.Context, *mcp.CallToolRequest, map[string]any) (*mcp.CallToolResult, map[string]any, error) {
		return &mcp.CallToolResult{}, map[string]any{}, nil
	})
	rpc := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return sdk }, &mcp.StreamableHTTPOptions{Stateless: true})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/listen" {
			rpc.ServeHTTP(w, r)
			return
		}
		io.Copy(io.Discard, r.Body)
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(200)
		w.(http.Flusher).Flush()
		for {
			select {
			case line := <-f.stream:
				fmt.Fprint(w, line)
				w.(http.Flusher).Flush()
			case <-r.Context().Done():
				return
			}
		}
	}))
	t.Cleanup(server.Close)
	f.endpoint = server.URL + "/listen"
	f.httpClient = server.Client()
	sdkClient := mcp.NewClient(&mcp.Implementation{Name: "host", Version: "test"}, nil)
	var err error
	f.session, err = sdkClient.Connect(t.Context(), &mcp.StreamableClientTransport{Endpoint: server.URL, DisableStandaloneSSE: true}, &mcp.ClientSessionOptions{ProtocolVersion: "2026-07-28"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { f.session.Close() })
	return f
}
func (f *hostFixture) event(method string) {
	data, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "method": method, "params": map[string]any{"uri": MessagesURI, "_meta": map[string]any{mcp.MetaKeySubscriptionID: 1}}})
	f.stream <- "data: " + string(data) + "\n\n"
}
func (f *hostFixture) set(w window) { f.mu.Lock(); f.value = w; f.mu.Unlock() }
func (f *hostFixture) awaitRead(t *testing.T) {
	t.Helper()
	select {
	case <-f.reads:
	case <-time.After(time.Second):
		t.Fatal("no resource read")
	}
}
func (f *hostFixture) start(t *testing.T, options Options, enqueue func(Work) error) (context.CancelFunc, <-chan error) {
	t.Helper()
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan error, 1)
	ready := make(chan struct{})
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		done <- RunWithOptions(ctx, f.endpoint, f.httpClient, f.session, func() { close(ready) }, enqueue, options)
	}()
	t.Cleanup(func() {
		cancel()
		select {
		case <-finished:
		case <-time.After(time.Second):
			t.Error("consumer did not stop")
		}
	})
	f.event("notifications/subscriptions/acknowledged")
	select {
	case <-ready:
	case err := <-done:
		t.Fatalf("baseline failed: %v", err)
	case <-time.After(time.Second):
		t.Fatal("no baseline")
	}
	f.awaitRead(t)
	f.awaitRead(t)
	return cancel, done
}
func TestRunIdleTimeoutRequiresRebaseline(t *testing.T) {
	f := newHostFixture(t)
	_, done := f.start(t, Options{IdleTimeout: 40 * time.Millisecond}, func(Work) error { return nil })
	select {
	case err := <-done:
		if err == nil || !strings.Contains(err.Error(), "idle timeout") || !strings.Contains(err.Error(), "re-baseline") {
			t.Fatalf("expected explicit idle loss, got %v", err)
		}
	case <-time.After(200 * time.Millisecond):
		t.Fatal("silent stream never expired")
	}
}

func TestRunAcknowledgmentTimeoutIncludesSilentSSE(t *testing.T) {
	f := newHostFixture(t)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	err := RunWithOptions(ctx, f.endpoint, f.httpClient, f.session, nil, func(Work) error { return nil }, Options{AcknowledgmentTimeout: 30 * time.Millisecond})
	if err == nil || !strings.Contains(err.Error(), "acknowledgment timeout") {
		t.Fatalf("silent SSE acknowledgment: %v", err)
	}
}

func TestRunKeepaliveCommentsResetIdleWithoutLifetimeLimit(t *testing.T) {
	f := newHostFixture(t)
	cancel, done := f.start(t, Options{AcknowledgmentTimeout: 30 * time.Millisecond, IdleTimeout: 150 * time.Millisecond}, func(Work) error { return nil })
	// Exercise substantially longer than both configured deadlines, without data.
	for i := 0; i < 8; i++ {
		f.stream <- ": keepalive\n\n"
		select {
		case err := <-done:
			t.Fatalf("healthy comment stream expired: %v", err)
		case <-time.After(35 * time.Millisecond):
		}
	}
	cancel()
	if err := <-done; err != nil {
		t.Fatalf("external cancellation must be nil: %v", err)
	}
}

func TestRunExternalCancellationBeforeHeadersIsNil(t *testing.T) {
	entered := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.Copy(io.Discard, r.Body)
		close(entered)
		<-r.Context().Done()
	}))
	defer server.Close()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- Run(ctx, server.URL, server.Client(), nil, nil, func(Work) error { return nil }) }()
	<-entered
	cancel()
	if err := <-done; err != nil {
		t.Fatalf("cancel headers: %v", err)
	}
}

func messageWindow(instance string, epoch, cursor, oldest uint64, handles ...string) window {
	w := window{InstanceID: instance, Epoch: epoch, Cursor: cursor, OldestRevision: oldest, Available: true}
	for i, h := range handles {
		w.Observations = append(w.Observations, observation{Revision: oldest + uint64(i), Kind: "message_observed", ThreadID: "thread", Handle: h})
	}
	return w
}
func nextJob(t *testing.T, jobs <-chan Work) Work {
	t.Helper()
	select {
	case job := <-jobs:
		return job
	case <-time.After(time.Second):
		t.Fatal("no review job")
		return Work{}
	}
}
func TestHostConsumerChangedContextSuppressesBaseline(t *testing.T) {
	for _, change := range []string{"instance", "epoch"} {
		t.Run(change, func(t *testing.T) {
			f := newHostFixture(t)
			f.set(messageWindow("one", 1, 1, 1, "initial"))
			jobs := make(chan Work, 8)
			cancel, done := f.start(t, Options{}, func(w Work) error { jobs <- w; return nil })
			instance, epoch := "one", uint64(1)
			if change == "instance" {
				instance = "two"
			} else {
				epoch = 2
			}
			f.set(messageWindow(instance, epoch, 2, 1, "old", "synchronized"))
			f.event("notifications/resources/updated")
			f.awaitRead(t)
			f.set(messageWindow(instance, epoch, 3, 1, "old", "synchronized", "live"))
			f.event("notifications/resources/updated")
			if job := nextJob(t, jobs); job.Handle != "live" {
				t.Fatalf("baseline replayed: %+v", job)
			}
			cancel()
			if err := <-done; err != nil {
				t.Fatal(err)
			}
			if len(jobs) != 0 {
				t.Fatal("baseline produced extra jobs")
			}
		})
	}
}
func TestHostConsumerDuplicateInvalidationsDoNotDuplicateJobs(t *testing.T) {
	f := newHostFixture(t)
	jobs := make(chan Work, 8)
	cancel, done := f.start(t, Options{}, func(w Work) error { jobs <- w; return nil })
	f.set(messageWindow("one", 1, 1, 1, "first"))
	f.event("notifications/resources/updated")
	if job := nextJob(t, jobs); job.Handle != "first" {
		t.Fatal(job)
	}
	f.awaitRead(t)
	f.event("notifications/resources/updated")
	f.awaitRead(t)
	f.set(messageWindow("one", 1, 2, 1, "first", "second"))
	f.event("notifications/resources/updated")
	if job := nextJob(t, jobs); job.Handle != "second" {
		t.Fatalf("duplicate cursor delivered: %+v", job)
	}
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if len(jobs) != 0 {
		t.Fatal("duplicate jobs")
	}
}
func TestHostConsumerGapExitsWithoutDeliveringRetainedObservations(t *testing.T) {
	f := newHostFixture(t)
	jobs := make(chan Work, 8)
	_, done := f.start(t, Options{}, func(w Work) error { jobs <- w; return nil })
	f.set(messageWindow("one", 1, 130, 3, "retained"))
	f.event("notifications/resources/updated")
	select {
	case err := <-done:
		if err == nil || !strings.Contains(err.Error(), "gap") {
			t.Fatalf("gap error: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("gap did not stop")
	}
	if len(jobs) != 0 {
		t.Fatal("gap delivered retained history")
	}
}
func TestHostConsumerEnqueueRejectionTerminatesWithoutReplay(t *testing.T) {
	f := newHostFixture(t)
	jobs := make(chan Work, 8)
	rejected := errors.New("review queue full")
	_, done := f.start(t, Options{}, func(w Work) error { jobs <- w; return rejected })
	f.set(messageWindow("one", 1, 2, 1, "first", "second"))
	f.event("notifications/resources/updated")
	select {
	case err := <-done:
		if !errors.Is(err, rejected) {
			t.Fatalf("rejection error: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("enqueue rejection did not stop")
	}
	if len(jobs) != 1 || (<-jobs).Handle != "first" {
		t.Fatal("enqueue rejection replayed or delivered subsequent work")
	}
}
