package mcpserver_test

import (
	"bufio"
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/napisani/tether-web/internal/daemon"
	"github.com/napisani/tether-web/internal/gateway"
	"github.com/napisani/tether-web/internal/mcpserver"
)

type daemonCommand struct {
	Command     string `json:"command"`
	Thread      string `json:"thread"`
	Body        string `json:"body"`
	OperationID string `json:"operation_id"`
	Retention   string `json:"retention"`
	Path        string `json:"path"`
}

type fakeDaemon struct {
	mu          sync.Mutex
	connections map[net.Conn]struct{}
	messages    chan daemonCommand
	retention   chan daemonCommand
	files       chan daemonCommand
	mapOpen     atomic.Bool

	retentionMode string
}

type status struct {
	InstanceID      string   `json:"instance_id"`
	DaemonConnected bool     `json:"daemon_connected"`
	MetadataReady   bool     `json:"metadata_ready"`
	Capabilities    []string `json:"capabilities"`
	Bluetooth       *struct {
		Version string `json:"version"`
	} `json:"bluetooth"`
	Connection *struct {
		MAPOpen bool `json:"map_open"`
	} `json:"connection"`
}

type operation struct {
	ID      string    `json:"operation_id"`
	Status  string    `json:"status"`
	Message string    `json:"message"`
	Expires time.Time `json:"expires_at"`
}

func startServer(t *testing.T, auth *gateway.BasicCredentials) (*fakeDaemon, *httptest.Server) {
	t.Helper()
	dir, err := os.MkdirTemp("", "tether-mcp-test-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	socket := filepath.Join(dir, "d.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	wire := &fakeDaemon{connections: make(map[net.Conn]struct{}), messages: make(chan daemonCommand, 32), retention: make(chan daemonCommand, 32), files: make(chan daemonCommand, 32)}
	wire.mapOpen.Store(true)
	var daemonWork sync.WaitGroup
	daemonWork.Add(1)
	go func() {
		defer daemonWork.Done()
		for {
			connection, err := listener.Accept()
			if err != nil {
				return
			}
			wire.mu.Lock()
			wire.connections[connection] = struct{}{}
			wire.mu.Unlock()
			daemonWork.Add(1)
			go func() {
				defer daemonWork.Done()
				defer func() {
					wire.mu.Lock()
					delete(wire.connections, connection)
					wire.mu.Unlock()
					_ = connection.Close()
				}()
				scanner := bufio.NewScanner(connection)
				scanner.Buffer(make([]byte, 4096), 1<<20)
				for scanner.Scan() {
					var command daemonCommand
					if json.Unmarshal(scanner.Bytes(), &command) != nil {
						continue
					}
					switch command.Command {
					case "protocol_info":
						wire.emit(t, map[string]any{"command": "protocol_info", "version": 1, "capabilities": []string{"files", "messages", "peers", "settings"}})
					case "bt_status":
						wire.emit(t, map[string]any{"command": "bt_status", "available": true, "enabled": true, "version": "test", "device_address": "AA:BB", "retention": wire.currentRetention()})
					case "state_snapshot":
						wire.emit(t, map[string]any{"command": "state_snapshot", "paired_devices": []any{}, "pending_pairs": []any{},
							"connected_clients":  []map[string]any{{"fingerprint": "fp", "device_name": "Laptop", "address": "192.0.2.7", "paired": true}},
							"discovered_devices": []any{}, "mdns_available": true, "firewall_active": false})
					case "send_file":
						wire.files <- command
					case "bt_list_threads":
						wire.emit(t, map[string]any{"command": "bt_threads", "threads": []map[string]any{{"thread": "tel:+15550100", "name": "Alex", "repliable": true}}})
					case "bt_set_retention":
						wire.retention <- command
					case "bt_connection":
						wire.emit(t, map[string]any{"command": "bt_connection_changed", "map_open": wire.mapOpen.Load()})
					case "bt_send_message":
						wire.messages <- command
					}
				}
			}()
		}
	}()

	ctx, cancel := context.WithCancel(t.Context())
	bus := daemon.New(socket, time.Millisecond)
	uploads := gateway.NewUploads(bus, dir)
	agent, err := mcpserver.New(bus, uploads, mcpserver.Config{Version: "test"})
	if err != nil {
		cancel()
		_ = listener.Close()
		t.Fatal(err)
	}
	busDone := make(chan struct{})
	agentDone := make(chan error, 1)
	go func() { defer close(busDone); bus.Run(ctx) }()
	go func() { agentDone <- agent.Run(ctx) }()
	httpServer := httptest.NewServer(gateway.NewHandler(bus, nil, gateway.Config{
		Auth: auth, AllowedHosts: []string{"127.0.0.1", "tether.test"}, MCPHandler: agent.Handler(), Uploads: uploads,
	}))
	t.Cleanup(func() {
		cancel()
		agent.Close()
		httpServer.Close()
		_ = listener.Close()
		wire.disconnect()
		<-busDone
		if err := <-agentDone; err != nil {
			t.Errorf("agent run: %v", err)
		}
		daemonWork.Wait()
	})
	return wire, httpServer
}

func (f *fakeDaemon) currentRetention() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.retentionMode == "" {
		return "encrypted"
	}
	return f.retentionMode
}

func (f *fakeDaemon) setRetention(mode string) {
	f.mu.Lock()
	f.retentionMode = mode
	f.mu.Unlock()
}

func (f *fakeDaemon) emit(t *testing.T, event map[string]any) {
	t.Helper()
	data, err := json.Marshal(event)
	if err != nil {
		t.Error(err)
		return
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	for connection := range f.connections {
		_, _ = connection.Write(append(data, '\n'))
	}
}

func (f *fakeDaemon) disconnect() {
	f.mu.Lock()
	defer f.mu.Unlock()
	for connection := range f.connections {
		_ = connection.Close()
	}
}

type basicTransport struct{ credentials *gateway.BasicCredentials }

func (b basicTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	request = request.Clone(request.Context())
	request.SetBasicAuth(b.credentials.Username, b.credentials.Password)
	return http.DefaultTransport.RoundTrip(request)
}

func connect(t *testing.T, server *httptest.Server, credentials *gateway.BasicCredentials) *mcp.ClientSession {
	t.Helper()
	httpClient := &http.Client{Timeout: 5 * time.Second}
	if credentials != nil {
		httpClient.Transport = basicTransport{credentials: credentials}
	}
	client := mcp.NewClient(&mcp.Implementation{Name: "test-agent", Version: "test"}, nil)
	session, err := client.Connect(t.Context(), &mcp.StreamableClientTransport{
		Endpoint: server.URL + "/mcp", HTTPClient: httpClient, MaxRetries: -1, DisableStandaloneSSE: true,
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = session.Close() })
	return session
}

func callTool[Result any](t *testing.T, session *mcp.ClientSession, name string, args map[string]any) Result {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		t.Fatal(err)
	}
	if result.IsError {
		t.Fatalf("%s tool failed: %+v", name, result.Content)
	}
	data, err := json.Marshal(result.StructuredContent)
	if err != nil {
		t.Fatal(err)
	}
	var output Result
	if err := json.Unmarshal(data, &output); err != nil {
		t.Fatal(err)
	}
	return output
}

func awaitStatus(t *testing.T, session *mcp.ClientSession, match func(status) bool) status {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		value := callTool[status](t, session, "get_status", map[string]any{})
		if match(value) {
			return value
		}
		if time.Now().After(deadline) {
			t.Fatalf("status did not converge: %+v", value)
		}
		time.Sleep(time.Millisecond)
	}
}

func awaitOperation(t *testing.T, session *mcp.ClientSession, id, expected string) operation {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		value := callTool[operation](t, session, "get_operation", map[string]any{"operation_id": id})
		if value.Status == expected {
			return value
		}
		if time.Now().After(deadline) {
			t.Fatalf("operation did not converge to %s: %+v", expected, value)
		}
		time.Sleep(time.Millisecond)
	}
}

func sendArgs(instanceID, key string) map[string]any {
	return map[string]any{"instance_id": instanceID, "request_key": key, "thread_id": "tel:+15550100", "body": "hello"}
}

func messageCommand(t *testing.T, wire *fakeDaemon) daemonCommand {
	t.Helper()
	select {
	case command := <-wire.messages:
		return command
	case <-time.After(5 * time.Second):
		t.Fatal("no daemon message command")
		return daemonCommand{}
	}
}

var expectedTools = []string{
	"accept_peer", "append_upload", "begin_upload", "cancel_upload", "confirm_action", "confirm_pairing", "connect_airpods", "control_call", "dial_call",
	"discover_peers", "dismiss_notification", "forget_peer", "get_airpods", "get_operation", "get_settings",
	"get_status", "list_bluetooth_devices", "list_calls", "list_messages", "list_notifications", "list_peers",
	"list_threads", "mark_messages_read", "pair_bluetooth_device", "pair_peer", "request_phone_permissions",
	"scan_bluetooth", "search_contacts", "send_message", "send_upload", "set_airpods_auto_pause", "set_airpods_call_handoff",
	"set_airpods_managed", "set_airpods_noise_control", "set_bluetooth_enabled", "set_call_control",
	"set_message_retention", "set_notification_content", "set_notification_mirroring", "unpair_bluetooth_device",
}

func TestServerRegistersTypedToolsBehindAuthentication(t *testing.T) {
	t.Parallel()
	credentials := &gateway.BasicCredentials{Username: "owner", Password: "a-long-private-password"}
	_, server := startServer(t, credentials)
	response, err := http.Post(server.URL+"/mcp", "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anonymous status = %d", response.StatusCode)
	}
	session := connect(t, server, credentials)
	listed, err := session.ListTools(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, tool := range listed.Tools {
		names = append(names, tool.Name)
		if tool.InputSchema == nil || tool.OutputSchema == nil {
			t.Fatalf("%s lacks a typed schema", tool.Name)
		}
	}
	sort.Strings(names)
	if !reflect.DeepEqual(names, expectedTools) {
		t.Fatalf("tools = %v", names)
	}
	current := awaitStatus(t, session, func(value status) bool { return value.MetadataReady })
	if !current.DaemonConnected || current.Connection == nil || !current.Connection.MAPOpen ||
		current.InstanceID == "" || !reflect.DeepEqual(current.Capabilities, []string{"files", "messages", "peers", "settings"}) {
		t.Fatalf("status = %+v", current)
	}
}

func TestMessageResultCorrelationAndDuplicateProtection(t *testing.T) {
	t.Parallel()
	wire, server := startServer(t, nil)
	session := connect(t, server, nil)
	current := awaitStatus(t, session, func(value status) bool { return value.MetadataReady })
	args := sendArgs(current.InstanceID, "first-send")
	first := callTool[operation](t, session, "send_message", args)
	command := messageCommand(t, wire)
	if command.OperationID != first.ID || command.Thread != args["thread_id"] || command.Body != args["body"] {
		t.Fatalf("daemon command = %+v, operation = %+v", command, first)
	}
	wire.emit(t, map[string]any{"command": "bt_send_result", "operation_id": "another-agent", "thread": command.Thread, "success": true})
	wire.emit(t, map[string]any{"command": "bt_send_result", "operation_id": command.OperationID, "thread": "tel:other", "success": true})
	wire.emit(t, map[string]any{"command": "bt_send_result", "thread": command.Thread, "success": true})
	wire.emit(t, map[string]any{"command": "bt_status", "available": true, "version": "barrier"})
	awaitStatus(t, session, func(value status) bool { return value.Bluetooth != nil && value.Bluetooth.Version == "barrier" })
	pending := callTool[operation](t, session, "get_operation", map[string]any{"operation_id": first.ID})
	if pending.Status != "pending" {
		t.Fatalf("uncorrelated events completed operation: %+v", pending)
	}
	wire.emit(t, map[string]any{"command": "bt_send_result", "operation_id": command.OperationID, "thread": command.Thread, "success": true})
	awaitOperation(t, session, first.ID, "correlated_success")

	duplicate := callTool[operation](t, session, "send_message", args)
	if duplicate.ID != first.ID || duplicate.Status != "correlated_success" {
		t.Fatalf("duplicate = %+v", duplicate)
	}
	args["body"] = "different"
	result, err := session.CallTool(t.Context(), &mcp.CallToolParams{Name: "send_message", Arguments: args})
	if err != nil || !result.IsError {
		t.Fatalf("changed payload: result = %+v, error = %v", result, err)
	}
	select {
	case extra := <-wire.messages:
		t.Fatalf("duplicate send dispatched: %+v", extra)
	default:
	}
}

func TestMessageDisconnectAndLateCorrelatedResult(t *testing.T) {
	t.Parallel()
	wire, server := startServer(t, nil)
	session := connect(t, server, nil)
	current := awaitStatus(t, session, func(value status) bool { return value.MetadataReady })
	args := sendArgs(current.InstanceID, "uncertain-send")
	first := callTool[operation](t, session, "send_message", args)
	command := messageCommand(t, wire)
	wire.mapOpen.Store(false)
	wire.disconnect()
	unknown := awaitOperation(t, session, first.ID, "unknown")
	if unknown.Message == "" {
		t.Fatal("uncertain operation omitted guidance")
	}
	awaitStatus(t, session, func(value status) bool {
		return value.MetadataReady && value.Connection != nil && !value.Connection.MAPOpen
	})
	duplicate := callTool[operation](t, session, "send_message", args)
	if duplicate.ID != first.ID || duplicate.Status != "unknown" {
		t.Fatalf("uncertain retry = %+v", duplicate)
	}
	unavailable, err := session.CallTool(t.Context(), &mcp.CallToolParams{
		Name: "send_message", Arguments: sendArgs(current.InstanceID, "new-send"),
	})
	if err != nil || !unavailable.IsError {
		t.Fatalf("disconnected messaging: result = %+v, err = %v", unavailable, err)
	}
	wire.emit(t, map[string]any{"command": "bt_send_result", "operation_id": command.OperationID, "thread": command.Thread, "success": false, "message": "phone refused"})
	failed := awaitOperation(t, session, first.ID, "correlated_failure")
	if failed.Message != "phone refused" {
		t.Fatalf("late failure = %+v", failed)
	}
	select {
	case extra := <-wire.messages:
		t.Fatalf("uncertain retry dispatched: %+v", extra)
	default:
	}
}

func TestServerRejectsInvalidMessageArguments(t *testing.T) {
	t.Parallel()
	wire, server := startServer(t, nil)
	session := connect(t, server, nil)
	current := awaitStatus(t, session, func(value status) bool { return value.MetadataReady })
	for _, test := range []struct {
		name  string
		field string
		value any
	}{
		{name: "blank body", field: "body", value: " "},
		{name: "wrong body type", field: "body", value: 123},
		{name: "oversize body", field: "body", value: strings.Repeat("x", 65537)},
		{name: "stale instance", field: "instance_id", value: "previous-process"},
		{name: "blank thread", field: "thread_id", value: ""},
		{name: "blank key", field: "request_key", value: ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			args := sendArgs(current.InstanceID, test.name)
			args[test.field] = test.value
			result, err := session.CallTool(t.Context(), &mcp.CallToolParams{Name: "send_message", Arguments: args})
			if err == nil && !result.IsError {
				t.Fatal("invalid arguments accepted")
			}
		})
	}
	select {
	case extra := <-wire.messages:
		t.Fatalf("invalid send dispatched: %+v", extra)
	default:
	}
}

func TestServerAcceptsAllowlistedReverseProxyHost(t *testing.T) {
	t.Parallel()
	_, server := startServer(t, nil)
	request, err := http.NewRequest(http.MethodPost, server.URL+"/mcp", strings.NewReader(
		`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"test"}}}`))
	if err != nil {
		t.Fatal(err)
	}
	request.Host = "tether.test"
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json, text/event-stream")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("allowlisted proxy host status = %d", response.StatusCode)
	}
	untrusted, err := http.NewRequest(http.MethodPost, server.URL+"/mcp", strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	untrusted.Host = "attacker.test"
	blocked, err := http.DefaultClient.Do(untrusted)
	if err != nil {
		t.Fatal(err)
	}
	defer blocked.Body.Close()
	if blocked.StatusCode != http.StatusMisdirectedRequest {
		t.Fatalf("untrusted host status = %d", blocked.StatusCode)
	}
}

func TestServerBoundsRequestBodies(t *testing.T) {
	t.Parallel()
	_, server := startServer(t, nil)
	request, err := http.NewRequest(http.MethodPost, server.URL+"/mcp",
		strings.NewReader(strings.Repeat(" ", 1<<20+1)))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json, text/event-stream")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("oversized body status = %d", response.StatusCode)
	}
}

type threadsResult struct {
	Threads []struct {
		Thread string `json:"thread"`
		Name   string `json:"name"`
	} `json:"threads"`
	Total int `json:"total"`
}

type challenged struct {
	OperationID string `json:"operation_id"`
	Status      string `json:"status"`
	ChallengeID string `json:"challenge_id"`
	Summary     string `json:"summary"`
}

func TestReadToolReturnsDaemonReplyOverRealSocket(t *testing.T) {
	t.Parallel()
	_, server := startServer(t, nil)
	session := connect(t, server, nil)
	awaitStatus(t, session, func(value status) bool { return value.MetadataReady })
	threads := callTool[threadsResult](t, session, "list_threads", map[string]any{})
	if threads.Total != 1 || threads.Threads[0].Thread != "tel:+15550100" || threads.Threads[0].Name != "Alex" {
		t.Fatalf("threads = %+v", threads)
	}
}

func TestRetentionChangeWaitsForConfirmationOverRealSocket(t *testing.T) {
	t.Parallel()
	wire, server := startServer(t, nil)
	session := connect(t, server, nil)
	awaitStatus(t, session, func(value status) bool { return value.MetadataReady })
	pending := callTool[challenged](t, session, "set_message_retention", map[string]any{"retention": "none"})
	if pending.Status != "confirmation_required" || pending.ChallengeID == "" || pending.OperationID != "" {
		t.Fatalf("challenge = %+v", pending)
	}
	select {
	case extra := <-wire.retention:
		t.Fatalf("retention changed before approval: %+v", extra)
	case <-time.After(100 * time.Millisecond):
	}
	approved := callTool[challenged](t, session, "confirm_action", map[string]any{"challenge_id": pending.ChallengeID, "decision": "approve"})
	if approved.Status != "pending" || approved.OperationID == "" {
		t.Fatalf("approval = %+v", approved)
	}
	select {
	case command := <-wire.retention:
		if command.Retention != "none" {
			t.Fatalf("daemon command = %+v", command)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("approved change never reached the daemon")
	}
	wire.setRetention("none")
	wire.emit(t, map[string]any{"command": "bt_status", "available": true, "enabled": true, "device_address": "AA:BB", "retention": "none"})
	done := awaitOperation(t, session, approved.OperationID, "observed")
	if done.Message == "" {
		t.Fatal("observed outcome omitted its caveat")
	}
	again := callTool[challenged](t, session, "confirm_action", map[string]any{"challenge_id": pending.ChallengeID, "decision": "approve"})
	if again.OperationID != approved.OperationID {
		t.Fatalf("repeated approval = %+v", again)
	}
	select {
	case extra := <-wire.retention:
		t.Fatalf("repeated approval sent another command: %+v", extra)
	case <-time.After(100 * time.Millisecond):
	}
}

type uploadStarted struct {
	UploadID      string `json:"upload_id"`
	MaxChunkBytes int    `json:"max_chunk_bytes"`
}

func callRaw(t *testing.T, session *mcp.ClientSession, name string, args map[string]any) *mcp.CallToolResult {
	t.Helper()
	result, err := session.CallTool(t.Context(), &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestFileUploadSendsAgentBytesAndCorrelatesResult(t *testing.T) {
	t.Parallel()
	wire, server := startServer(t, nil)
	session := connect(t, server, nil)
	awaitStatus(t, session, func(value status) bool { return value.MetadataReady })
	started := callTool[uploadStarted](t, session, "begin_upload", map[string]any{"filename": "note.txt", "size": 5})
	if started.UploadID == "" || started.MaxChunkBytes <= 0 {
		t.Fatalf("begin_upload = %+v", started)
	}
	if result := callRaw(t, session, "send_upload", map[string]any{"upload_id": started.UploadID}); !result.IsError {
		t.Fatal("an incomplete upload was sent")
	}
	if result := callRaw(t, session, "get_operation", map[string]any{"operation_id": started.UploadID}); !result.IsError {
		t.Fatal("a refused send left an operation record")
	}
	if result := callRaw(t, session, "append_upload", map[string]any{"upload_id": started.UploadID, "chunk_index": 1, "data_base64": "aGVsbG8="}); !result.IsError {
		t.Fatal("an out-of-order chunk was staged")
	}
	if result := callRaw(t, session, "append_upload", map[string]any{"upload_id": started.UploadID, "chunk_index": 0, "data_base64": "not base64!"}); !result.IsError {
		t.Fatal("invalid base64 was staged")
	}
	next := callTool[struct {
		Next int `json:"next_chunk_index"`
	}](t, session, "append_upload", map[string]any{"upload_id": started.UploadID, "chunk_index": 0, "data_base64": "aGVsbG8="})
	if next.Next != 1 {
		t.Fatalf("next chunk = %d", next.Next)
	}
	sent := callTool[operation](t, session, "send_upload", map[string]any{"upload_id": started.UploadID})
	if sent.ID != started.UploadID || sent.Status != "pending" {
		t.Fatalf("send_upload = %+v", sent)
	}
	repeated := callTool[operation](t, session, "send_upload", map[string]any{"upload_id": started.UploadID})
	if repeated.ID != sent.ID || repeated.Status != "pending" {
		t.Fatalf("repeated send_upload = %+v", repeated)
	}
	var command daemonCommand
	select {
	case command = <-wire.files:
	case <-time.After(5 * time.Second):
		t.Fatal("send_file never reached the daemon")
	}
	if command.OperationID != started.UploadID {
		t.Fatalf("send_file = %+v", command)
	}
	contents, err := os.ReadFile(command.Path)
	if err != nil || string(contents) != "hello" {
		t.Fatalf("staged bytes = %q, error = %v", contents, err)
	}
	wire.emit(t, map[string]any{"command": "file_send_complete", "operation_id": "browser-upload", "success": true})
	wire.emit(t, map[string]any{"command": "bt_status", "available": true, "version": "barrier"})
	awaitStatus(t, session, func(value status) bool { return value.Bluetooth != nil && value.Bluetooth.Version == "barrier" })
	if got := callTool[operation](t, session, "get_operation", map[string]any{"operation_id": sent.ID}); got.Status != "pending" {
		t.Fatalf("another upload's result completed this send: %+v", got)
	}
	wire.emit(t, map[string]any{"command": "file_send_complete", "operation_id": started.UploadID, "success": true})
	awaitOperation(t, session, sent.ID, "correlated_success")
	select {
	case extra := <-wire.files:
		t.Fatalf("repeated send_upload sent the file again: %+v", extra)
	default:
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		if _, err := os.Stat(command.Path); os.IsNotExist(err) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("staged file was not released after the result")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestUploadQuotaIsSharedAndCancelFreesIt(t *testing.T) {
	t.Parallel()
	_, server := startServer(t, nil)
	session := connect(t, server, nil)
	awaitStatus(t, session, func(value status) bool { return value.MetadataReady })
	var ids []string
	for range 2 {
		ids = append(ids, callTool[uploadStarted](t, session, "begin_upload", map[string]any{"filename": "a.txt", "size": 1}).UploadID)
	}
	if result := callRaw(t, session, "begin_upload", map[string]any{"filename": "c.txt", "size": 1}); !result.IsError {
		t.Fatal("a third concurrent upload was allowed")
	}
	if result := callRaw(t, session, "cancel_upload", map[string]any{"upload_id": "browser-owned-upload"}); !result.IsError {
		t.Fatal("an agent cancelled an upload it did not start")
	}
	cancelled := callTool[operation](t, session, "cancel_upload", map[string]any{"upload_id": ids[0]})
	if cancelled.Status != "cancelled" {
		t.Fatalf("cancel = %+v", cancelled)
	}
	callTool[uploadStarted](t, session, "begin_upload", map[string]any{"filename": "c.txt", "size": 1})
	for _, invalid := range []map[string]any{
		{"filename": "../escape.txt", "size": 1}, {"filename": "big.bin", "size": 268435457}, {"filename": "", "size": 1},
	} {
		if result := callRaw(t, session, "begin_upload", invalid); !result.IsError {
			t.Fatalf("invalid upload %v accepted", invalid)
		}
	}
}
