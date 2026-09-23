package gateway

import (
	"context"
	"encoding/json"
)

type Snapshot struct {
	DaemonConnected bool                       `json:"daemon_connected"`
	Events          map[string]json.RawMessage `json:"events"`
}

type Event struct {
	ID   uint64
	Data json.RawMessage
}

type Subscription struct {
	Snapshot Snapshot
	Replay   []Event
	Events   <-chan Event
	Close    func()
}

type Bus interface {
	Send(context.Context, json.RawMessage) error
	Subscribe(*uint64) (Subscription, error)
	Snapshot() Snapshot
	Ready() bool
}
