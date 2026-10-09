package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/napisani/tether-web/internal/gateway"
	"slices"
	"time"
)

const MessagesChangesURI = "tether://messages/changes"
const CallsChangesURI = "tether://calls/changes"
const changeWindowLimit = 128

type changeWindow struct {
	InstanceID       string              `json:"instance_id"`
	Epoch            uint64              `json:"epoch"`
	Revision         uint64              `json:"revision"`
	Cursor           uint64              `json:"cursor"`
	OldestRevision   uint64              `json:"oldest_revision"`
	HistoryAmbiguous bool                `json:"history_ambiguous"`
	Available        bool                `json:"available"`
	Observations     []changeObservation `json:"observations"`
}
type changeObservation struct {
	Revision               uint64 `json:"revision"`
	Kind                   string `json:"kind"`
	ThreadID               string `json:"thread_id,omitempty"`
	Handle                 string `json:"handle,omitempty"`
	Outgoing               bool   `json:"outgoing,omitempty"`
	Path                   string `json:"path,omitempty"`
	State                  string `json:"state,omitempty"`
	InitialSynchronization bool   `json:"initial_synchronization,omitempty"`
	Read                   *bool  `json:"read,omitempty"`
}
type changeState struct {
	changeWindow
	threads       []string
	messages      []string
	calls         map[string]callObservation
	callsBaseline bool
	dirty         bool
	signal        chan struct{}
}

func (s *changeState) markDirty() {
	s.dirty = true
	select {
	case s.signal <- struct{}{}:
	default:
	}
}
func (s *changeState) reset(available bool) {
	s.Epoch++
	s.Revision = 0
	s.Available = available
	s.Observations = []changeObservation{}
	s.threads = nil
	s.messages = nil
	s.calls = nil
	s.callsBaseline = false
	s.markDirty()
}
func (t *Set) resetChanges() {
	for _, uri := range []string{MessagesChangesURI, CallsChangesURI} {
		t.changeState(uri).reset(false)
	}
}
func (t *Set) checkChangeIdentity(data json.RawMessage) {
	var input struct {
		Address   *string `json:"device_address"`
		Retention *string `json:"retention"`
	}
	if json.Unmarshal(data, &input) != nil || input.Address != nil && len(*input.Address) > 128 || input.Retention != nil && len(*input.Retention) > 64 {
		return
	}
	phoneChanged := input.Address != nil && t.changePhone != "" && *input.Address != t.changePhone
	retentionChanged := input.Retention != nil && t.changeRetention != "" && *input.Retention != t.changeRetention
	if phoneChanged || retentionChanged {
		t.resetChanges()
	}
	if phoneChanged {
		t.connection = nil
	}
	if input.Address != nil {
		t.changePhone = *input.Address
	}
	if input.Retention != nil {
		t.changeRetention = *input.Retention
	}
}

type callObservation struct {
	Path     string `json:"path"`
	State    string `json:"state"`
	Outgoing *bool  `json:"outgoing"`
	Ringing  *bool  `json:"ringing"`
}

func (t *Set) changeState(uri string) *changeState {
	if t.changes == nil {
		t.changes = make(map[string]*changeState)
	}
	if t.changes[uri] == nil {
		t.changes[uri] = &changeState{signal: t.changeSignals, changeWindow: changeWindow{InstanceID: t.instanceID, Epoch: 1, Observations: []changeObservation{}}}
	}
	return t.changes[uri]
}
func (t *Set) registerChangeResources(server *mcp.Server) {
	t.changeServer = server
	for _, uri := range []string{MessagesChangesURI, CallsChangesURI} {
		server.AddResource(&mcp.Resource{URI: uri, Name: uri, MIMEType: "application/json"}, t.readChanges)
	}
}
func (t *Set) readChanges(_ context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if req.Params.URI != MessagesChangesURI && req.Params.URI != CallsChangesURI {
		return nil, fmt.Errorf("unknown change resource")
	}
	// Project an unavailable, redacted view while gateway_status is queued.
	// Only lifecycle events reset reducer state or schedule invalidations.
	value := changeWindow{InstanceID: t.instanceID, Epoch: 1, Observations: []changeObservation{}}
	if s := t.changes[req.Params.URI]; s != nil {
		value = s.changeWindow
	}
	connected := t.currentConnection() // One gateway snapshot linearizes this read.
	if !connected {
		value.Available = false
		value.Observations = []changeObservation{}
		value.Revision = 0
		value.Epoch++
	}
	value.Cursor = value.Revision
	value.OldestRevision = value.Revision + 1
	if len(value.Observations) > 0 {
		value.OldestRevision = value.Observations[0].Revision
	}
	value.HistoryAmbiguous = true
	if req.Params.URI == CallsChangesURI {
		s := t.changes[CallsChangesURI]
		value.HistoryAmbiguous = s == nil || !s.callsBaseline || !connected
	}
	value.Available = connected && value.Available
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return &mcp.ReadResourceResult{Cacheable: mcp.Cacheable{TTLMs: 0, CacheScope: "private"}, Contents: []*mcp.ResourceContents{{URI: req.Params.URI, MIMEType: "application/json", Text: string(data)}}}, nil
}
func (s *changeState) append(o changeObservation) {
	s.markDirty()
	s.Revision++
	o.Revision = s.Revision
	s.Observations = append(s.Observations, o)
	if len(s.Observations) > changeWindowLimit {
		s.Observations = slices.Clone(s.Observations[len(s.Observations)-changeWindowLimit:])
	}
}
func remember(values *[]string, value string) bool {
	if slices.Contains(*values, value) {
		return false
	}
	*values = append(*values, value)
	if len(*values) > changeWindowLimit {
		*values = slices.Clone((*values)[1:])
	}
	return true
}

// Called under the tools lock; never performs network I/O.
func (t *Set) observeChanges(event gateway.Event, command string) {
	messages := t.changeState(MessagesChangesURI)
	calls := t.changeState(CallsChangesURI)
	callsAvailable := t.callsReady() == nil
	if calls.Available != callsAvailable {
		calls.reset(callsAvailable)
		if callsAvailable {
			select {
			case t.callsSeedSignals <- struct{}{}:
			default:
			}
		}
	}
	if command == "bt_calls" && calls.Available {
		calls.observeCalls(event.Data)
	}
	messagesAvailable := t.messagesReady() == nil
	if messages.Available != messagesAvailable {
		messages.reset(messagesAvailable)
	}
	if command == "bt_message_read" && messages.Available {
		var input struct {
			Handles []string `json:"handles"`
			Read    *bool    `json:"read"`
			Success *bool    `json:"success"`
		}
		if json.Unmarshal(event.Data, &input) != nil || input.Read == nil || input.Success == nil || !*input.Success || len(input.Handles) == 0 || len(input.Handles) > 100 {
			return
		}
		for _, handle := range input.Handles {
			if handle == "" || len(handle) > 256 {
				return
			}
		}
		for _, handle := range input.Handles {
			messages.append(changeObservation{Kind: "read_status_observed", Handle: handle, Read: input.Read})
		}
		return
	}
	if command != "bt_message" || !messages.Available {
		return
	}
	var input struct {
		Thread   string `json:"thread"`
		Handle   string `json:"handle"`
		Outgoing *bool  `json:"outgoing"`
	}
	if json.Unmarshal(event.Data, &input) != nil || input.Thread == "" || len(input.Thread) > 1024 || input.Handle == "" || len(input.Handle) > 256 || input.Outgoing == nil {
		return
	}
	if !remember(&messages.messages, input.Thread+"\x00"+input.Handle) {
		return
	}
	if remember(&messages.threads, input.Thread) {
		messages.append(changeObservation{Kind: "thread_observed", ThreadID: input.Thread})
	}
	messages.append(changeObservation{Kind: "message_observed", ThreadID: input.Thread, Handle: input.Handle, Outgoing: *input.Outgoing})
}
func (s *changeState) observeCalls(data json.RawMessage) {
	var input struct {
		Calls []callObservation `json:"calls"`
	}
	if json.Unmarshal(data, &input) != nil || input.Calls == nil || len(input.Calls) > 64 {
		return
	}
	next := make(map[string]callObservation, len(input.Calls))
	for _, c := range input.Calls {
		if c.Path == "" || len(c.Path) > 1024 || c.State == "" || len(c.State) > 64 || c.Outgoing == nil || c.Ringing == nil {
			return
		}
		if _, exists := next[c.Path]; exists {
			return
		}
		next[c.Path] = c
	}
	// Stable observation order also makes retries deterministic.
	paths := make([]string, 0, len(next))
	for path := range next {
		paths = append(paths, path)
	}
	slices.Sort(paths)
	for _, path := range paths {
		c := next[path]
		old, found := s.calls[path]
		if found && old.State == c.State && *old.Outgoing == *c.Outgoing && *old.Ringing == *c.Ringing {
			continue
		}
		kind := "call_state_observed"
		if s.callsBaseline && *c.Ringing && !*c.Outgoing && (!found || !*old.Ringing || *old.Outgoing) {
			kind = "incoming_call_ringing"
		}
		s.append(changeObservation{Kind: kind, Path: path, State: c.State, Outgoing: *c.Outgoing, InitialSynchronization: !s.callsBaseline})
	}
	removed := make([]string, 0)
	for path := range s.calls {
		if _, ok := next[path]; !ok {
			removed = append(removed, path)
		}
	}
	slices.Sort(removed)
	for _, path := range removed {
		s.append(changeObservation{Kind: "call_removed", Path: path})
	}
	if !s.callsBaseline {
		s.markDirty()
	}
	s.calls = next
	s.callsBaseline = true
}

// runCallsSeed requests a baseline without a waiter: bt_calls has no request ID,
// so an unsolicited first snapshot is equally ambiguous and must remain initial
// synchronization. Never wait for its reply on the event-reduction goroutine.
// One worker bounds sends; retry missing/failed baselines at most once per second.
func (t *Set) runCallsSeed(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.callsSeedSignals:
		case <-ticker.C:
		}
		t.mu.Lock()
		s := t.changes[CallsChangesURI]
		needed := s != nil && s.Available && !s.callsBaseline && t.callsReady() == nil
		t.mu.Unlock()
		if needed {
			sendCtx, cancel := context.WithTimeout(ctx, time.Second)
			_ = t.bus.Send(sendCtx, json.RawMessage(`{"command":"bt_list_calls"}`))
			cancel()
		}
	}
}

func (t *Set) runChangeNotifications(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.changeSignals:
		}
		var dirty []string
		t.mu.Lock()
		for _, uri := range []string{MessagesChangesURI, CallsChangesURI} {
			if s := t.changes[uri]; s != nil && s.dirty {
				s.dirty = false
				dirty = append(dirty, uri)
			}
		}
		server := t.changeServer
		t.mu.Unlock()
		if server == nil {
			continue
		}
		for _, uri := range dirty {
			if ctx.Err() != nil {
				return
			}
			_ = server.ResourceUpdated(ctx, &mcp.ResourceUpdatedNotificationParams{URI: uri})
		}
	}
}
