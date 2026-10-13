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
	uploads      *gateway.Uploads
	subscription gateway.Subscription
	instanceID   string

	mu               sync.Mutex
	isConnected      bool
	isClosed         bool
	hasRun           bool
	generation       uint64
	protocol         *protocolInfo
	bluetooth        *bluetoothStatus
	host             *hostSettings
	connection       *connectionStatus
	operations       map[string]*operation
	requestKeys      map[string]string
	challenges       map[string]*challenge
	waiters          map[*waiter]struct{}
	changes          map[string]*changeState
	changePhone      string
	changeRetention  string
	changeSignals    chan struct{}
	callsSeedSignals chan struct{}
	changeServer     *mcp.Server
}

func New(bus gateway.Bus, uploads *gateway.Uploads) (*Set, error) {
	subscription, err := bus.Subscribe(nil)
	if err != nil {
		return nil, err
	}
	return &Set{
		bus: bus, uploads: uploads, subscription: subscription, instanceID: rand.Text(),
		generation:       subscription.Snapshot.Generation,
		changeSignals:    make(chan struct{}, 1),
		callsSeedSignals: make(chan struct{}, 1),
		isConnected:      subscription.Snapshot.DaemonConnected,
		operations:       make(map[string]*operation), requestKeys: make(map[string]string),
		challenges: make(map[string]*challenge), waiters: make(map[*waiter]struct{}),
	}, nil
}

func (t *Set) Register(server *mcp.Server) {
	t.registerChangeResources(server)
	t.registerStatusTools(server)
	t.registerMessageTools(server)
	t.registerContactTools(server)
	t.registerNotificationTools(server)
	t.registerCallTools(server)
	t.registerDeviceTools(server)
	t.registerPeerTools(server)
	t.registerAirPodsTools(server)
	t.registerSettingTools(server)
	t.registerFileTools(server)
	t.registerOperationTools(server)
	t.registerConfirmationTools(server)
}

func (t *Set) Run(ctx context.Context, observerStopped func()) error {
	t.mu.Lock()
	if t.hasRun || t.isClosed {
		t.mu.Unlock()
		return errors.New("mcp tools cannot be started twice or after closing")
	}
	t.hasRun = true
	t.mu.Unlock()
	defer t.Close()
	workerCtx, cancelWorker := context.WithCancel(ctx)
	workerDone := make(chan struct{})
	go func() { defer close(workerDone); t.runChangeNotifications(workerCtx) }()
	seedDone := make(chan struct{})
	go func() { defer close(seedDone); t.runCallsSeed(workerCtx) }()
	defer func() { cancelWorker(); <-workerDone; <-seedDone }()
	// Notify the HTTP owner before joining potentially slow notification writes.
	if observerStopped != nil {
		defer observerStopped()
	}

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
			t.expireChallenges(now)
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
			t.handleEvent(ctx, event)
		}
	}
}

func (t *Set) handleEvent(ctx context.Context, event gateway.Event) {
	var envelope struct {
		Command string `json:"command"`
	}
	if json.Unmarshal(event.Data, &envelope) != nil || envelope.Command == "" {
		return
	}
	if t.applyStatusEvent(event, envelope.Command) {
		t.refreshStatus(ctx)
	}
}

func (t *Set) Close() {
	t.mu.Lock()
	t.isClosed = true
	t.clearConnection()
	t.mu.Unlock()
	t.subscription.Close()
}
