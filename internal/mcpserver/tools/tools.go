package tools

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/napisani/tether-web/internal/gateway"
)

type Set struct {
	bus          gateway.Bus
	subscription gateway.Subscription
	instanceID   string

	mu          sync.Mutex
	isConnected bool
	isClosed    bool
	hasRun      bool
	generation  uint64
	protocol    *protocolInfo
	bluetooth   *bluetoothStatus
	connection  *connectionStatus
	operations  map[string]*operation
	requestKeys map[string]string
}

func New(bus gateway.Bus) (*Set, error) {
	subscription, err := bus.Subscribe(nil)
	if err != nil {
		return nil, err
	}
	return &Set{
		bus: bus, subscription: subscription, instanceID: rand.Text(),
		generation:  subscription.Snapshot.Generation,
		isConnected: subscription.Snapshot.DaemonConnected,
		operations:  make(map[string]*operation), requestKeys: make(map[string]string),
	}, nil
}

func (t *Set) Register(server *mcp.Server) {
	t.registerStatusTools(server)
	t.registerMessageTools(server)
	t.registerOperationTools(server)
}

func (t *Set) Run(ctx context.Context) error {
	t.mu.Lock()
	if t.hasRun || t.isClosed {
		t.mu.Unlock()
		return errors.New("mcp tools cannot be started twice or after closing")
	}
	t.hasRun = true
	t.mu.Unlock()
	defer t.Close()

	t.refreshStatus(ctx)
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case now := <-ticker.C:
			t.mu.Lock()
			t.expireOperations(now)
			t.mu.Unlock()
		case event, open := <-t.subscription.Events:
			if !open {
				t.mu.Lock()
				closed := t.isClosed
				t.mu.Unlock()
				if closed {
					return nil
				}
				return errors.New("mcp daemon event stream ended")
			}
			var envelope struct {
				Command string `json:"command"`
			}
			if json.Unmarshal(event.Data, &envelope) != nil {
				continue
			}
			switch envelope.Command {
			case "gateway_status", "protocol_info", "bt_status", "bt_connection_changed":
				if t.applyStatusEvent(event, envelope.Command) {
					t.refreshStatus(ctx)
				}
			case "bt_send_result":
				t.applyMessageResult(event)
			}
		}
	}
}

func (t *Set) Close() {
	t.mu.Lock()
	t.isClosed = true
	t.clearConnection()
	t.mu.Unlock()
	t.subscription.Close()
}
