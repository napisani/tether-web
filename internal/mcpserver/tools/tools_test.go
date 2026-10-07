package tools

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/napisani/tether-web/internal/gateway"
)

type testBus struct {
	mu         sync.Mutex
	generation uint64
	isReady    bool
	sends      int
	onSend     func(json.RawMessage) error
	events     chan gateway.Event
	closeOnce  sync.Once
}

func (b *testBus) Send(_ context.Context, data json.RawMessage) error {
	b.mu.Lock()
	b.sends++
	callback := b.onSend
	b.mu.Unlock()
	if callback != nil {
		return callback(data)
	}
	return nil
}

func (b *testBus) Snapshot() gateway.Snapshot {
	b.mu.Lock()
	defer b.mu.Unlock()
	return gateway.Snapshot{DaemonConnected: b.isReady, Generation: b.generation, Events: map[string]json.RawMessage{
		"bt_status":             json.RawMessage(`{"command":"bt_status","available":true,"device_address":"previous-phone"}`),
		"bt_connection_changed": json.RawMessage(`{"command":"bt_connection_changed","map_open":true}`),
		"protocol_info":         json.RawMessage(`{"command":"protocol_info","version":1,"capabilities":["messages"]}`),
	}}
}

func (b *testBus) Ready() bool { return b.Snapshot().DaemonConnected }

func (b *testBus) Subscribe(*uint64) (gateway.Subscription, error) {
	return gateway.Subscription{Snapshot: b.Snapshot(), Events: b.events, Close: func() {
		b.closeOnce.Do(func() { close(b.events) })
	}}, nil
}

func readySet(t *testing.T) (*Set, *testBus) {
	t.Helper()
	bus := &testBus{generation: 1, isReady: true, events: make(chan gateway.Event)}
	set, err := New(bus)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(set.Close)
	for _, event := range []string{
		`{"command":"protocol_info","version":1,"capabilities":["messages"]}`,
		`{"command":"bt_status","available":true,"enabled":true}`,
		`{"command":"bt_connection_changed","map_open":true}`,
	} {
		var input struct{ Command string }
		if err := json.Unmarshal([]byte(event), &input); err != nil {
			t.Fatal(err)
		}
		set.applyStatusEvent(gateway.Event{Generation: 1, Data: json.RawMessage(event)}, input.Command)
	}
	return set, bus
}

func TestNewIgnoresRetainedPhoneSnapshot(t *testing.T) {
	bus := &testBus{generation: 1, isReady: true, events: make(chan gateway.Event)}
	set, err := New(bus)
	if err != nil {
		t.Fatal(err)
	}
	defer set.Close()
	_, output, err := set.getStatus(t.Context(), nil, struct{}{})
	if err != nil || output.MetadataReady || output.Bluetooth != nil || output.Connection != nil || len(output.Capabilities) != 0 {
		t.Fatalf("retained snapshot trusted: %+v, error = %v", output, err)
	}
}

func TestStatusRejectsPreviousConnectionGeneration(t *testing.T) {
	set, bus := readySet(t)
	bus.mu.Lock()
	bus.generation++
	bus.mu.Unlock()
	_, output, err := set.getStatus(t.Context(), nil, struct{}{})
	if err != nil || output.DaemonConnected || output.MetadataReady || output.Bluetooth != nil || len(output.Capabilities) != 0 {
		t.Fatalf("previous connection metadata returned: %+v, error = %v", output, err)
	}
	_, _, err = set.sendMessage(t.Context(), nil, sendMessageInput{
		InstanceID: set.instanceID, RequestKey: "stale", ThreadID: "tel:123", Body: "hello",
	})
	if err == nil || bus.sends != 0 {
		t.Fatalf("stale metadata authorized a send: error = %v, sends = %d", err, bus.sends)
	}
}

func TestImmediateResultWinsOverAmbiguousWrite(t *testing.T) {
	set, bus := readySet(t)
	bus.onSend = func(data json.RawMessage) error {
		var command sendMessageCommand
		if err := json.Unmarshal(data, &command); err != nil {
			t.Fatal(err)
		}
		result, err := json.Marshal(struct {
			OperationID string `json:"operation_id"`
			Thread      string `json:"thread"`
			Success     bool   `json:"success"`
		}{OperationID: command.OperationID, Thread: command.Thread, Success: true})
		if err != nil {
			t.Fatal(err)
		}
		set.applyMessageResult(gateway.Event{Generation: 1, Data: result})
		return errors.New("write outcome unclear")
	}
	_, output, err := set.sendMessage(t.Context(), nil, sendMessageInput{
		InstanceID: set.instanceID, RequestKey: "immediate", ThreadID: "tel:123", Body: "hello",
	})
	if err != nil || output.Status != statusSuccess || bus.sends != 1 {
		t.Fatalf("immediate result = %+v, error = %v, sends = %d", output, err, bus.sends)
	}
}

func TestAmbiguousWriteAndCancelledRetryNeverDispatchTwice(t *testing.T) {
	set, bus := readySet(t)
	bus.onSend = func(json.RawMessage) error { return errors.New("partial write") }
	input := sendMessageInput{InstanceID: set.instanceID, RequestKey: "ambiguous", ThreadID: "tel:123", Body: "hello"}
	_, first, err := set.sendMessage(t.Context(), nil, input)
	if err != nil || first.Status != statusUnknown {
		t.Fatalf("ambiguous send = %+v, error = %v", first, err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, _, err := set.sendMessage(ctx, nil, input); err == nil {
		t.Fatal("cancelled request succeeded")
	}
	_, repeated, err := set.sendMessage(t.Context(), nil, input)
	if err != nil || repeated.OperationID != first.OperationID || repeated.Status != statusUnknown || bus.sends != 1 {
		t.Fatalf("retry = %+v, error = %v, sends = %d", repeated, err, bus.sends)
	}
}

func TestConcurrentDuplicateSendsShareOneOperation(t *testing.T) {
	set, bus := readySet(t)
	input := sendMessageInput{InstanceID: set.instanceID, RequestKey: "concurrent", ThreadID: "tel:123", Body: "hello"}
	results := make(chan operationResult, 12)
	errs := make(chan error, 12)
	var work sync.WaitGroup
	for range 12 {
		work.Add(1)
		go func() {
			defer work.Done()
			_, result, err := set.sendMessage(t.Context(), nil, input)
			results <- result
			errs <- err
		}()
	}
	work.Wait()
	close(results)
	close(errs)
	var id string
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	for result := range results {
		if id == "" {
			id = result.OperationID
		} else if result.OperationID != id {
			t.Fatalf("different duplicate IDs: %s, %s", id, result.OperationID)
		}
	}
	if bus.sends != 1 {
		t.Fatalf("dispatches = %d", bus.sends)
	}
}

func TestOperationTimeoutExpiryAndCapacity(t *testing.T) {
	set, _ := readySet(t)
	_, output, err := set.sendMessage(t.Context(), nil, sendMessageInput{
		InstanceID: set.instanceID, RequestKey: "timeout", ThreadID: "tel:123", Body: "hello",
	})
	if err != nil {
		t.Fatal(err)
	}
	set.mu.Lock()
	set.expireOperations(time.Now().Add(messageResultTimeout))
	set.mu.Unlock()
	_, unknown, err := set.getOperation(t.Context(), nil, operationInput{OperationID: output.OperationID})
	if err != nil || unknown.Status != statusUnknown {
		t.Fatalf("timed out = %+v, error = %v", unknown, err)
	}
	set.mu.Lock()
	set.expireOperations(output.ExpiresAt)
	set.mu.Unlock()
	if _, _, err := set.getOperation(t.Context(), nil, operationInput{OperationID: output.OperationID}); err == nil {
		t.Fatal("expired operation available")
	}
	if len(set.requestKeys) != 0 {
		t.Fatal("expired retry key retained")
	}
	for range maxOperationRecords {
		if _, _, err := set.sendMessage(t.Context(), nil, sendMessageInput{
			InstanceID: set.instanceID, RequestKey: strconv.Itoa(len(set.operations)), ThreadID: "tel:123", Body: "hello",
		}); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, err := set.sendMessage(t.Context(), nil, sendMessageInput{
		InstanceID: set.instanceID, RequestKey: "overflow", ThreadID: "tel:123", Body: "hello",
	}); err == nil {
		t.Fatal("unbounded operation admission")
	}
}

func TestRunFailsClosedOnEventStreamLoss(t *testing.T) {
	set, bus := readySet(t)
	_, output, err := set.sendMessage(t.Context(), nil, sendMessageInput{
		InstanceID: set.instanceID, RequestKey: "stream-loss", ThreadID: "tel:123", Body: "hello",
	})
	if err != nil {
		t.Fatal(err)
	}
	bus.closeOnce.Do(func() { close(bus.events) })
	if err := set.Run(t.Context()); err == nil {
		t.Fatal("closed event stream did not fail")
	}
	_, result, err := set.getOperation(t.Context(), nil, operationInput{OperationID: output.OperationID})
	if err != nil || result.Status != statusUnknown {
		t.Fatalf("stream loss outcome = %+v, error = %v", result, err)
	}
}

func TestMalformedAndOldResultsCannotCompleteOperations(t *testing.T) {
	set, _ := readySet(t)
	_, output, err := set.sendMessage(t.Context(), nil, sendMessageInput{
		InstanceID: set.instanceID, RequestKey: "malformed", ThreadID: "tel:123", Body: "hello",
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name       string
		success    any
		generation uint64
	}{
		{name: "missing success", generation: 1},
		{name: "wrong success type", success: "true", generation: 1},
		{name: "previous generation", success: true, generation: 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			raw, err := json.Marshal(map[string]any{"operation_id": output.OperationID, "thread": "tel:123", "success": test.success})
			if err != nil {
				t.Fatal(err)
			}
			set.applyMessageResult(gateway.Event{Generation: test.generation, Data: raw})
			_, result, err := set.getOperation(t.Context(), nil, operationInput{OperationID: output.OperationID})
			if err != nil || result.Status != statusPending {
				t.Fatalf("malformed result accepted: %+v, error = %v", result, err)
			}
		})
	}
}
