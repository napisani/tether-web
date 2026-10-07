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

var allCapabilities = []string{
	"airpods", "bluetooth.connection", "bluetooth.pairing", "calls", "contacts", "files",
	"messages", "notifications", "peers", "settings",
}

func connectedStatus() map[string]any {
	return map[string]any{
		"command": "bt_status", "available": true, "enabled": true, "device_address": "AA:BB",
		"ancs_enabled": true, "ancs_content_enabled": false, "calls_enabled": true, "retention": "encrypted",
		"airpods_enabled": true, "airpods_pause": "never", "airpods_handoff": false,
	}
}

func openConnection() map[string]any {
	return map[string]any{
		"command": "bt_connection_changed", "map_open": true, "pbap_open": true, "ancs_ready": true,
		"calls": map[string]any{"available": true, "audio": "idle"},
	}
}

// parity builds a tool set with every capability and profile ready, and a
// fake bus whose answers each test scripts by command name.
type parity struct {
	t       *testing.T
	set     *Set
	bus     *testBus
	sent    []map[string]any
	answers map[string]func(command map[string]any) []map[string]any
}

func newParity(t *testing.T) *parity {
	t.Helper()
	bus := &testBus{generation: 1, isReady: true, events: make(chan gateway.Event)}
	set, err := New(bus, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(set.Close)
	p := &parity{t: t, set: set, bus: bus, answers: map[string]func(map[string]any) []map[string]any{}}
	p.feed(map[string]any{"command": "protocol_info", "version": 1, "capabilities": allCapabilities})
	p.feed(connectedStatus())
	p.feed(openConnection())
	bus.onSend = func(data json.RawMessage) error {
		var command map[string]any
		if err := json.Unmarshal(data, &command); err != nil {
			t.Error(err)
			return nil
		}
		p.sent = append(p.sent, command)
		if answer := p.answers[command["command"].(string)]; answer != nil {
			for _, event := range answer(command) {
				p.feed(event)
			}
		}
		return nil
	}
	return p
}

func (p *parity) feed(event map[string]any) {
	p.t.Helper()
	data, err := json.Marshal(event)
	if err != nil {
		p.t.Fatal(err)
	}
	p.set.applyStatusEvent(gateway.Event{Generation: 1, Data: data}, event["command"].(string))
}

func (p *parity) count(command string) int {
	n := 0
	for _, sent := range p.sent {
		if sent["command"] == command {
			n++
		}
	}
	return n
}

func (p *parity) last(command string) map[string]any {
	for i := len(p.sent) - 1; i >= 0; i-- {
		if p.sent[i]["command"] == command {
			return p.sent[i]
		}
	}
	p.t.Fatalf("no %s command was sent", command)
	return nil
}

func (p *parity) operation(id string) operationResult {
	p.t.Helper()
	_, result, err := p.set.getOperation(context.Background(), nil, operationInput{OperationID: id})
	if err != nil {
		p.t.Fatal(err)
	}
	return result
}

func (p *parity) wantStatus(result operationResult, want operationStatus) {
	p.t.Helper()
	if result.Status != want {
		p.t.Fatalf("status = %q (%s), want %q", result.Status, result.Message, want)
	}
}

func TestListThreadsFiltersBoundsAndIgnoresOtherReplies(t *testing.T) {
	p := newParity(t)
	p.answers["bt_list_threads"] = func(map[string]any) []map[string]any {
		return []map[string]any{
			{"command": "bt_messages", "thread": "tel:1", "messages": []any{}},
			{"command": "bt_threads", "threads": []map[string]any{
				{"thread": "tel:1", "name": "Alex Doe", "preview": "lunch?", "repliable": true},
				{"thread": "tel:2", "name": "Sam", "preview": "see you at lunch"},
				{"thread": "tel:3", "name": "Pat", "preview": "ok"},
			}},
		}
	}
	_, all, err := p.set.listThreads(t.Context(), nil, listThreadsInput{})
	if err != nil || all.Total != 3 || len(all.Threads) != 3 || all.Truncated {
		t.Fatalf("all threads = %+v, error = %v", all, err)
	}
	_, found, err := p.set.listThreads(t.Context(), nil, listThreadsInput{Search: "LUNCH", Limit: 1})
	if err != nil || found.Total != 2 || len(found.Threads) != 1 || !found.Truncated || found.Threads[0].Thread != "tel:1" {
		t.Fatalf("filtered threads = %+v, error = %v", found, err)
	}
}

func TestListMessagesMatchesThreadOrdersAndBounds(t *testing.T) {
	p := newParity(t)
	p.answers["bt_list_messages"] = func(command map[string]any) []map[string]any {
		return []map[string]any{
			{"command": "bt_messages", "thread": "tel:other", "messages": []map[string]any{{"handle": "x", "body": "wrong", "timestamp": 1}}},
			{"command": "bt_messages", "thread": command["thread"], "messages": []map[string]any{
				{"handle": "h3", "body": "third", "timestamp": 30},
				{"handle": "h1", "body": "first", "timestamp": 10, "outgoing": true},
				{"handle": "h2", "body": strings.Repeat("x", maxMessageBodyBytes+10), "timestamp": 20},
			}},
		}
	}
	_, result, err := p.set.listMessages(t.Context(), nil, listMessagesInput{ThreadID: "tel:1", Limit: 2})
	if err != nil || result.Total != 3 || !result.Truncated || len(result.Messages) != 2 ||
		result.Messages[0].Handle != "h2" || result.Messages[1].Handle != "h3" ||
		len(result.Messages[0].Body) != maxMessageBodyBytes {
		t.Fatalf("messages = %+v, error = %v", result, err)
	}
	if _, _, err := p.set.listMessages(t.Context(), nil, listMessagesInput{ThreadID: " "}); err == nil {
		t.Fatal("blank thread accepted")
	}
}

func TestSearchContactsMatchesQueryAndBounds(t *testing.T) {
	p := newParity(t)
	p.answers["bt_list_contacts"] = func(command map[string]any) []map[string]any {
		if command["limit"] != float64(3) {
			t.Errorf("limit asked of tetherd = %v, want one extra", command["limit"])
		}
		return []map[string]any{
			{"command": "bt_contacts", "query": "someone else", "contacts": []map[string]any{{"name": "Wrong", "addresses": []string{"tel:0"}}}},
			{"command": "bt_contacts", "query": command["query"], "contacts": []map[string]any{
				{"name": "A", "addresses": []string{"tel:1"}}, {"name": "B", "addresses": []string{"tel:2"}}, {"name": "C", "addresses": []string{"tel:3"}},
			}},
		}
	}
	_, result, err := p.set.searchContacts(t.Context(), nil, searchContactsInput{Query: "a", Limit: 2})
	if err != nil || len(result.Contacts) != 2 || !result.Truncated || result.Contacts[0].Name != "A" {
		t.Fatalf("contacts = %+v, error = %v", result, err)
	}
}

func TestReadsRefuseUnavailableProfilesWithoutSending(t *testing.T) {
	p := newParity(t)
	p.feed(map[string]any{"command": "bt_connection_changed", "map_open": false, "pbap_open": false, "ancs_ready": false,
		"map_error": "forbidden", "pbap_error": "no_record", "ancs_reason": "no ANCS", "calls": map[string]any{"available": false, "reason": "no HFP"}})
	sent := len(p.sent)
	_, _, threadsErr := p.set.listThreads(t.Context(), nil, listThreadsInput{})
	_, _, contactsErr := p.set.searchContacts(t.Context(), nil, searchContactsInput{Query: "a"})
	_, _, notificationsErr := p.set.listNotifications(t.Context(), nil, listNotificationsInput{})
	_, _, callsErr := p.set.listCalls(t.Context(), nil, struct{}{})
	for name, err := range map[string]error{"threads": threadsErr, "contacts": contactsErr, "notifications": notificationsErr, "calls": callsErr} {
		if err == nil {
			t.Fatalf("%s read was allowed with its profile closed", name)
		}
	}
	for want, err := range map[string]error{"forbidden": threadsErr, "no_record": contactsErr, "no ANCS": notificationsErr, "no HFP": callsErr} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("error %q lacks reason %q", err, want)
		}
	}
	if len(p.sent) != sent {
		t.Fatal("an unavailable read still sent a command")
	}
}

func TestReadsRefuseMissingCapability(t *testing.T) {
	p := newParity(t)
	p.feed(map[string]any{"command": "protocol_info", "version": 1, "capabilities": []string{"messages"}})
	if _, _, err := p.set.listCalls(t.Context(), nil, struct{}{}); err == nil || !strings.Contains(err.Error(), "calls") {
		t.Fatalf("missing capability error = %v", err)
	}
}

func TestReadTimeoutAndDisconnect(t *testing.T) {
	p := newParity(t)
	previous := readTimeout
	readTimeout = 20 * time.Millisecond
	t.Cleanup(func() { readTimeout = previous })
	if _, _, err := p.set.listThreads(t.Context(), nil, listThreadsInput{}); err == nil || !strings.Contains(err.Error(), "did not reply") {
		t.Fatalf("silent daemon error = %v", err)
	}
	readTimeout = 5 * time.Second
	p.answers["bt_list_threads"] = func(map[string]any) []map[string]any {
		p.set.applyStatusEvent(gateway.Event{Generation: 2, Data: json.RawMessage(`{"command":"gateway_status","daemon_connected":false}`)}, "gateway_status")
		return nil
	}
	if _, _, err := p.set.listThreads(t.Context(), nil, listThreadsInput{}); err == nil || !strings.Contains(err.Error(), "lost") {
		t.Fatalf("disconnect error = %v", err)
	}
}

func TestReadSendFailureIsAnError(t *testing.T) {
	p := newParity(t)
	p.bus.onSend = func(json.RawMessage) error { return errors.New("socket closed") }
	if _, _, err := p.set.listThreads(t.Context(), nil, listThreadsInput{}); err == nil {
		t.Fatal("send failure was hidden")
	}
	if len(p.set.waiters) != 0 {
		t.Fatal("waiter leaked after a failed read")
	}
}

func TestListDevicesNotificationsCallsAndPeers(t *testing.T) {
	p := newParity(t)
	p.answers["bt_list_devices"] = func(map[string]any) []map[string]any {
		return []map[string]any{{"command": "bt_devices", "devices": []map[string]any{{"address": "AA:BB", "name": "iPhone", "iphone": true, "paired": true}}}}
	}
	p.answers["bt_list_notifications"] = func(map[string]any) []map[string]any {
		return []map[string]any{{"command": "bt_notifications", "notifications": []map[string]any{{"uid": 7, "title": "Hi", "negative_action": true}}}}
	}
	p.answers["bt_list_calls"] = func(map[string]any) []map[string]any {
		return []map[string]any{{"command": "bt_calls", "calls": []map[string]any{{"path": "/call/1", "number": "+15550100", "ringing": true}}}}
	}
	p.answers["state_snapshot"] = func(map[string]any) []map[string]any {
		return []map[string]any{{"command": "state_snapshot", "paired_devices": []map[string]any{{"fingerprint": "fp1", "device_name": "Laptop"}},
			"pending_pairs": []any{}, "connected_clients": []any{}, "discovered_devices": []any{}, "mdns_available": true, "firewall_active": false}}
	}
	_, devices, err := p.set.listBluetoothDevices(t.Context(), nil, struct{}{})
	if err != nil || len(devices.Devices) != 1 || !devices.Devices[0].IPhone {
		t.Fatalf("devices = %+v, error = %v", devices, err)
	}
	_, notifications, err := p.set.listNotifications(t.Context(), nil, listNotificationsInput{})
	if err != nil || len(notifications.Notifications) != 1 || notifications.Notifications[0].UID != 7 {
		t.Fatalf("notifications = %+v, error = %v", notifications, err)
	}
	_, calls, err := p.set.listCalls(t.Context(), nil, struct{}{})
	if err != nil || len(calls.Calls) != 1 || calls.Status == nil || calls.Status.Audio != "idle" {
		t.Fatalf("calls = %+v, error = %v", calls, err)
	}
	_, peers, err := p.set.listPeers(t.Context(), nil, struct{}{})
	if err != nil || len(peers.PairedDevices) != 1 || peers.PendingPairs == nil || peers.DiscoveredDevices == nil || !peers.MDNSAvailable {
		t.Fatalf("peers = %+v, error = %v", peers, err)
	}
}

func TestGetSettingsAndAirPodsReadFreshState(t *testing.T) {
	p := newParity(t)
	p.answers["bt_status"] = func(map[string]any) []map[string]any {
		status := connectedStatus()
		status["retention"] = "plaintext"
		return []map[string]any{status}
	}
	p.answers["bt_airpods"] = func(map[string]any) []map[string]any {
		return []map[string]any{{"command": "bt_airpods", "address": "CC:DD", "name": "Pods", "status": "live", "anc": "adaptive",
			"left": 80, "right": 70, "case": 50, "reason": "", "ear": map[string]any{"primary": "in_ear", "secondary": "in_ear"}}}
	}
	_, settings, err := p.set.getSettings(t.Context(), nil, struct{}{})
	if err != nil || settings.Retention != "plaintext" || settings.ANCSEnabled == nil || !*settings.ANCSEnabled {
		t.Fatalf("settings = %+v, error = %v", settings, err)
	}
	_, pods, err := p.set.getAirPods(t.Context(), nil, struct{}{})
	if err != nil || pods.AirPods.Status != "live" || pods.AirPods.ANC != "adaptive" || pods.AirPods.Ear.Primary != "in_ear" ||
		pods.Managed == nil || !*pods.Managed || pods.AutoPause != "never" {
		t.Fatalf("airpods = %+v, error = %v", pods, err)
	}
}

func gatewayStatus(generation uint64, connected bool) gateway.Event {
	data, _ := json.Marshal(map[string]any{"command": "gateway_status", "daemon_connected": connected})
	return gateway.Event{Generation: generation, Data: data}
}

func jsonMarshal(value any) (json.RawMessage, error) { return json.Marshal(value) }

func eventAt(generation uint64, data json.RawMessage) gateway.Event {
	return gateway.Event{Generation: generation, Data: data}
}
