package tools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// readTimeout bounds how long a read tool waits for the daemon's reply.
var readTimeout = 10 * time.Second

type waiter struct {
	generation uint64
	match      func(command string, data json.RawMessage) bool
	gone       chan struct{}
}

// requestAs sends a read command and returns the first reply of the named
// event that decodes as T and satisfies accept. The waiter registers before the
// write so a fast reply cannot be missed. Replies are observations: another
// client can trigger the same event, so a result is current but not attributed.
func requestAs[T any](t *Set, ctx context.Context, ready func() error, command any, event string, accept func(T) bool) (T, error) {
	var zero T
	body, err := json.Marshal(command)
	if err != nil {
		return zero, err
	}
	done := make(chan T, 1)
	w := &waiter{gone: make(chan struct{}), match: func(name string, data json.RawMessage) bool {
		if name != event {
			return false
		}
		var value T
		if json.Unmarshal(data, &value) != nil || (accept != nil && !accept(value)) {
			return false
		}
		select {
		case done <- value:
		default:
		}
		return true
	}}
	t.mu.Lock()
	if err := ready(); err != nil {
		t.mu.Unlock()
		return zero, err
	}
	w.generation = t.generation
	t.waiters[w] = struct{}{}
	t.mu.Unlock()
	defer func() {
		t.mu.Lock()
		delete(t.waiters, w)
		t.mu.Unlock()
	}()

	writeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := t.bus.Send(writeCtx, body); err != nil {
		return zero, fmt.Errorf("could not send the request to tetherd: %w", err)
	}
	timer := time.NewTimer(readTimeout)
	defer timer.Stop()
	select {
	case value := <-done:
		return value, nil
	case <-w.gone:
		return zero, errors.New("tetherd connection lost before it replied")
	case <-timer.C:
		return zero, errors.New("tetherd did not reply in time; try again")
	case <-ctx.Done():
		return zero, ctx.Err()
	}
}
