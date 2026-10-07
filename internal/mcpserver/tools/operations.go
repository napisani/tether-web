package tools

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/napisani/tether-web/internal/gateway"
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
	// The daemon result carried this operation's own ID.
	statusSuccess operationStatus = "correlated_success"
	statusFailure operationStatus = "correlated_failure"
	// The expected state or an unattributed success result was observed. Another
	// client could have caused it.
	statusObserved operationStatus = "observed"
	// The daemon reported a failure that is not attributed to one request.
	statusReported     operationStatus = "reported_failure"
	statusUnknown      operationStatus = "unknown"
	statusNeedsPairing operationStatus = "needs_pairing_verification"
	statusConfirmation operationStatus = "confirmation_required"
	statusCancelled    operationStatus = "cancelled"
)

type operationResult struct {
	OperationID string          `json:"operation_id,omitempty"`
	Status      operationStatus `json:"status"`
	Message     string          `json:"message"`
	ExpiresAt   time.Time       `json:"expires_at"`
	PairingCode string          `json:"pairing_code,omitempty"`
	ChallengeID string          `json:"challenge_id,omitempty"`
	Summary     string          `json:"summary,omitempty"`
}

// observation is how one daemon event moves an operation forward.
type observation struct {
	status  operationStatus
	message string
	code    string
}

// observer inspects every current-generation event for one operation. It runs
// with the tool set locked, so it must not block.
type observer func(event gateway.Event, command string) (observation, bool)

type operation struct {
	result     operationResult
	requestKey string
	inputHash  [sha256.Size]byte
	deadline   time.Time
	subject    string
	observe    observer
}

// resolvable operations can still be completed by a later matching result. An
// unattributed failure report stays resolvable: the expected state may still appear.
func (o *operation) resolvable() bool {
	switch o.result.Status {
	case statusPending, statusUnknown, statusNeedsPairing, statusReported:
		return true
	}
	return false
}

// logTransition records who did what without logging message text, numbers,
// addresses or file names, so operators can audit agent actions.
func (o *operation) logTransition(event string) {
	slog.Info("mcp operation", "event", event, "operation_id", o.result.OperationID, "subject", o.subject, "status", o.result.Status)
}

func (o *operation) apply(obs observation) {
	// A late progress event must not hide a code the caller still has to verify.
	if o.result.Status == statusNeedsPairing && obs.status == statusPending {
		return
	}
	if o.result.Status != obs.status {
		defer o.logTransition("resolved")
	}
	o.result.Status = obs.status
	o.result.Message = boundedText(obs.message, 1024)
	o.result.PairingCode = ""
	if obs.status == statusNeedsPairing {
		o.result.PairingCode = obs.code
	}
}

type operationInput struct {
	OperationID string `json:"operation_id" jsonschema:"ID returned by a tool that started an action; lookup never repeats the action"`
}

func (t *Set) registerOperationTools(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{
		Name: "get_operation",
		Description: "Check a started action without repeating it. " +
			"Records expire after " + retentionText + " and do not survive server restart. " +
			"An unknown or missing result is not evidence that the action did not happen.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
	}, t.getOperation)
}

func (t *Set) getOperation(_ context.Context, _ *mcp.CallToolRequest, input operationInput) (*mcp.CallToolResult, operationResult, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.expireOperations(time.Now())
	op := t.operations[input.OperationID]
	if op == nil {
		return nil, operationResult{}, errors.New("operation unavailable or expired; it may have happened, so check the phone or host before retrying")
	}
	return nil, op.result, nil
}

// action describes one phone or host change. start builds the daemon command
// and the observer for the operation ID, which tetherd echoes when it supports
// operation IDs for that command.
type action struct {
	// id presets the operation ID when the daemon already knows the action by it.
	id string
	// deliver replaces the plain command write for actions with their own
	// forwarding path, such as staged file sends.
	deliver    func(context.Context) error
	subject    string
	timeout    time.Duration
	instanceID string
	requestKey string
	input      any
	ready      func() error
	start      func(id string) (command any, observe observer)
}

// dispatch registers the operation before the write so a fast daemon result
// cannot race registration. A write error never proves the command was not
// delivered, so it leaves the operation unknown instead of retrying.
func (t *Set) dispatch(ctx context.Context, a action) (operationResult, error) {
	if err := ctx.Err(); err != nil {
		return operationResult{}, err
	}
	var inputHash [sha256.Size]byte
	if a.requestKey != "" {
		encoded, err := json.Marshal(a.input)
		if err != nil {
			return operationResult{}, err
		}
		inputHash = sha256.Sum256(encoded)
	}
	id := a.id
	if id == "" {
		id = "mcp-" + rand.Text()
	}
	command, observe := a.start(id)
	body, err := json.Marshal(command)
	if err != nil {
		return operationResult{}, err
	}

	now := time.Now()
	t.mu.Lock()
	t.expireOperations(now)
	// A preset ID names one daemon action, so a repeat reuses its record instead of
	// replacing the observer and acting again.
	if existing := t.operations[a.id]; a.id != "" && existing != nil {
		result := existing.result
		t.mu.Unlock()
		return result, nil
	}
	if a.requestKey != "" {
		if a.instanceID != t.instanceID {
			t.mu.Unlock()
			return operationResult{}, errors.New("server instance changed; check get_status and the phone before issuing a new request")
		}
		if existing, exists := t.requestKeys[a.requestKey]; exists {
			op := t.operations[existing]
			if op.inputHash != inputHash {
				t.mu.Unlock()
				return operationResult{}, errors.New("request_key already belongs to a different request")
			}
			result := op.result
			t.mu.Unlock()
			return result, nil
		}
	}
	if err := a.ready(); err != nil {
		t.mu.Unlock()
		return operationResult{}, err
	}
	if len(t.operations) >= maxOperationRecords {
		t.mu.Unlock()
		return operationResult{}, errors.New("operation capacity reached; nothing was dispatched")
	}
	op := &operation{
		result:     operationResult{OperationID: id, Status: statusPending, ExpiresAt: now.Add(operationRetention)},
		requestKey: a.requestKey, inputHash: inputHash, deadline: now.Add(a.timeout),
		subject: a.subject, observe: observe,
	}
	t.operations[id] = op
	if a.requestKey != "" {
		t.requestKeys[a.requestKey] = id
	}
	op.logTransition("started")
	t.mu.Unlock()

	writeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var sendErr error
	if a.deliver != nil {
		sendErr = a.deliver(ctx)
	} else {
		sendErr = t.bus.Send(writeCtx, body)
	}

	t.mu.Lock()
	defer t.mu.Unlock()
	// A refused upload never reached tetherd, so nothing is left to track.
	var refused *gateway.UploadError
	if errors.As(sendErr, &refused) && refused.NotForwarded {
		delete(t.operations, id)
		if a.requestKey != "" {
			delete(t.requestKeys, a.requestKey)
		}
		return operationResult{}, sendErr
	}
	// A daemon result can arrive before the socket write returns.
	if sendErr != nil && op.result.Status == statusPending {
		op.result.Status = statusUnknown
		op.result.Message = fmt.Sprintf("Could not confirm the %s request reached tetherd; check before retrying.", a.subject)
		op.logTransition("write_unconfirmed")
	}
	return op.result, nil
}

// complete records an already-final outcome, such as a setting that already has
// the requested value, so the caller still receives a trackable operation ID.
func (t *Set) complete(subject string, obs observation) (operationResult, error) {
	now := time.Now()
	t.mu.Lock()
	defer t.mu.Unlock()
	t.expireOperations(now)
	if len(t.operations) >= maxOperationRecords {
		return operationResult{}, errors.New("operation capacity reached")
	}
	id := "mcp-" + rand.Text()
	op := &operation{
		result:  operationResult{OperationID: id, Status: obs.status, Message: boundedText(obs.message, 1024), ExpiresAt: now.Add(operationRetention)},
		subject: subject,
	}
	t.operations[id] = op
	op.logTransition("completed")
	return op.result, nil
}

func (t *Set) expireOperations(now time.Time) {
	for id, op := range t.operations {
		if !now.Before(op.result.ExpiresAt) {
			delete(t.operations, id)
			if op.requestKey != "" {
				delete(t.requestKeys, op.requestKey)
			}
		} else if (op.result.Status == statusPending || op.result.Status == statusNeedsPairing) && !op.deadline.IsZero() && !now.Before(op.deadline) {
			op.result.Status = statusUnknown
			op.result.PairingCode = ""
			op.result.Message = fmt.Sprintf("No matching result for this %s; check before retrying.", op.subject)
			op.logTransition("timed_out")
		}
	}
}

// uncertain marks unfinished operations as unknown. An empty subject applies to
// every operation; otherwise only operations of that subject are affected.
func (t *Set) uncertain(subject, cause string) {
	for _, op := range t.operations {
		if (subject != "" && op.subject != subject) || (op.result.Status != statusPending && op.result.Status != statusNeedsPairing) {
			continue
		}
		op.result.Status = statusUnknown
		op.result.PairingCode = ""
		op.result.Message = fmt.Sprintf("%s; the %s may have taken effect. Check before retrying.", cause, op.subject)
		op.logTransition("interrupted")
	}
}
