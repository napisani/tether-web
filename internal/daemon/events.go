package daemon

import (
	"encoding/json"
	"sync"

	"github.com/napisani/tether-web/internal/gateway"
)

var durableEvents = map[string]struct{}{
	"gateway_status":        {},
	"protocol_info":         {},
	"state_snapshot":        {},
	"bt_status":             {},
	"bt_devices":            {},
	"bt_connection_changed": {},
	"bt_airpods":            {},
}

func (c *Client) Subscribe(afterID *uint64) (gateway.Subscription, error) {
	channel := make(chan gateway.Event, 32)
	c.stateMu.Lock()
	if len(c.subscribers) >= maxSubscribers {
		c.stateMu.Unlock()
		return gateway.Subscription{}, ErrSubscriberLimit
	}
	c.subscribers[channel] = struct{}{}
	connected := c.connected
	events := cloneEvents(c.events)
	replay := make([]gateway.Event, 0, len(c.history))
	if afterID != nil {
		for _, event := range c.history {
			if event.ID > *afterID {
				replay = append(replay, cloneEvent(event))
			}
		}
	}
	c.stateMu.Unlock()

	var once sync.Once
	closeSubscription := func() {
		once.Do(func() {
			c.stateMu.Lock()
			defer c.stateMu.Unlock()
			if _, exists := c.subscribers[channel]; exists {
				delete(c.subscribers, channel)
				close(channel)
			}
		})
	}
	return gateway.Subscription{
		Snapshot: gateway.Snapshot{DaemonConnected: connected, Events: events},
		Replay:   replay,
		Events:   channel,
		Close:    closeSubscription,
	}, nil
}

func (c *Client) Snapshot() gateway.Snapshot {
	c.stateMu.RLock()
	defer c.stateMu.RUnlock()
	return gateway.Snapshot{DaemonConnected: c.connected, Events: cloneEvents(c.events)}
}

func (c *Client) Ready() bool {
	c.stateMu.RLock()
	defer c.stateMu.RUnlock()
	return c.connected
}

func (c *Client) publish(data json.RawMessage) {
	var envelope struct {
		Command         string `json:"command"`
		DaemonConnected *bool  `json:"daemon_connected,omitempty"`
	}
	if err := json.Unmarshal(data, &envelope); err != nil || envelope.Command == "" {
		return
	}
	if envelope.Command == "gateway_status" && envelope.DaemonConnected == nil {
		return
	}

	eventData := append(json.RawMessage(nil), data...)
	c.stateMu.Lock()
	defer c.stateMu.Unlock()
	if envelope.Command == "gateway_status" {
		c.connected = *envelope.DaemonConnected
	}
	if _, durable := durableEvents[envelope.Command]; durable {
		c.events[envelope.Command] = append(json.RawMessage(nil), eventData...)
	}
	c.nextEventID++
	event := gateway.Event{ID: c.nextEventID, Data: eventData}
	c.remember(event)
	for subscriber := range c.subscribers {
		select {
		case subscriber <- event:
		default:
			delete(c.subscribers, subscriber)
			close(subscriber)
		}
	}
}

func (c *Client) remember(event gateway.Event) {
	if len(event.Data) > maxReplayBytes {
		return
	}
	c.history = append(c.history, cloneEvent(event))
	c.historyBytes += len(event.Data)
	for len(c.history) > maxReplayEvents || c.historyBytes > maxReplayBytes {
		c.historyBytes -= len(c.history[0].Data)
		c.history = c.history[1:]
	}
}

func cloneEvents(events map[string]json.RawMessage) map[string]json.RawMessage {
	cloned := make(map[string]json.RawMessage, len(events))
	for command, event := range events {
		cloned[command] = append(json.RawMessage(nil), event...)
	}
	return cloned
}

func cloneEvent(event gateway.Event) gateway.Event {
	return gateway.Event{ID: event.ID, Data: append(json.RawMessage(nil), event.Data...)}
}
