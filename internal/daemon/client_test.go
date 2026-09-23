package daemon_test

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/napisani/tether-web/internal/daemon"
	"github.com/napisani/tether-web/internal/gateway"
)

func TestClientBridgesUnixCommandsEventsSnapshotsAndReplay(t *testing.T) {
	socketPath := shortSocketPath(t)
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	client := daemon.New(socketPath, 10*time.Millisecond)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go client.Run(ctx)

	connection, err := listener.Accept()
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	reader := bufio.NewReader(connection)

	for _, want := range []string{
		`{"command":"subscribe"}` + "\n",
		`{"command":"bt_status"}` + "\n",
		`{"command":"bt_list_devices"}` + "\n",
		`{"command":"bt_connection"}` + "\n",
		`{"command":"bt_airpods"}` + "\n",
	} {
		line, err := reader.ReadString('\n')
		if err != nil {
			t.Fatal(err)
		}
		if line != want {
			t.Fatalf("bootstrap command = %q, want %q", line, want)
		}
	}

	subscription, err := client.Subscribe(nil)
	if err != nil {
		t.Fatal(err)
	}
	if !subscription.Snapshot.DaemonConnected {
		t.Fatal("subscription snapshot reports disconnected client")
	}
	assertSnapshotGatewayStatus(t, subscription.Snapshot, true)
	if _, err := connection.Write([]byte(`{"command":"bt_status","available":true}` + "\n")); err != nil {
		t.Fatal(err)
	}
	first := receiveEvent(t, subscription.Events)
	if string(first.Data) != `{"command":"bt_status","available":true}` {
		t.Fatalf("event = %s", first.Data)
	}
	subscription.Close()

	if _, err := connection.Write([]byte(`{"command":"bt_devices","devices":[]}` + "\n")); err != nil {
		t.Fatal(err)
	}
	waitForSnapshotEvent(t, client, "bt_devices")

	reconnected, err := client.Subscribe(&first.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer reconnected.Close()
	if len(reconnected.Replay) != 1 || string(reconnected.Replay[0].Data) != `{"command":"bt_devices","devices":[]}` {
		t.Fatalf("replay = %#v", reconnected.Replay)
	}

	if _, err := connection.Write([]byte(`{"command":"bt_airpods","address":"AA:BB"}` + "\n")); err != nil {
		t.Fatal(err)
	}
	waitForSnapshotEvent(t, client, "bt_airpods")

	snapshot := client.Snapshot()
	if !snapshot.DaemonConnected || string(snapshot.Events["bt_status"]) != `{"command":"bt_status","available":true}` {
		t.Fatalf("snapshot = %#v", snapshot)
	}
	if string(snapshot.Events["bt_airpods"]) != `{"command":"bt_airpods","address":"AA:BB"}` {
		t.Fatalf("AirPods snapshot = %s", snapshot.Events["bt_airpods"])
	}
	assertSnapshotGatewayStatus(t, snapshot, true)

	command := json.RawMessage(`{"command":"bt_scan"}`)
	if err := client.Send(context.Background(), command); err != nil {
		t.Fatal(err)
	}
	line, err := reader.ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	if line != string(command)+"\n" {
		t.Fatalf("forwarded command = %q", line)
	}

	if err := connection.Close(); err != nil {
		t.Fatal(err)
	}
	waitForGatewayStatus(t, client, false)
}

func TestClientBoundsEventSubscribers(t *testing.T) {
	client := daemon.New(filepath.Join(shortTempDir(t), "missing.sock"), time.Second)
	subscriptions := make([]gateway.Subscription, 0, 64)
	for range 64 {
		subscription, err := client.Subscribe(nil)
		if err != nil {
			t.Fatal(err)
		}
		subscriptions = append(subscriptions, subscription)
	}
	defer func() {
		for _, subscription := range subscriptions {
			subscription.Close()
		}
	}()

	if _, err := client.Subscribe(nil); !errors.Is(err, daemon.ErrSubscriberLimit) {
		t.Fatalf("Subscribe error = %v, want %v", err, daemon.ErrSubscriberLimit)
	}
}

func TestClientWaitsBeforeReconnectingAfterEOF(t *testing.T) {
	socketPath := shortSocketPath(t)
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	const retryInterval = 100 * time.Millisecond
	client := daemon.New(socketPath, retryInterval)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go client.Run(ctx)

	connection, err := listener.Accept()
	if err != nil {
		t.Fatal(err)
	}
	if err := connection.Close(); err != nil {
		t.Fatal(err)
	}

	if unixListener, ok := listener.(*net.UnixListener); ok {
		if err := unixListener.SetDeadline(time.Now().Add(retryInterval / 2)); err != nil {
			t.Fatal(err)
		}
	}
	if early, err := listener.Accept(); err == nil {
		early.Close()
		t.Fatal("client reconnected without waiting")
	}

	if unixListener, ok := listener.(*net.UnixListener); ok {
		if err := unixListener.SetDeadline(time.Now().Add(time.Second)); err != nil {
			t.Fatal(err)
		}
	}
	reconnected, err := listener.Accept()
	if err != nil {
		t.Fatalf("client did not reconnect: %v", err)
	}
	reconnected.Close()
}

func shortSocketPath(t *testing.T) string {
	t.Helper()
	return filepath.Join(shortTempDir(t), "d.sock")
}

func shortTempDir(t *testing.T) string {
	t.Helper()
	dir, err := os.MkdirTemp("/tmp", "tether-web-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	return dir
}

func receiveEvent(t *testing.T, events <-chan gateway.Event) gateway.Event {
	t.Helper()
	select {
	case event := <-events:
		return event
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for daemon event")
		return gateway.Event{}
	}
}

func assertSnapshotGatewayStatus(t *testing.T, snapshot gateway.Snapshot, want bool) {
	t.Helper()
	var status struct {
		DaemonConnected bool `json:"daemon_connected"`
	}
	if err := json.Unmarshal(snapshot.Events["gateway_status"], &status); err != nil {
		t.Fatalf("decoding gateway_status: %v", err)
	}
	if snapshot.DaemonConnected != want || status.DaemonConnected != want {
		t.Fatalf("inconsistent snapshot status: connected=%v event=%s", snapshot.DaemonConnected, snapshot.Events["gateway_status"])
	}
}

func waitForGatewayStatus(t *testing.T, client *daemon.Client, want bool) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		snapshot := client.Snapshot()
		var status struct {
			DaemonConnected bool `json:"daemon_connected"`
		}
		if err := json.Unmarshal(snapshot.Events["gateway_status"], &status); err == nil &&
			snapshot.DaemonConnected == want && status.DaemonConnected == want {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("timed out waiting for gateway status %v", want)
}

func waitForSnapshotEvent(t *testing.T, client *daemon.Client, command string) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if _, ok := client.Snapshot().Events[command]; ok {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("timed out waiting for snapshot event %q", command)
}
