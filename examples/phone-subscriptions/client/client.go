// Package client demonstrates host-side scheduling, not an LLM wake-up API.
package client

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"net/http"
	"strings"
	"sync"
	"time"
)

const MessagesURI = "tether://messages/changes"
const CallsURI = "tether://calls/changes"

type Work struct {
	Kind     string
	ThreadID string
	Handle   string
	Path     string
	Result   *mcp.CallToolResult
}
type observation struct {
	Revision uint64 `json:"revision"`
	Kind     string `json:"kind"`
	ThreadID string `json:"thread_id"`
	Handle   string `json:"handle"`
	Outgoing bool   `json:"outgoing"`
	Path     string `json:"path"`
}
type window struct {
	InstanceID     string        `json:"instance_id"`
	Epoch          uint64        `json:"epoch"`
	Cursor         uint64        `json:"cursor"`
	OldestRevision uint64        `json:"oldest_revision"`
	Available      bool          `json:"available"`
	Observations   []observation `json:"observations"`
}

// The largest producer observation is a read-status batch: 100 handles of
// 256 bytes, each byte expanding to at most six JSON bytes. Allow three bytes
// per array entry, 1 KiB observation overhead, and 4 KiB window overhead.
// This also covers the smaller message (1024+256 bytes) and call (1024+64)
// identifiers. Keep both the encoded bound and the 128-observation check.
const maxEncodedWindow = 128*(100*(256*6+3)+1024) + 4096

func readWindow(ctx context.Context, session *mcp.ClientSession, uri string) (window, error) {
	// Full escaped windows can approach 20 MB; keep transfer/decoding bounded
	// without imposing the much smaller tool-enrichment deadline on them.
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	result, err := session.ReadResource(ctx, &mcp.ReadResourceParams{URI: uri})
	if err != nil {
		return window{}, err
	}
	if len(result.Contents) != 1 || len(result.Contents[0].Text) > maxEncodedWindow {
		return window{}, errors.New("invalid change window")
	}
	var w window
	if err := json.Unmarshal([]byte(result.Contents[0].Text), &w); err != nil {
		return w, err
	}
	if len(w.Observations) > 128 || w.InstanceID == "" || w.Epoch == 0 {
		return w, errors.New("invalid change cursor")
	}
	return w, nil
}

// Options controls acknowledgment and silence deadlines, not total lifetime.
type Options struct {
	// AcknowledgmentTimeout covers request headers and the first SSE acknowledgment.
	// Zero uses ten seconds.
	AcknowledgmentTimeout time.Duration
	// IdleTimeout bounds silence, not total lifetime. Zero uses 45 seconds,
	// longer than the server's 15-second SSE keepalive interval.
	IdleTimeout time.Duration
}

// Run subscribes before taking a baseline. enqueue must be bounded and must not
// perform automatic actions: message observations can be outgoing or backfill.
// Errors, stream loss, and gaps require the host to re-baseline, not replay work.
func Run(ctx context.Context, endpoint string, httpClient *http.Client, session *mcp.ClientSession, ready func(), enqueue func(Work) error) error {
	return RunWithOptions(ctx, endpoint, httpClient, session, ready, enqueue, Options{})
}

// RunWithOptions preserves an unlimited healthy stream lifetime.
func RunWithOptions(parent context.Context, endpoint string, httpClient *http.Client, session *mcp.ClientSession, ready func(), enqueue func(Work) error, options Options) (retErr error) {
	ctx, cancel := context.WithCancelCause(parent)
	defer cancel(nil)
	timeout := options.AcknowledgmentTimeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	ackTimeout := errors.New("listen acknowledgment timeout; re-baseline required")
	idleTimeout := errors.New("listen idle timeout; re-baseline required")
	idleDuration := options.IdleTimeout
	if idleDuration <= 0 {
		idleDuration = 45 * time.Second
	}
	// Serialize deadline changes and expiry. An already-running timer callback
	// rechecks the deadline, so Reset cannot race into canceling a healthy stream.
	var timerMu sync.Mutex
	deadline, reason := time.Now().Add(timeout), ackTimeout
	stopped := false
	var timer *time.Timer
	timerMu.Lock()
	timer = time.AfterFunc(timeout, func() {
		timerMu.Lock()
		defer timerMu.Unlock()
		if stopped {
			return
		}
		if remaining := time.Until(deadline); remaining > 0 {
			timer.Reset(remaining)
			return
		}
		cancel(reason)
	})
	timerMu.Unlock()
	defer func() { timerMu.Lock(); stopped = true; timer.Stop(); timerMu.Unlock() }()
	touchIdle := func() {
		timerMu.Lock()
		defer timerMu.Unlock()
		if ctx.Err() != nil {
			return
		}
		deadline, reason = time.Now().Add(idleDuration), idleTimeout
		timer.Reset(idleDuration)
	}
	defer func() {
		if parent.Err() != nil {
			retErr = nil
		} else if context.Cause(ctx) == ackTimeout || context.Cause(ctx) == idleTimeout {
			retErr = context.Cause(ctx)
		}
	}()
	body, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": "subscriptions/listen", "params": map[string]any{
		"_meta":         map[string]any{mcp.MetaKeyProtocolVersion: "2026-07-28", mcp.MetaKeyClientCapabilities: map[string]any{}},
		"notifications": map[string]any{"resourceSubscriptions": []string{MessagesURI, CallsURI}},
	}})
	req, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("MCP-Protocol-Version", "2026-07-28")
	req.Header.Set("Mcp-Method", "subscriptions/listen")
	response, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != 200 || !strings.HasPrefix(response.Header.Get("Content-Type"), "text/event-stream") {
		return fmt.Errorf("listen HTTP status %d", response.StatusCode)
	}
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 4096), 64<<10)
	// The scanner never waits for enrichment or callbacks. Each fixed URI has
	// one pending invalidation slot; duplicates coalesce without losing the
	// latest resource state. No unbounded event queue or worker pool is needed.
	ack := make(chan struct{})
	messages, calls := make(chan struct{}, 1), make(chan struct{}, 1)
	scanned := make(chan struct{})
	go func() {
		defer close(scanned)
		acked := false
		for scanner.Scan() {
			if ctx.Err() != nil {
				return
			}
			if acked {
				touchIdle()
			} // Comments and blank lines are activity.
			line := scanner.Text()
			if !strings.HasPrefix(line, "data: ") {
				continue
			}
			var event struct {
				Method string `json:"method"`
				Params struct {
					URI  string         `json:"uri"`
					Meta map[string]any `json:"_meta"`
				} `json:"params"`
			}
			if json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &event) != nil {
				cancel(errors.New("invalid SSE notification"))
				return
			}
			if event.Params.Meta[mcp.MetaKeySubscriptionID] != float64(1) {
				cancel(errors.New("wrong subscription ID"))
				return
			}
			if !acked {
				if event.Method != "notifications/subscriptions/acknowledged" {
					cancel(errors.New("listen acknowledgment was not first"))
					return
				}
				touchIdle()
				acked = true
				close(ack)
				continue
			}
			if event.Method != "notifications/resources/updated" {
				continue
			}
			var dirty chan struct{}
			switch event.Params.URI {
			case MessagesURI:
				dirty = messages
			case CallsURI:
				dirty = calls
			default:
				cancel(errors.New("unsolicited resource notification"))
				return
			}
			select {
			case dirty <- struct{}{}:
			default:
			}
		}
		if err := scanner.Err(); err != nil {
			cancel(err)
		} else {
			cancel(errors.New("subscription ended; re-baseline required"))
		}
	}()
	// Cancellation closes the HTTP body, interrupting Scan; join it on every
	// exit, including callback rejection and resource/tool errors.
	defer func() { cancel(nil); response.Body.Close(); <-scanned }()
	select {
	case <-ctx.Done():
		return context.Cause(ctx)
	case <-ack:
	}
	cursors := make(map[string]window, 2)
	for _, uri := range []string{MessagesURI, CallsURI} {
		w, err := readWindow(ctx, session, uri)
		if err != nil {
			return err
		}
		cursors[uri] = w
	}
	if ctx.Err() != nil {
		return context.Cause(ctx)
	}
	if ready != nil {
		ready()
	}
	for {
		var uri string
		select {
		case <-ctx.Done():
			return context.Cause(ctx)
		case <-messages:
			uri = MessagesURI
		case <-calls:
			uri = CallsURI
		}
		if ctx.Err() != nil {
			return context.Cause(ctx)
		}
		prior := cursors[uri]
		w, err := readWindow(ctx, session, uri)
		if err != nil {
			return err
		}
		cursors[uri] = w
		if prior.InstanceID != w.InstanceID || prior.Epoch != w.Epoch || !prior.Available || !w.Available {
			continue
		}
		if prior.Cursor+1 < w.OldestRevision {
			return errors.New("change window gap: manual resynchronization required")
		}
		for _, o := range w.Observations {
			if o.Revision <= prior.Cursor {
				continue
			}
			name := "list_messages"
			args := map[string]any{"thread_id": o.ThreadID, "limit": 100}
			kind := "message_review"
			switch o.Kind {
			case "message_observed":
			case "incoming_call_ringing":
				name = "list_calls"
				args = map[string]any{}
				kind = "incoming_call_review"
			default:
				continue
			}
			readCtx, stop := context.WithTimeout(ctx, 5*time.Second)
			result, err := session.CallTool(readCtx, &mcp.CallToolParams{Name: name, Arguments: args})
			stop()
			if err != nil {
				return err
			}
			if result.IsError {
				return errors.New("phone read unavailable; re-baseline")
			}
			// Tool reads are not atomic with resource epochs (for example a
			// retention change can occur while enrichment is in flight).
			current, err := readWindow(ctx, session, uri)
			if err != nil {
				return err
			}
			if current.InstanceID != w.InstanceID || current.Epoch != w.Epoch || !current.Available {
				cursors[uri] = current
				break // Re-baseline and discard the entire old-window remainder.
			}
			if ctx.Err() != nil {
				return context.Cause(ctx)
			}
			if err := enqueue(Work{Kind: kind, ThreadID: o.ThreadID, Handle: o.Handle, Path: o.Path, Result: result}); err != nil {
				return err
			}
		}
	}
}
