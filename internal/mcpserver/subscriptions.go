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
// Retain coalesced invalidations until acknowledgment sending returns. The SDK
// can flush the acknowledgment before returning: a client's baseline may already
// have completed, so dropping updates in that interval would lose observations.
// This keeps daemon reduction and other clients independent of slow stream I/O.
func installAcknowledgmentGate(server *mcp.Server) {
	var mu sync.Mutex
	type gate struct {
		ready   bool
		pending map[string]mcp.Request
	}
	ready := make(map[mcp.Session]*gate)
	server.AddReceivingMiddleware(func(next mcp.MethodHandler) mcp.MethodHandler {
		return func(ctx context.Context, method string, req mcp.Request) (mcp.Result, error) {
			if method != "subscriptions/listen" {
				return next(ctx, method, req)
			}
			session := req.GetSession()
			mu.Lock()
			ready[session] = &gate{pending: make(map[string]mcp.Request, 2)}
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
				g := ready[session]
				if g != nil && !g.ready {
					params := req.GetParams().(*mcp.ResourceUpdatedNotificationParams)
					if validateChangeURI(params.URI) == nil {
						g.pending[params.URI] = req
					}
					mu.Unlock()
					return nil, nil
				}
				mu.Unlock()
				if g == nil {
					return nil, nil
				}
			}
			result, err := next(ctx, method, req)
			if method == "notifications/subscriptions/acknowledged" && err == nil {
				mu.Lock()
				var pending map[string]mcp.Request
				if g := ready[session]; g != nil {
					g.ready = true
					pending = g.pending
					g.pending = nil
				}
				mu.Unlock()
				// Never hold the shared gate lock during stream I/O.
				for _, uri := range []string{"tether://messages/changes", "tether://calls/changes"} {
					if update := pending[uri]; update != nil {
						if _, sendErr := next(ctx, "notifications/resources/updated", update); sendErr != nil {
							return result, sendErr
						}
					}
				}
			}
			return result, err
		}
	})
}
