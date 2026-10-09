package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/napisani/tether-web/internal/gateway"
	"testing"
	"time"
)

func changeEvent(t *testing.T, set *Set, data string) {
	t.Helper()
	var input struct {
		Command string `json:"command"`
	}
	if json.Unmarshal([]byte(data), &input) != nil {
		t.Fatal("bad test JSON")
	}
	set.applyStatusEvent(gateway.Event{Generation: 1, Data: json.RawMessage(data)}, input.Command)
}
func changeJSON(t *testing.T, set *Set, uri string) map[string]any {
	t.Helper()
	r, err := set.readChanges(t.Context(), &mcp.ReadResourceRequest{Params: &mcp.ReadResourceParams{URI: uri}})
	if err != nil {
		t.Fatal(err)
	}
	var w map[string]any
	if json.Unmarshal([]byte(r.Contents[0].Text), &w) != nil {
		t.Fatal("bad resource JSON")
	}
	return w
}
func TestObserverStopCallbackIsDeliveredOnStreamFailure(t *testing.T) {
	set, bus := readySet(t)
	bus.closeOnce.Do(func() { close(bus.events) })
	stopped := false
	if err := set.Run(t.Context(), func() { stopped = true }); err == nil {
		t.Fatal("observer closure did not fail closed")
	}
	if !stopped {
		t.Fatal("owner was not notified to cancel streams")
	}
}

func TestCallsSeedDoesNotBlockEventReduction(t *testing.T) {
	set, bus := readySet(t)
	entered, release := make(chan struct{}), make(chan struct{})
	bus.onSend = func(data json.RawMessage) error {
		var input struct {
			Command string `json:"command"`
		}
		_ = json.Unmarshal(data, &input)
		if input.Command == "bt_list_calls" {
			close(entered)
			<-release
		}
		return nil
	}
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan error, 1)
	go func() { done <- set.Run(ctx, nil) }()
	defer func() {
		cancel()
		close(release)
		if err := <-done; err != nil {
			t.Error(err)
		}
	}()
	for _, data := range []string{
		`{"command":"protocol_info","version":1,"capabilities":["messages","calls"]}`,
		`{"command":"bt_connection_changed","map_open":true,"calls":{"available":true}}`,
	} {
		bus.events <- gateway.Event{Generation: 1, Data: json.RawMessage(data)}
	}
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("seed was not requested")
	}
	select {
	case bus.events <- gateway.Event{Generation: 1, Data: json.RawMessage(`{"command":"bt_calls","calls":[]}`)}:
	case <-time.After(time.Second):
		t.Fatal("seed send blocked event reduction")
	}
	deadline := time.Now().Add(time.Second)
	for changeJSON(t, set, CallsChangesURI)["history_ambiguous"] != false {
		if time.Now().After(deadline) {
			t.Fatal("baseline response could not be reduced")
		}
		time.Sleep(time.Millisecond)
	}
}

func TestCallsAdvertiseAmbiguityUntilValidBaseline(t *testing.T) {
	set, _ := readySet(t)
	changeEvent(t, set, `{"command":"protocol_info","version":1,"capabilities":["messages","calls"]}`)
	changeEvent(t, set, `{"command":"bt_connection_changed","map_open":true,"calls":{"available":true}}`)
	if w := changeJSON(t, set, CallsChangesURI); w["history_ambiguous"] != true {
		t.Fatalf("unseeded calls claimed known history: %v", w)
	}
	for len(set.changeSignals) > 0 {
		<-set.changeSignals
	}
	changeEvent(t, set, `{"command":"bt_calls","calls":[]}`)
	if len(set.changeSignals) == 0 {
		t.Fatal("baseline readiness transition did not invalidate resource")
	}
	if w := changeJSON(t, set, CallsChangesURI); w["history_ambiguous"] != false {
		t.Fatalf("valid baseline still ambiguous: %v", w)
	}
}

func TestIncomingCallTransitionsSuppressBaselineAndRepeatedSnapshots(t *testing.T) {
	set, _ := readySet(t)
	changeEvent(t, set, `{"command":"protocol_info","version":1,"capabilities":["messages","calls"]}`)
	changeEvent(t, set, `{"command":"bt_connection_changed","map_open":true,"calls":{"available":true}}`)
	changeEvent(t, set, `{"command":"bt_calls","calls":[{"path":"/call/1","state":"incoming","ringing":true,"outgoing":false}]}`)
	baseline := changeJSON(t, set, CallsChangesURI)
	for _, o := range baseline["observations"].([]any) {
		if o.(map[string]any)["kind"] == "incoming_call_ringing" {
			t.Fatal("initial snapshot triggered incoming action")
		}
	}
	changeEvent(t, set, `{"command":"bt_calls","calls":[]}`)
	changeEvent(t, set, `{"command":"bt_calls","calls":[{"path":"/call/2","state":"incoming","ringing":true,"outgoing":false},{"path":"/call/3","state":"incoming","ringing":true,"outgoing":true}]}`)
	w := changeJSON(t, set, CallsChangesURI)
	incoming := 0
	for _, o := range w["observations"].([]any) {
		if o.(map[string]any)["kind"] == "incoming_call_ringing" {
			incoming++
			if o.(map[string]any)["path"] != "/call/2" {
				t.Fatalf("wrong call: %v", o)
			}
		}
	}
	if incoming != 1 {
		t.Fatalf("incoming observations = %d, window=%v", incoming, w)
	}
	changeEvent(t, set, `{"command":"bt_calls","calls":[{"path":"/call/2","state":"incoming","ringing":true,"outgoing":false},{"path":"/call/3","state":"incoming","ringing":true,"outgoing":true}]}`)
	if after := changeJSON(t, set, CallsChangesURI); after["revision"] != w["revision"] {
		t.Fatalf("identical read/push changed resource: %v", after)
	}
	changeEvent(t, set, `{"command":"bt_calls","calls":[{"path":"/call/2","state":"active","ringing":false,"outgoing":false}]}`)
	if after := changeJSON(t, set, CallsChangesURI); after["revision"] == w["revision"] {
		t.Fatal("state/removal did not change resource")
	}
}
func TestChangeContextClearedOnLifecycleBoundaries(t *testing.T) {
	for _, event := range []string{
		`{"command":"bt_connection_changed","map_open":false}`,
		`{"command":"bt_status","available":true,"device_address":"phone-B","retention":"encrypted"}`,
		`{"command":"bt_status","available":true,"device_address":"phone-A","retention":"none"}`,
		`{"command":"gateway_status","daemon_connected":false}`,
	} {
		t.Run(event, func(t *testing.T) {
			set, _ := readySet(t)
			changeEvent(t, set, `{"command":"bt_status","available":true,"device_address":"phone-A","retention":"encrypted"}`)
			changeEvent(t, set, `{"command":"bt_message","thread":"t","handle":"h","outgoing":false}`)
			before := changeJSON(t, set, MessagesChangesURI)
			changeEvent(t, set, event)
			after := changeJSON(t, set, MessagesChangesURI)
			if after["epoch"] == before["epoch"] || len(after["observations"].([]any)) != 0 {
				t.Fatalf("sensitive context survived: before=%v after=%v", before, after)
			}
		})
	}
}
func TestBoundedChangeWindowAdvertisesCursorGap(t *testing.T) {
	set, _ := readySet(t)
	for i := 0; i < 200; i++ {
		changeEvent(t, set, fmt.Sprintf(`{"command":"bt_message","thread":"t","handle":"h%d","outgoing":true}`, i))
	}
	w := changeJSON(t, set, MessagesChangesURI)
	if len(w["observations"].([]any)) != 128 || w["oldest_revision"] == nil || w["cursor"] != w["revision"] || w["history_ambiguous"] != true {
		t.Fatalf("missing bounded window/cursor semantics: %v", w)
	}
	if w["oldest_revision"].(float64) <= 1 {
		t.Fatal("eviction did not advertise gap")
	}
}
func TestReadStatusInvalidatesOnlySuccessfulIdentifiableMutation(t *testing.T) {
	set, _ := readySet(t)
	before := changeJSON(t, set, MessagesChangesURI)
	changeEvent(t, set, `{"command":"bt_message_read","handles":["h"],"read":true,"success":false}`)
	if w := changeJSON(t, set, MessagesChangesURI); w["revision"] != before["revision"] {
		t.Fatal("failed write looked like mutation")
	}
	changeEvent(t, set, `{"command":"bt_message_read","handles":["h"],"read":true,"success":true}`)
	w := changeJSON(t, set, MessagesChangesURI)
	if w["revision"] == before["revision"] || w["observations"].([]any)[0].(map[string]any)["handle"] != "h" {
		t.Fatalf("successful read mutation missing: %v", w)
	}
}
func TestChangeReadCannotExposePriorGeneration(t *testing.T) {
	set, bus := readySet(t)
	changeEvent(t, set, `{"command":"bt_message","thread":"private","handle":"h","outgoing":false}`)
	before := changeJSON(t, set, MessagesChangesURI)
	bus.mu.Lock()
	bus.generation++
	bus.mu.Unlock()
	after := changeJSON(t, set, MessagesChangesURI)
	if after["available"] != false || len(after["observations"].([]any)) != 0 || after["epoch"] == before["epoch"] {
		t.Fatalf("stale generation resource exposed: %v", after)
	}
	changeEvent(t, set, `{"command":"bt_message","thread":"late","handle":"h2","outgoing":false}`)
	if w := changeJSON(t, set, MessagesChangesURI); len(w["observations"].([]any)) != 0 {
		t.Fatal("late generation accepted")
	}
}
func TestChangeReadDoesNotMutateOrSignalOnStaleGeneration(t *testing.T) {
	set, bus := readySet(t)
	changeEvent(t, set, `{"command":"bt_message","thread":"private","handle":"h","outgoing":false}`)
	s := set.changes[MessagesChangesURI]
	epoch, revision := s.Epoch, s.Revision
	for len(set.changeSignals) > 0 {
		<-set.changeSignals
	}
	s.dirty = false
	bus.mu.Lock()
	bus.generation++
	bus.mu.Unlock()
	for i := 0; i < 3; i++ {
		changeJSON(t, set, MessagesChangesURI)
	}
	if s.Epoch != epoch || s.Revision != revision || s.dirty || len(set.changeSignals) != 0 {
		t.Fatal("resource reads mutated reducer state or scheduled notifications")
	}
}

func TestMalformedEventsCannotMutateChangeContext(t *testing.T) {
	set, _ := readySet(t)
	changeEvent(t, set, `{"command":"bt_message","thread":"t","handle":"h","outgoing":false}`)
	before := changeJSON(t, set, MessagesChangesURI)
	for _, data := range []string{
		`{"command":"bt_message","thread":"t","handle":"missing-direction"}`,
		`{"command":"bt_message","thread":5,"handle":"wrong-type","outgoing":false}`,
		`{"command":"bt_connection_changed"}`,
		`{"command":"bt_status","available":"true","device_address":"wrong"}`,
		`{"command":"bt_messages","thread":"t","messages":[]}`,
		`{"command":"bt_threads","threads":[]}`,
	} {
		changeEvent(t, set, data)
	}
	after := changeJSON(t, set, MessagesChangesURI)
	if before["epoch"] != after["epoch"] || before["revision"] != after["revision"] || !after["available"].(bool) {
		t.Fatalf("malformed/read events invalidated: before=%v after=%v", before, after)
	}
}
func TestIncomingCallUsesDaemonRingingFlagNotInventedState(t *testing.T) {
	set, _ := readySet(t)
	changeEvent(t, set, `{"command":"protocol_info","version":1,"capabilities":["messages","calls"]}`)
	changeEvent(t, set, `{"command":"bt_connection_changed","map_open":true,"calls":{"available":true}}`)
	changeEvent(t, set, `{"command":"bt_calls","calls":[]}`)
	changeEvent(t, set, `{"command":"bt_calls","calls":[{"path":"/call/authentic","state":"incoming","ringing":false,"outgoing":false}]}`)
	before := changeJSON(t, set, CallsChangesURI)
	changeEvent(t, set, `{"command":"bt_calls","calls":[{"path":"/call/authentic","state":"incoming","ringing":true,"outgoing":false}]}`)
	after := changeJSON(t, set, CallsChangesURI)
	if after["revision"] == before["revision"] {
		t.Fatalf("real daemon ringing transition ignored: %v", after)
	}
	observations := after["observations"].([]any)
	if observations[len(observations)-1].(map[string]any)["kind"] != "incoming_call_ringing" {
		t.Fatalf("real incoming call missing: %v", after)
	}
}

func TestPhoneIdentityChangeWaitsForFreshProfileReadiness(t *testing.T) {
	set, _ := readySet(t)
	changeEvent(t, set, `{"command":"bt_status","available":true,"device_address":"A"}`)
	changeEvent(t, set, `{"command":"bt_message","thread":"A-thread","handle":"A-h","outgoing":false}`)
	changeEvent(t, set, `{"command":"bt_status","available":true,"device_address":"B"}`)
	changeEvent(t, set, `{"command":"bt_message","thread":"ambiguous","handle":"late","outgoing":false}`)
	w := changeJSON(t, set, MessagesChangesURI)
	if w["available"] != false || len(w["observations"].([]any)) != 0 {
		t.Fatalf("previous phone readiness reused: %v", w)
	}
	changeEvent(t, set, `{"command":"bt_connection_changed","map_open":true}`)
	changeEvent(t, set, `{"command":"bt_message","thread":"B-thread","handle":"B-h","outgoing":false}`)
	if w := changeJSON(t, set, MessagesChangesURI); w["available"] != true || len(w["observations"].([]any)) != 2 {
		t.Fatalf("fresh phone unavailable: %v", w)
	}
}
