package tools

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/napisani/tether-web/internal/gateway"
)

func TestHistoryBoundsAndUnknownEmpty(t *testing.T) {
	p := newParity(t)
	p.answers["bt_list_calls"] = func(map[string]any) []map[string]any {
		return []map[string]any{{"command": "bt_calls", "calls": []any{}}}
	}
	entries := make([]map[string]any, 101)
	for i := range entries {
		entries[i] = map[string]any{"number": strings.Repeat("n", 140), "name": strings.Repeat("a", 300), "type": strings.Repeat("t", 80), "timestamp": 123}
	}
	p.answers["bt_list_call_history"] = func(map[string]any) []map[string]any {
		return []map[string]any{{"command": "bt_call_history", "calls": entries}}
	}
	_, result, err := p.set.listCalls(t.Context(), nil, struct{}{})
	if err != nil || len(result.History.Calls) != 100 || !result.History.Truncated || result.History.Availability != "available" || len(result.History.Calls[0].Name) != 256 || len(result.History.Calls[0].Number) != 128 || len(result.History.Calls[0].Type) != 64 {
		t.Fatalf("bounds: %+v %v", result.History, err)
	}
	entries = []map[string]any{}
	_, result, err = p.set.listCalls(t.Context(), nil, struct{}{})
	if err != nil || result.History.Availability != "unknown" || result.History.Reason == "" || result.History.Calls == nil {
		t.Fatalf("empty cannot confirm availability: %+v %v", result.History, err)
	}
}
func TestHistoryUnavailableAndSilentDaemon(t *testing.T) {
	p := newParity(t)
	p.answers["bt_list_calls"] = func(map[string]any) []map[string]any {
		return []map[string]any{{"command": "bt_calls", "calls": []any{}}}
	}
	p.feed(map[string]any{"command": "bt_connection_changed", "pbap_open": false, "pbap_error": "denied", "calls": map[string]any{"available": true}})
	_, result, err := p.set.listCalls(t.Context(), nil, struct{}{})
	if err != nil || result.History.Availability != "unavailable" || !strings.Contains(result.History.Reason, "denied") || p.count("bt_list_call_history") != 0 {
		t.Fatalf("PBAP: %+v %v", result.History, err)
	}
	p.feed(openConnection())
	previous := readTimeout
	readTimeout = 10 * time.Millisecond
	t.Cleanup(func() { readTimeout = previous })
	_, result, err = p.set.listCalls(t.Context(), nil, struct{}{})
	if err != nil || result.History.Availability != "unavailable" || !strings.Contains(result.History.Reason, "did not reply") {
		t.Fatalf("old daemon: %+v %v", result.History, err)
	}
}
func TestSilentHistoryPreservesLiveCallsBeforeCallerDeadline(t *testing.T) {
	p := newParity(t)
	p.answers["bt_list_calls"] = func(map[string]any) []map[string]any {
		return []map[string]any{{"command": "bt_calls", "calls": []map[string]any{{"path": "/call/live", "state": "active"}}}}
	}
	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	_, result, err := p.set.listCalls(ctx, nil, struct{}{})
	if err != nil || ctx.Err() != nil || len(result.Calls) != 1 || result.Calls[0].Path != "/call/live" || result.Status == nil || result.History.Availability != "unavailable" || result.History.Reason == "" || p.count("bt_list_call_history") != 1 {
		t.Fatalf("silent optional history hid live calls: %+v, lookup error %v, caller error %v", result, err, ctx.Err())
	}
}

func TestHistoryDisconnectDoesNotReturnPriorLiveCalls(t *testing.T) {
	p := newParity(t)
	p.answers["bt_list_calls"] = func(map[string]any) []map[string]any {
		return []map[string]any{{"command": "bt_calls", "calls": []any{}}}
	}
	p.answers["bt_list_call_history"] = func(map[string]any) []map[string]any {
		p.set.applyStatusEvent(gatewayStatus(2, false), "gateway_status")
		return nil
	}
	if _, _, err := p.set.listCalls(t.Context(), nil, struct{}{}); err == nil {
		t.Fatal("disconnected lookup returned stale state")
	}
}
func TestHistoryLinkLossCannotReturnContent(t *testing.T) {
	p := newParity(t)
	p.answers["bt_list_calls"] = func(map[string]any) []map[string]any {
		return []map[string]any{{"command": "bt_calls", "calls": []any{}}}
	}
	p.answers["bt_list_call_history"] = func(map[string]any) []map[string]any {
		return []map[string]any{
			{"command": "bt_connection_changed", "pbap_open": false, "calls": map[string]any{"available": true}},
			{"command": "bt_call_history", "calls": []map[string]any{{"name": "stale", "number": "123", "type": "missed", "timestamp": 123}}},
		}
	}
	_, result, err := p.set.listCalls(t.Context(), nil, struct{}{})
	if err != nil || result.History.Availability != "unavailable" || len(result.History.Calls) != 0 {
		t.Fatalf("stale history after PBAP loss: %+v %v", result.History, err)
	}
}
func TestHistoryWithoutHFP(t *testing.T) {
	p := newParity(t)
	p.feed(map[string]any{"command": "bt_connection_changed", "pbap_open": true, "calls": map[string]any{"available": false}})
	p.answers["bt_list_call_history"] = func(map[string]any) []map[string]any {
		return []map[string]any{{"command": "bt_call_history", "calls": []any{}}}
	}
	_, result, err := p.set.listCalls(t.Context(), nil, struct{}{})
	if err != nil || result.History.Availability != "unknown" || p.count("bt_list_calls") != 0 {
		t.Fatalf("PBAP must not depend on HFP: %+v %v", result, err)
	}
}

// Snapshot is already the readiness seam. Change profile state at the second
// initial readiness check, after live readiness passed but before its recheck.
// The fixture does not run Set.Run; all access happens synchronously under mu.
type historyReadinessBus struct {
	gateway.Bus
	checks int
	change func()
}

func (b *historyReadinessBus) Snapshot() gateway.Snapshot {
	b.checks++
	if b.checks == 2 {
		b.change()
	}
	return b.Bus.Snapshot()
}

func TestHistorySurvivesHFPReadinessLoss(t *testing.T) {
	p := newParity(t)
	p.set.bus = &historyReadinessBus{Bus: p.bus, change: func() {
		p.set.connection.Calls.Available = false
		p.set.connection.Calls.Reason = "HFP closed"
	}}
	p.answers["bt_list_call_history"] = func(map[string]any) []map[string]any {
		return []map[string]any{{"command": "bt_call_history", "calls": []map[string]any{{"name": "Ada", "number": "123", "type": "missed", "timestamp": 123}}}}
	}
	_, result, err := p.set.listCalls(t.Context(), nil, struct{}{})
	if err != nil || len(result.Calls) != 0 || result.Status == nil || result.Status.Available || result.Status.Reason != "HFP closed" || result.History.Availability != "available" || len(result.History.Calls) != 1 || result.History.Calls[0].Name != "Ada" || p.count("bt_list_calls") != 0 || p.count("bt_list_call_history") != 1 {
		t.Fatalf("HFP readiness loss hid PBAP history: %+v %v", result, err)
	}
}

func TestHFPReadinessLossCannotBypassHistoryGuards(t *testing.T) {
	for _, scenario := range []string{"PBAP closed", "caller cancelled", "disconnected", "generation changed", "capability lost"} {
		t.Run(scenario, func(t *testing.T) {
			p := newParity(t)
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			p.set.bus = &historyReadinessBus{Bus: p.bus, change: func() {
				p.set.connection.Calls.Available = false
				switch scenario {
				case "PBAP closed":
					p.set.connection.PBAPOpen = false
				case "caller cancelled":
					cancel()
				case "disconnected":
					p.bus.mu.Lock()
					p.bus.isReady = false
					p.bus.mu.Unlock()
				case "generation changed":
					p.set.generation++
					p.bus.mu.Lock()
					p.bus.generation++
					p.bus.mu.Unlock()
				case "capability lost":
					p.set.protocol.Capabilities = []string{}
				}
			}}
			if _, _, err := p.set.listCalls(ctx, nil, struct{}{}); err == nil || p.count("bt_list_call_history") != 0 {
				t.Fatalf("%s bypassed history guards: %v", scenario, err)
			}
		})
	}
}

func TestLiveTransportFailureWithHFPLossIsNotSwallowed(t *testing.T) {
	p := newParity(t)
	transportErr := errors.New("broken transport")
	p.bus.onSend = func(json.RawMessage) error {
		p.feed(map[string]any{"command": "bt_connection_changed", "pbap_open": true, "calls": map[string]any{"available": false}})
		return transportErr
	}
	if _, _, err := p.set.listCalls(t.Context(), nil, struct{}{}); !errors.Is(err, transportErr) || p.bus.sends != 1 {
		t.Fatalf("transport failure swallowed: %v, sends %d", err, p.bus.sends)
	}
}

func TestOptionalHistoryRetainsCallerAndGenerationGuards(t *testing.T) {
	for _, scenario := range []string{"caller cancelled", "generation changed"} {
		t.Run(scenario, func(t *testing.T) {
			p := newParity(t)
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			p.answers["bt_list_calls"] = func(map[string]any) []map[string]any {
				return []map[string]any{{"command": "bt_calls", "calls": []map[string]any{{"path": "/call/live"}}}}
			}
			p.answers["bt_list_call_history"] = func(map[string]any) []map[string]any {
				if scenario == "caller cancelled" {
					cancel()
				} else {
					p.bus.mu.Lock()
					p.bus.generation = 2
					p.bus.mu.Unlock()
					p.set.applyStatusEvent(gatewayStatus(2, true), "gateway_status")
				}
				return nil
			}
			if _, _, err := p.set.listCalls(ctx, nil, struct{}{}); err == nil {
				t.Fatalf("%s returned stale live results", scenario)
			}
		})
	}
}

func TestOptionalFavoriteMetadataPreservesOrder(t *testing.T) {
	p := newParity(t)
	p.answers["bt_list_contacts"] = func(map[string]any) []map[string]any {
		return []map[string]any{{"command": "bt_contacts", "query": "", "contacts": []map[string]any{
			{"name": "Zoe", "addresses": []string{}, "favorite": true},
			{"name": "Ada", "addresses": []string{}, "favorite": false},
			{"name": "Legacy", "addresses": []string{}},
		}}}
	}
	_, result, err := p.set.searchContacts(t.Context(), nil, searchContactsInput{})
	if err != nil || len(result.Contacts) != 3 || result.Contacts[0].Name != "Zoe" || result.Contacts[0].Favorite == nil || !*result.Contacts[0].Favorite || result.Contacts[1].Favorite == nil || *result.Contacts[1].Favorite || result.Contacts[2].Favorite != nil {
		t.Fatalf("favorite compatibility: %+v %v", result, err)
	}
}
func TestRecentHistoryAndFavorites(t *testing.T) {
	p := newParity(t)
	p.answers["bt_list_calls"] = func(map[string]any) []map[string]any {
		return []map[string]any{{"command": "bt_calls", "calls": []any{}}}
	}
	p.answers["bt_list_call_history"] = func(map[string]any) []map[string]any {
		return []map[string]any{{"command": "bt_call_history", "calls": []map[string]any{{"name": "Ada", "number": "123", "type": "missed", "timestamp": 123}}}}
	}
	_, result, err := p.set.listCalls(t.Context(), nil, struct{}{})
	data, _ := json.Marshal(result)
	var fields map[string]json.RawMessage
	json.Unmarshal(data, &fields)
	if err != nil || fields["history"] == nil {
		t.Fatalf("history missing: %s %v", data, err)
	}
	p.answers["bt_list_contacts"] = func(map[string]any) []map[string]any {
		return []map[string]any{{"command": "bt_contacts", "query": "", "contacts": []map[string]any{{"name": "Ada", "addresses": []string{"tel:123"}, "favorite": true}}}}
	}
	_, contacts, err := p.set.searchContacts(t.Context(), nil, searchContactsInput{})
	data, _ = json.Marshal(contacts)
	var decoded struct{ Contacts []struct{ Favorite bool } }
	json.Unmarshal(data, &decoded)
	if err != nil || !decoded.Contacts[0].Favorite {
		t.Fatalf("favorite missing: %s %v", data, err)
	}
}
