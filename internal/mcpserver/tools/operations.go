package tools

import (
	"context"
	"crypto/sha256"
	"errors"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const (
	maxOperationRecords = 256
	operationRetention  = time.Hour
	// retentionText must describe operationRetention in agent-facing text.
	retentionText = "one hour"
)

type operationStatus string

const (
	statusPending operationStatus = "pending"
	statusSuccess operationStatus = "correlated_success"
	statusFailure operationStatus = "correlated_failure"
	statusUnknown operationStatus = "unknown"
)

type operationResult struct {
	OperationID string          `json:"operation_id"`
	Status      operationStatus `json:"status"`
	Message     string          `json:"message"`
	ExpiresAt   time.Time       `json:"expires_at"`
}

type operation struct {
	result     operationResult
	requestKey string
	inputHash  [sha256.Size]byte
	threadHash [sha256.Size]byte
	deadline   time.Time
}

type operationInput struct {
	OperationID string `json:"operation_id" jsonschema:"ID returned by send_message; lookup never resends a message"`
}

func (t *Set) registerOperationTools(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{
		Name: "get_operation",
		Description: "Check a message-send operation without sending again. " +
			"Records expire after " + retentionText + " and do not survive server restart. " +
			"An unknown or missing result is not evidence that a message was not sent.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
	}, t.getOperation)
}

func (t *Set) getOperation(_ context.Context, _ *mcp.CallToolRequest, input operationInput) (*mcp.CallToolResult, operationResult, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.expireOperations(time.Now())
	op := t.operations[input.OperationID]
	if op == nil {
		return nil, operationResult{}, errors.New("operation unavailable or expired; it may have been sent, so check the iPhone before retrying")
	}
	return nil, op.result, nil
}

func (t *Set) expireOperations(now time.Time) {
	for id, op := range t.operations {
		if !now.Before(op.result.ExpiresAt) {
			delete(t.operations, id)
			delete(t.requestKeys, op.requestKey)
		} else if op.result.Status == statusPending && !now.Before(op.deadline) {
			op.result.Status = statusUnknown
			op.result.Message = "No matching message result; check the iPhone before retrying."
		}
	}
}

func (t *Set) uncertainMessages(reason string) {
	for _, op := range t.operations {
		if op.result.Status == statusPending {
			op.result.Status = statusUnknown
			op.result.Message = reason
		}
	}
}
