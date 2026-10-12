package tools

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
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
