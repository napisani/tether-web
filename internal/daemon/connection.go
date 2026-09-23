package daemon

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/rand/v2"
	"net"
	"time"
)

func (c *Client) Run(ctx context.Context) {
	retryDelay := c.retryInterval
	var lastDialError string
	var lastDialLog time.Time
	for ctx.Err() == nil {
		connection, err := (&net.Dialer{}).DialContext(ctx, "unix", c.socketPath)
		if err != nil {
			now := time.Now()
			if message := err.Error(); message != lastDialError || now.Sub(lastDialLog) >= dialLogInterval {
				slog.Warn("could not connect to tetherd", "socket", c.socketPath, "error", err)
				lastDialError = message
				lastDialLog = now
			}
			if !wait(ctx, jitterRetryDelay(retryDelay)) {
				return
			}
			retryDelay = growRetryDelay(retryDelay)
			continue
		}

		if lastDialError != "" {
			slog.Info("connected to tetherd", "socket", c.socketPath)
			lastDialError = ""
			lastDialLog = time.Time{}
		}
		connectedAt := time.Now()
		c.consumeConnection(ctx, connection)
		if ctx.Err() != nil {
			return
		}
		if time.Since(connectedAt) >= stableSession {
			retryDelay = c.retryInterval
		}
		if !wait(ctx, jitterRetryDelay(retryDelay)) {
			return
		}
		if time.Since(connectedAt) < stableSession {
			retryDelay = growRetryDelay(retryDelay)
		}
	}
}

func (c *Client) consumeConnection(ctx context.Context, connection net.Conn) {
	stopClose := context.AfterFunc(ctx, func() { _ = connection.Close() })
	c.setConnection(connection)
	c.publish(json.RawMessage(`{"command":"gateway_status","daemon_connected":true}`))
	c.sendBootstrapCommands(ctx)

	scanner := bufio.NewScanner(connection)
	scanner.Buffer(make([]byte, 64*1024), maxFrameBytes)
	for scanner.Scan() {
		line := append(json.RawMessage(nil), scanner.Bytes()...)
		if json.Valid(line) {
			c.publish(line)
		}
	}
	if err := scanner.Err(); err != nil && ctx.Err() == nil {
		slog.Warn("tetherd event stream ended", "error", err)
	}
	stopClose()
	c.clearConnection(connection)
	c.publish(json.RawMessage(`{"command":"gateway_status","daemon_connected":false}`))
	_ = connection.Close()
}

func (c *Client) sendBootstrapCommands(ctx context.Context) {
	for _, command := range []json.RawMessage{
		json.RawMessage(`{"command":"subscribe"}`),
		json.RawMessage(`{"command":"bt_status"}`),
		json.RawMessage(`{"command":"bt_list_devices"}`),
		json.RawMessage(`{"command":"bt_connection"}`),
	} {
		if err := c.Send(ctx, command); err != nil {
			return
		}
	}
}

func (c *Client) Send(ctx context.Context, command json.RawMessage) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	c.connectionMu.RLock()
	connection := c.connection
	c.connectionMu.RUnlock()
	if connection == nil {
		return ErrUnavailable
	}

	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	deadline := time.Now().Add(writeTimeout)
	if contextDeadline, ok := ctx.Deadline(); ok && contextDeadline.Before(deadline) {
		deadline = contextDeadline
	}
	if err := connection.SetWriteDeadline(deadline); err != nil {
		return fmt.Errorf("setting tetherd write deadline: %w", err)
	}
	payload := make([]byte, 0, len(command)+1)
	payload = append(payload, command...)
	payload = append(payload, '\n')
	written, writeErr := connection.Write(payload)
	clearErr := connection.SetWriteDeadline(time.Time{})
	if writeErr != nil || clearErr != nil {
		var commandErrors []error
		if writeErr != nil {
			commandErrors = append(commandErrors, fmt.Errorf("writing tetherd command: %w", writeErr))
		}
		if clearErr != nil {
			commandErrors = append(commandErrors, fmt.Errorf("clearing tetherd write deadline: %w", clearErr))
		}
		return errors.Join(commandErrors...)
	}
	if written != len(payload) {
		return fmt.Errorf("writing tetherd command: %w", io.ErrShortWrite)
	}
	return nil
}

func (c *Client) setConnection(connection net.Conn) {
	c.connectionMu.Lock()
	defer c.connectionMu.Unlock()
	c.connection = connection
}

func (c *Client) clearConnection(connection net.Conn) {
	c.connectionMu.Lock()
	defer c.connectionMu.Unlock()
	if c.connection == connection {
		c.connection = nil
	}
}

func growRetryDelay(delay time.Duration) time.Duration {
	if delay >= maxRetryDelay/2 {
		return maxRetryDelay
	}
	return delay * 2
}

func jitterRetryDelay(delay time.Duration) time.Duration {
	if delay >= maxRetryDelay {
		return maxRetryDelay
	}
	maxJitter := min(delay/4, maxRetryDelay-delay)
	if maxJitter <= 0 {
		return delay
	}
	return delay + time.Duration(rand.Int64N(int64(maxJitter)+1))
}

func wait(ctx context.Context, duration time.Duration) bool {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
