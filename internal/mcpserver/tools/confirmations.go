package tools

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const (
	challengeLifetime = 5 * time.Minute
	maxChallenges     = 32
)

// challenge saves one exact action until the caller approves or rejects it.
// This is an explicit caller acknowledgment, not proof that a person approved.
type challenge struct {
	expires    time.Time
	generation uint64
	run        func(context.Context) (operationResult, error)
	started    bool
	result     *operationResult
}

type confirmInput struct {
	ChallengeID string `json:"challenge_id" jsonschema:"challenge_id returned by the tool that asked for confirmation"`
	Decision    string `json:"decision" jsonschema:"approve to run the saved action exactly as described, or reject to discard it"`
}

func (t *Set) registerConfirmationTools(server *mcp.Server) {
	destructive := true
	mcp.AddTool(server, &mcp.Tool{
		Name: "confirm_action",
		Description: "Approve or reject an action that needs explicit confirmation, such as deleting retained history, " +
			"storing it unencrypted, or changing device trust. Approve only when the user has agreed to exactly the " +
			"summary shown. Approving runs the saved action; it cannot change the target.",
		Annotations: &mcp.ToolAnnotations{DestructiveHint: &destructive},
	}, t.confirmAction)
}

// ask saves run and returns the confirmation request. Nothing is sent to
// tetherd until the caller approves.
func (t *Set) ask(summary string, run func(context.Context) (operationResult, error)) (operationResult, error) {
	now := time.Now()
	t.mu.Lock()
	defer t.mu.Unlock()
	t.expireChallenges(now)
	pending := 0
	for _, existing := range t.challenges {
		if existing.result == nil {
			pending++
		}
	}
	if pending >= maxChallenges {
		return operationResult{}, errors.New("too many pending confirmations; approve or reject one first")
	}
	id := "chal-" + rand.Text()
	expires := now.Add(challengeLifetime)
	t.challenges[id] = &challenge{expires: expires, generation: t.generation, run: run}
	slog.Info("mcp confirmation", "event", "requested", "challenge_id", id)
	return operationResult{
		Status: statusConfirmation, ChallengeID: id, Summary: boundedText(summary, 1024), ExpiresAt: expires,
		Message: "Nothing has been sent. Call confirm_action with this challenge_id to approve or reject.",
	}, nil
}

func (t *Set) confirmAction(ctx context.Context, _ *mcp.CallToolRequest, input confirmInput) (*mcp.CallToolResult, operationResult, error) {
	if input.Decision != "approve" && input.Decision != "reject" {
		return nil, operationResult{}, errors.New("decision must be approve or reject")
	}
	now := time.Now()
	t.mu.Lock()
	t.expireChallenges(now)
	c := t.challenges[input.ChallengeID]
	if c == nil {
		t.mu.Unlock()
		return nil, operationResult{}, errors.New("confirmation unavailable or expired; nothing was sent")
	}
	if c.result != nil {
		result := *c.result
		t.mu.Unlock()
		return nil, result, nil
	}
	if c.started {
		t.mu.Unlock()
		return nil, operationResult{}, errors.New("this confirmation is already being processed; check get_operation")
	}
	if input.Decision == "reject" {
		delete(t.challenges, input.ChallengeID)
		t.mu.Unlock()
		slog.Info("mcp confirmation", "event", "rejected", "challenge_id", input.ChallengeID)
		return nil, operationResult{Status: statusCancelled, Message: "Action discarded; nothing was sent.", ExpiresAt: c.expires}, nil
	}
	if !t.currentConnection() || c.generation != t.generation {
		delete(t.challenges, input.ChallengeID)
		t.mu.Unlock()
		return nil, operationResult{}, errors.New("the daemon connection changed since this confirmation was issued; nothing was sent")
	}
	c.started = true
	t.mu.Unlock()
	slog.Info("mcp confirmation", "event", "approved", "challenge_id", input.ChallengeID)

	result, err := c.run(ctx)
	t.mu.Lock()
	defer t.mu.Unlock()
	if err != nil {
		delete(t.challenges, input.ChallengeID)
		return nil, operationResult{}, fmt.Errorf("approved action could not start: %w", err)
	}
	c.result = &result
	return nil, result, nil
}

func (t *Set) expireChallenges(now time.Time) {
	for id, c := range t.challenges {
		if !now.Before(c.expires) {
			delete(t.challenges, id)
		}
	}
}
