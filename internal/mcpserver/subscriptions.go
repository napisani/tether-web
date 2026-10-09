package mcpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"slices"
	"sync"
)

// SDK v1.8 registers resource subscriptions before writing the acknowledgment.
func validateListenEnvelope(body []byte) ([]byte, error) {
	var envelope map[string]json.RawMessage
	var params map[string]json.RawMessage
	var notifications map[string]json.RawMessage
	if json.Unmarshal(body, &envelope) != nil || json.Unmarshal(envelope["params"], &params) != nil || json.Unmarshal(params["notifications"], &notifications) != nil || notifications == nil {
		return nil, fmt.Errorf("invalid listen parameters")
	}
	if raw, ok := notifications["resourceSubscriptions"]; ok {
		var uris []string
		if json.Unmarshal(raw, &uris) != nil || uris == nil || len(uris) > 2 {
			return nil, fmt.Errorf("at most two fixed resource URIs required")
		}
		unique := make([]string, 0, len(uris))
		for _, uri := range uris {
			if err := validateChangeURI(uri); err != nil {
				return nil, err
			}
			if !slices.Contains(unique, uri) {
				unique = append(unique, uri)
			}
		}
		notifications["resourceSubscriptions"], _ = json.Marshal(unique)
	}
	params["notifications"], _ = json.Marshal(notifications)
	envelope["params"], _ = json.Marshal(params)
	return json.Marshal(envelope)
}

// SDK v1.8 registers resource subscriptions before writing the acknowledgment.
// Drop invalidations until that acknowledgment has entered the stream. A client
// MUST subscribe-before-read: its baseline read recovers these coalesced changes.
// This keeps daemon reduction and other clients independent of slow stream I/O.
func installAcknowledgmentGate(server *mcp.Server) {
	var mu sync.Mutex
	ready := make(map[mcp.Session]bool)
	server.AddReceivingMiddleware(func(next mcp.MethodHandler) mcp.MethodHandler {
		return func(ctx context.Context, method string, req mcp.Request) (mcp.Result, error) {
			if method != "subscriptions/listen" {
				return next(ctx, method, req)
			}
			session := req.GetSession()
			mu.Lock()
			ready[session] = false
			mu.Unlock()
			defer func() { mu.Lock(); delete(ready, session); mu.Unlock() }()
			return next(ctx, method, req)
		}
	})
	server.AddSendingMiddleware(func(next mcp.MethodHandler) mcp.MethodHandler {
		return func(ctx context.Context, method string, req mcp.Request) (mcp.Result, error) {
			session := req.GetSession()
			if method == "notifications/resources/updated" {
				mu.Lock()
				acked := ready[session]
				mu.Unlock()
				if !acked {
					return nil, nil
				}
			}
			result, err := next(ctx, method, req)
			if method == "notifications/subscriptions/acknowledged" && err == nil {
				mu.Lock()
				if _, active := ready[session]; active {
					ready[session] = true
				}
				mu.Unlock()
			}
			return result, err
		}
	})
}
