package gateway_test

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/napisani/tether-web/internal/gateway"
)

func postUpload(t *testing.T, handler http.Handler, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "http://tether.test/api/v1/commands", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	return response
}

func TestGatewayStagesFileAndForwardsExistingSendFile(t *testing.T) {
	bus := &fakeBus{ready: true}
	base := t.TempDir()
	handler := gateway.NewHandler(bus, testAssets(), gateway.Config{StagingDir: base})
	id := "web-file-1"
	if got := postUpload(t, handler, `{"command":"file_upload_start","operation_id":"web-file-1","filename":"notes.txt","size":5}`).Code; got != 202 {
		t.Fatalf("start = %d", got)
	}
	chunk := base64.StdEncoding.EncodeToString([]byte("hello"))
	if got := postUpload(t, handler, `{"command":"file_upload_chunk","operation_id":"web-file-1","chunk_index":0,"data":"`+chunk+`"}`).Code; got != 202 {
		t.Fatalf("chunk = %d", got)
	}
	if got := postUpload(t, handler, `{"command":"file_upload_finish","operation_id":"web-file-1"}`).Code; got != 202 {
		t.Fatalf("finish = %d", got)
	}
	if len(bus.commands) != 1 {
		t.Fatalf("forwarded %d commands, want one send_file", len(bus.commands))
	}
	var command struct {
		Command     string `json:"command"`
		Path        string `json:"path"`
		OperationID string `json:"operation_id"`
	}
	if err := json.Unmarshal(bus.commands[0], &command); err != nil {
		t.Fatal(err)
	}
	if command.Command != "send_file" || command.OperationID != id || filepath.Base(command.Path) != "notes.txt" {
		t.Fatalf("forwarded command = %+v", command)
	}
	if contents, err := os.ReadFile(command.Path); err != nil || string(contents) != "hello" {
		t.Fatalf("staged contents = %q, error = %v", contents, err)
	}
	duplicate := postUpload(t, handler, `{"command":"file_upload_finish","operation_id":"web-file-1"}`)
	if duplicate.Code != 409 || duplicate.Header().Get("X-Tether-Upload-Outcome") != "" {
		t.Fatalf("already-sending finish = %d, outcome = %q", duplicate.Code, duplicate.Header().Get("X-Tether-Upload-Outcome"))
	}
	bus.publish(json.RawMessage(`{"command":"file_send_complete","operation_id":"other","success":true}`))
	if _, err := os.Stat(command.Path); err != nil {
		t.Fatalf("unrelated completion removed staged file: %v", err)
	}
	bus.publish(json.RawMessage(`{"command":"file_send_complete","operation_id":"web-file-1","success":false}`))
	deadline := time.Now().Add(time.Second)
	for {
		if _, err := os.Stat(command.Path); os.IsNotExist(err) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("terminal result did not remove staged file")
		}
		time.Sleep(time.Millisecond)
	}
}

func TestGatewayRetainsStagedFileAfterAmbiguousSendFailure(t *testing.T) {
	bus := &fakeBus{ready: true, sendErr: errors.New("write may have reached tetherd")}
	handler := gateway.NewHandler(bus, testAssets(), gateway.Config{StagingDir: t.TempDir()})
	if got := postUpload(t, handler, `{"command":"file_upload_start","operation_id":"uncertain-1","filename":"empty.txt","size":0}`).Code; got != 202 {
		t.Fatalf("start = %d", got)
	}
	uncertain := postUpload(t, handler, `{"command":"file_upload_finish","operation_id":"uncertain-1"}`)
	if uncertain.Code != 503 || uncertain.Header().Get("X-Tether-Upload-Outcome") != "" {
		t.Fatalf("ambiguous finish = %d, outcome = %q", uncertain.Code, uncertain.Header().Get("X-Tether-Upload-Outcome"))
	}
	var send struct {
		Path string `json:"path"`
	}
	if len(bus.commands) != 1 || json.Unmarshal(bus.commands[0], &send) != nil {
		t.Fatalf("send_file was not forwarded: %q", bus.commands)
	}
	if _, err := os.Stat(send.Path); err != nil {
		t.Fatalf("ambiguous write removed a file tetherd might read: %v", err)
	}
	bus.publish(json.RawMessage(`{"command":"file_send_complete","operation_id":"uncertain-1","success":false}`))
	deadline := time.Now().Add(time.Second)
	for {
		if _, err := os.Stat(send.Path); os.IsNotExist(err) {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("matching result did not remove staged file")
		}
		time.Sleep(time.Millisecond)
	}
}

func TestGatewayMarksUnavailableResultStreamAsNotForwarded(t *testing.T) {
	bus := &fakeBus{ready: true, subscribeErr: errors.New("subscriber capacity reached")}
	base := t.TempDir()
	handler := gateway.NewHandler(bus, testAssets(), gateway.Config{StagingDir: base})
	if got := postUpload(t, handler, `{"command":"file_upload_start","operation_id":"no-stream","filename":"empty.txt","size":0}`).Code; got != 202 {
		t.Fatalf("start = %d", got)
	}
	finish := postUpload(t, handler, `{"command":"file_upload_finish","operation_id":"no-stream"}`)
	if finish.Code != 503 || finish.Header().Get("X-Tether-Upload-Outcome") != "not-forwarded" {
		t.Fatalf("finish = %d, outcome = %q", finish.Code, finish.Header().Get("X-Tether-Upload-Outcome"))
	}
	if len(bus.commands) != 0 {
		t.Fatalf("unexpected daemon command: %q", bus.commands)
	}
	entries, err := os.ReadDir(base)
	if err != nil || len(entries) != 0 {
		t.Fatalf("staged file not cleaned: entries=%v error=%v", entries, err)
	}
}

func TestGatewayRejectsInvalidAndIncompleteStaging(t *testing.T) {
	bus := &fakeBus{ready: true}
	handler := gateway.NewHandler(bus, testAssets(), gateway.Config{StagingDir: t.TempDir()})
	for _, body := range []string{
		`{"command":"file_upload_start","operation_id":"../bad","filename":"notes.txt","size":1}`,
		`{"command":"file_upload_start","operation_id":"good","filename":"../notes.txt","size":1}`,
		`{"command":"file_upload_start","operation_id":"good","filename":"notes.txt","size":268435457}`,
	} {
		if got := postUpload(t, handler, body).Code; got != 400 {
			t.Fatalf("invalid start %s returned %d", body, got)
		}
	}
	if got := postUpload(t, handler, `{"command":"file_upload_start","operation_id":"good","filename":"notes.txt","size":1}`).Code; got != 202 {
		t.Fatalf("valid start = %d", got)
	}
	incomplete := postUpload(t, handler, `{"command":"file_upload_finish","operation_id":"good"}`)
	if incomplete.Code != 409 || incomplete.Header().Get("X-Tether-Upload-Outcome") != "not-forwarded" {
		t.Fatalf("incomplete finish = %d, outcome = %q", incomplete.Code, incomplete.Header().Get("X-Tether-Upload-Outcome"))
	}
	if got := postUpload(t, handler, `{"command":"file_upload_chunk","operation_id":"good","chunk_index":1,"data":"YQ=="}`).Code; got != 409 {
		t.Fatalf("out-of-order chunk = %d", got)
	}
	largeChunk := base64.StdEncoding.EncodeToString(make([]byte, 48*1024+1))
	if got := postUpload(t, handler, `{"command":"file_upload_chunk","operation_id":"good","chunk_index":0,"data":"`+largeChunk+`"}`).Code; got != 400 {
		t.Fatalf("oversized chunk = %d", got)
	}
	if got := postUpload(t, handler, `{"command":"file_upload_cancel","operation_id":"good"}`).Code; got != 202 {
		t.Fatalf("cancel = %d", got)
	}
	if len(bus.commands) != 0 {
		t.Fatalf("unexpected daemon commands: %q", bus.commands)
	}
}

func TestGatewayBoundsConcurrentStagingAndReapsOldDirectories(t *testing.T) {
	bus := &fakeBus{ready: true}
	base := t.TempDir()
	old := filepath.Join(base, "tether-web-upload-orphan")
	if err := os.Mkdir(old, 0700); err != nil {
		t.Fatal(err)
	}
	past := time.Now().Add(-2 * time.Hour)
	if err := os.Chtimes(old, past, past); err != nil {
		t.Fatal(err)
	}
	handler := gateway.NewHandler(bus, testAssets(), gateway.Config{StagingDir: base})
	for _, id := range []string{"one", "two"} {
		body := `{"command":"file_upload_start","operation_id":"` + id + `","filename":"file.txt","size":1}`
		if got := postUpload(t, handler, body).Code; got != 202 {
			t.Fatalf("start %s = %d", id, got)
		}
	}
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Fatalf("stale staging directory still exists: %v", err)
	}
	if got := postUpload(t, handler, `{"command":"file_upload_start","operation_id":"three","filename":"file.txt","size":1}`).Code; got != 429 {
		t.Fatalf("third concurrent upload = %d", got)
	}
	for _, id := range []string{"one", "two"} {
		postUpload(t, handler, `{"command":"file_upload_cancel","operation_id":"`+id+`"}`)
	}
}
