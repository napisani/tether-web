package gateway_test

import (
	"bufio"
	"context"
	"encoding/json"
	"io/fs"
	"strconv"
	"strings"
	"sync"
	"testing"
	"testing/fstest"

	"github.com/napisani/tether-web/internal/gateway"
)

type fakeBus struct {
	mu           sync.Mutex
	commands     []json.RawMessage
	ready        bool
	snapshot     gateway.Snapshot
	history      []gateway.Event
	nextEventID  uint64
	subscribeErr error
	sendErr      error
	subscribers  map[chan gateway.Event]struct{}
}

func (b *fakeBus) Send(_ context.Context, command json.RawMessage) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.commands = append(b.commands, append(json.RawMessage(nil), command...))
	return b.sendErr
}

func (b *fakeBus) Subscribe(afterID *uint64) (gateway.Subscription, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.subscribeErr != nil {
		return gateway.Subscription{}, b.subscribeErr
	}
	if b.subscribers == nil {
		b.subscribers = make(map[chan gateway.Event]struct{})
	}
	ch := make(chan gateway.Event, 4)
	b.subscribers[ch] = struct{}{}
	replay := make([]gateway.Event, 0, len(b.history))
	if afterID != nil {
		for _, event := range b.history {
			if event.ID > *afterID {
				replay = append(replay, event)
			}
		}
	}
	var once sync.Once
	return gateway.Subscription{
		Snapshot: b.snapshot,
		Replay:   replay,
		Events:   ch,
		Close: func() {
			once.Do(func() {
				b.mu.Lock()
				defer b.mu.Unlock()
				delete(b.subscribers, ch)
				close(ch)
			})
		},
	}, nil
}

func (b *fakeBus) publish(data json.RawMessage) gateway.Event {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.nextEventID++
	event := gateway.Event{ID: b.nextEventID, Data: append(json.RawMessage(nil), data...)}
	b.history = append(b.history, event)
	for subscriber := range b.subscribers {
		subscriber <- event
	}
	return event
}

func (b *fakeBus) Snapshot() gateway.Snapshot { return b.snapshot }
func (b *fakeBus) Ready() bool                { return b.ready }

func testAssets() fs.FS {
	return fstest.MapFS{
		"index.html":             &fstest.MapFile{Data: []byte("<main>Tether</main>")},
		"assets/app-deadbeef.js": &fstest.MapFile{Data: []byte("export {}")},
	}
}

func readSSEEvent(t *testing.T, reader *bufio.Reader) (uint64, string) {
	t.Helper()
	var id uint64
	var data string
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			t.Fatal(err)
		}
		line = strings.TrimSuffix(line, "\n")
		switch {
		case strings.HasPrefix(line, "id: "):
			parsed, err := strconv.ParseUint(strings.TrimPrefix(line, "id: "), 10, 64)
			if err != nil {
				t.Fatal(err)
			}
			id = parsed
		case strings.HasPrefix(line, "data: "):
			data = strings.TrimPrefix(line, "data: ")
		case line == "":
			return id, data
		}
	}
}
