package gateway_test

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/napisani/tether-web/internal/daemon"
	"github.com/napisani/tether-web/internal/gateway"
)

// Exercise the HTTP-to-Unix-socket boundary rather than a fake gateway bus.
// The socket peer stands in for tetherd so the test does not need a phone.
func TestStagedUploadSurvivesSocketInterruptionUntilMatchingResult(t *testing.T) {
	base, err := os.MkdirTemp("/tmp", "tether-web-upload-wire-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(base) })
	listener, err := net.Listen("unix", filepath.Join(base, "d.sock"))
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	bus := daemon.New(listener.Addr().String(), 10*time.Millisecond)
	go bus.Run(ctx)
	if err := listener.(*net.UnixListener).SetDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatal(err)
	}
	connection, err := listener.Accept()
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	if err := connection.SetDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatal(err)
	}
	reader := bufio.NewReader(connection)
	for range 5 { // subscribe, status, devices, connection, AirPods
		if _, err := reader.ReadString('\n'); err != nil {
			t.Fatalf("reading daemon bootstrap: %v", err)
		}
	}
	handler := gateway.NewHandler(bus, testAssets(), gateway.Config{StagingDir: base})
	if got := postUpload(t, handler, `{"command":"file_upload_start","operation_id":"wire-1","filename":"notes.txt","size":5}`).Code; got != 202 {
		t.Fatalf("start = %d", got)
	}
	chunk := base64.StdEncoding.EncodeToString([]byte("hello"))
	if got := postUpload(t, handler, `{"command":"file_upload_chunk","operation_id":"wire-1","chunk_index":0,"data":"`+chunk+`"}`).Code; got != 202 {
		t.Fatalf("chunk = %d", got)
	}
	if got := postUpload(t, handler, `{"command":"file_upload_finish","operation_id":"wire-1"}`).Code; got != 202 {
		t.Fatalf("finish = %d", got)
	}

	line, err := reader.ReadBytes('\n')
	if err != nil {
		t.Fatalf("reading forwarded send_file: %v", err)
	}
	var send struct {
		Command     string `json:"command"`
		Path        string `json:"path"`
		OperationID string `json:"operation_id"`
	}
	if err := json.Unmarshal(line, &send); err != nil {
		t.Fatal(err)
	}
	if send.Command != "send_file" || send.OperationID != "wire-1" || filepath.Base(send.Path) != "notes.txt" {
		t.Fatalf("forwarded command = %+v", send)
	}
	if contents, err := os.ReadFile(send.Path); err != nil || string(contents) != "hello" {
		t.Fatalf("staged contents = %q, error = %v", contents, err)
	}
	if _, err := connection.Write([]byte(`{"command":"file_send_complete","operation_id":"someone-else","success":true}` + "\n")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(send.Path); err != nil {
		t.Fatalf("unrelated result removed staged file: %v", err)
	}
	if err := connection.Close(); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for bus.Ready() {
		if time.Now().After(deadline) {
			t.Fatal("gateway did not notice daemon disconnect")
		}
		time.Sleep(time.Millisecond)
	}
	if _, err := os.Stat(send.Path); err != nil {
		t.Fatalf("socket interruption removed staged file: %v", err)
	}
	reconnected, err := listener.Accept()
	if err != nil {
		t.Fatal(err)
	}
	defer reconnected.Close()
	if err := reconnected.SetDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatal(err)
	}
	reconnectionReader := bufio.NewReader(reconnected)
	for range 5 {
		if _, err := reconnectionReader.ReadString('\n'); err != nil {
			t.Fatalf("reading bootstrap after reconnect: %v", err)
		}
	}
	if _, err := reconnected.Write([]byte(`{"command":"file_send_complete","operation_id":"wire-1","success":false}` + "\n")); err != nil {
		t.Fatal(err)
	}
	for {
		if _, err := os.Stat(send.Path); os.IsNotExist(err) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("matching daemon result did not remove staged file")
		}
		time.Sleep(time.Millisecond)
	}
}
