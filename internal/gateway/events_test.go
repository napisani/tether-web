package gateway_test

import (
	"bufio"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/napisani/tether-web/internal/gateway"
)

func TestEventEndpointStartsWithSnapshotThenStreamsEvents(t *testing.T) {
	bus := &fakeBus{
		ready: true,
		snapshot: gateway.Snapshot{
			DaemonConnected: true,
			Events: map[string]json.RawMessage{
				"gateway_status": json.RawMessage(`{"command":"gateway_status","daemon_connected":true,"source":"stored"}`),
				"bt_status":      json.RawMessage(`{"command":"bt_status","available":true}`),
			},
		},
	}
	handler := gateway.NewHandler(bus, testAssets(), gateway.Config{})
	server := httptest.NewServer(handler)
	defer server.Close()

	response, err := server.Client().Get(server.URL + "/api/v1/events")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	reader := bufio.NewReader(response.Body)

	_, data := readSSEEvent(t, reader)
	if data != `{"command":"gateway_status","daemon_connected":true,"source":"stored"}` {
		t.Fatalf("first event = %s", data)
	}
	_, data = readSSEEvent(t, reader)
	if data != `{"command":"bt_status","available":true}` {
		t.Fatalf("snapshot event = %s", data)
	}

	published := bus.publish(json.RawMessage(`{"command":"bt_pair_progress","step":"pair","detail":"Waiting for confirmation"}`))
	id, data := readSSEEvent(t, reader)
	if id != published.ID || data != string(published.Data) {
		t.Fatalf("live event = (%d, %s), want (%d, %s)", id, data, published.ID, published.Data)
	}
}

func TestEventEndpointReplaysMissedEvents(t *testing.T) {
	bus := &fakeBus{snapshot: gateway.Snapshot{
		DaemonConnected: true,
		Events: map[string]json.RawMessage{
			"gateway_status": json.RawMessage(`{"command":"gateway_status","daemon_connected":true}`),
		},
	}}
	handler := gateway.NewHandler(bus, testAssets(), gateway.Config{})
	server := httptest.NewServer(handler)
	defer server.Close()

	firstResponse, err := server.Client().Get(server.URL + "/api/v1/events")
	if err != nil {
		t.Fatal(err)
	}
	firstReader := bufio.NewReader(firstResponse.Body)
	readSSEEvent(t, firstReader)
	first := bus.publish(json.RawMessage(`{"command":"bt_pair_progress","step":"connect"}`))
	id, _ := readSSEEvent(t, firstReader)
	if id != first.ID {
		t.Fatalf("first live event id = %d, want %d", id, first.ID)
	}
	firstResponse.Body.Close()

	second := bus.publish(json.RawMessage(`{"command":"bt_pair_confirm_request","code":"042731"}`))
	req, err := http.NewRequest(http.MethodGet, server.URL+"/api/v1/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Last-Event-ID", strconv.FormatUint(first.ID, 10))
	response, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()

	id, data := readSSEEvent(t, bufio.NewReader(response.Body))
	if id != second.ID || data != string(second.Data) {
		t.Fatalf("replayed event = (%d, %s), want (%d, %s)", id, data, second.ID, second.Data)
	}
}

func TestEventEndpointRejectsExcessSubscribers(t *testing.T) {
	bus := &fakeBus{subscribeErr: errors.New("full")}
	handler := gateway.NewHandler(bus, testAssets(), gateway.Config{})
	req := httptest.NewRequest(http.MethodGet, "http://tether.test/api/v1/events", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, req)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusServiceUnavailable)
	}
}
