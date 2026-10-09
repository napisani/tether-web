# Optional MCP interface

Status: implemented with the official Go MCP SDK v1.8.0 and Go 1.25. MCP
2026-07-28 adds opt-in phone change subscriptions, documented in
[MCP_SUBSCRIPTIONS.md](MCP_SUBSCRIPTIONS.md). The tools match the
web UI's features. [MCP_SETUP.md](MCP_SETUP.md) lists them, and
[ARCHITECTURE.md](ARCHITECTURE.md) describes the code as built. This document
keeps the design reasoning, and its sketches are not the final signatures.

Where the build differs from the sketch below:

- Stateless Streamable HTTP with JSON responses for ordinary calls. Explicit
  `subscriptions/listen` POST requests use SSE; standalone GET/SSE remains absent.
  Observer failure closes listens and fails tools closed while the web UI runs.
- One result type carries the outcome variants, with a `status` and optional
  `pairing_code`, `challenge_id` and `summary` fields, instead of a closed union.
  Statuses are `pending`, `correlated_success`, `correlated_failure`, `observed`,
  `reported_failure`, `unknown`, `needs_pairing_verification`,
  `confirmation_required` and `cancelled`.
- `observed` and `reported_failure` cover results the daemon cannot attribute to a
  request. A `reported_failure` stays open, because the expected state can still
  appear.
- Confirmations are single-use challenges approved with `confirm_action`. Stateless
  transport cannot perform SDK elicitation, so approval is a caller acknowledgment,
  not proof that a person agreed.
- `gateway.Uploads` is shared by the browser and MCP, with typed `Start`, `Append`,
  `Send` and `Cancel` methods and a typed `UploadError`. `mcpserver.New` takes it.
- Upload tools are `begin_upload`, `append_upload`, `send_upload` and
  `cancel_upload`. Large files need many chunk calls, so they suit small files.
- Retry protection and operation lookup last one hour, with a limit of 256 records.
  `send_message` and `dial_call` also require the current `instance_id`.

## Problem

Add an opt-in agent interface alongside the existing web UI. Agents get the same single-owner authority and supported phone actions, without needing an open browser. The challenge is that Go currently forwards commands while React owns feature-specific request state, confirmations, and result handling. MCP needs equivalent client behavior without relocating phone policy into the gateway.

The agreed feature contract is:

- `TETHER_WEB_MCP_ENABLED=true` enables MCP; it is off by default.
- MCP and the web UI coexist on the running server.
- Agents have the same authority as authenticated UI users; no per-agent permission tiers.
- Destructive retention changes, plaintext retention, and device trust changes require explicit confirmation through the agent client.
- A person verifies Bluetooth pairing codes on the physical phone.
- The initial version supported on-demand reads/actions and operation checks. The
  subscription extension is host-driven monitoring, not autonomous phone actions.
- Files arrive as agent-provided uploads, never server filesystem paths.
- Existing daemon capabilities and restrictions remain authoritative.
- Browser-only preferences and presentation are excluded. Deferred UI capabilities are not silently added.

## Usage, before types

An agent should see concrete tools, not a generic daemon-command escape hatch:

```text
get_status()
list_threads(query="Alex", limit=20)
list_messages(thread_id="tel:...", limit=50)
send_message(thread_id="tel:...", body="Running late", request_key="...")
get_operation(operation_id="...")
```

Reading messages does not mark them read. `mark_messages_read` is a separate tool. Thread identifiers and contact addresses preserve the daemon's namespaces; the client does not guess the recipient from a display name.

An ordinary write returns a typed operation outcome. It may complete during the tool call, remain pending, or become uncertain. A settings change with privacy consequences first returns a confirmation challenge:

```text
set_retention(mode="none", request_key="...")
  -> confirmation_required, challenge_id, description of deletion
confirm_action(challenge_id="...", decision="approve")
  -> pending, operation_id
get_operation(operation_id="...")
  -> observed state, correlated result, or unknown outcome
```

The second call executes the saved action. It cannot change the target or payload. This is explicit caller confirmation, not cryptographic proof that a human approved it. Client-mediated human approval requires a supported interaction mechanism; the server must not invent approval when the client lacks one.

Bluetooth pairing has a separate continuation:

```text
pair_bluetooth_device(address="...", request_key="...")
  -> pending, operation_id
get_operation(operation_id="...")
  -> needs_pairing_verification, operation_id, six_digit_code
confirm_pairing(operation_id="...", codes_match=true)
  -> pending
```

Acceptance must come from a person checking the phone, not an agent guessing that a displayed code matches. Pairing confirmation is bound to the daemon operation, not to a global "current pairing" field.

Process composition should look like this. These are proposed signatures, not SDK calls:

```go
bus := daemon.New(socketPath, time.Second)
uploads := gateway.NewUploads(bus, filepath.Dir(socketPath))

var agentHandler http.Handler
var agent *mcpserver.Server
if config.MCPEnabled {
    agent, err = mcpserver.New(bus, uploads, mcpserver.Config{Version: version})
    if err != nil {
        return err
    }
    agentHandler = agent.Handler()
}

handler := gateway.NewHandler(bus, assets, gateway.Config{
    AllowedHosts: config.AllowedHosts,
    Auth:         config.Auth,
    Uploads:      uploads,
    MCPHandler:   agentHandler,
})

// The process owns starting, stopping, and joining background work.
// Establish agent event consumption before accepting tool calls.
// Run bus.Run(ctx), agent.Run(ctx) when enabled, and the HTTP server.
```

Upload shutdown must preserve files that the daemon may still be reading. It must not delete an in-flight file simply because an HTTP request or agent session ended.

## Grounding in the existing application

### Commands and outcomes

`cmd/tether-web/main.go` constructs `daemon.Client`, starts its reconnect loop, and gives it to `gateway.NewHandler`. `internal/gateway/commands.go` validates HTTP framing, intercepts upload commands, and forwards other JSON through `Bus.Send`. Its HTTP 202 response acknowledges forwarding, not completion.

`internal/daemon/connection.go` serializes socket writes and bounds write duration. A write error can occur after some or all bytes reached the daemon. Expected validation errors before dispatch and uncertain write outcomes therefore need different handling.

### Events and reads

`internal/daemon/events.go` owns fan-out, monotonic event IDs, bounded replay, and atomic subscription plus snapshot creation. Each subscriber has a bounded channel; overflow closes that subscription.

The durable snapshot includes connectivity and selected device/status events. It does not include thread lists, conversation histories, contacts, notifications, or live call lists. Those require daemon commands and suitable reply handling. Durable events also survive disconnects, so their presence alone does not prove current-phone availability.

An MCP client must attach its event handling before it sends commands. It must match read replies by their available selectors, such as thread ID or contact query. An event received after dispatch is not necessarily caused by that request: other browsers and clients can issue the same uncorrelated command. Results should describe a current observation, not promise request-specific freshness the protocol cannot prove.

### Existing client behavior

- `ui/src/views/messages/useMessages.ts` completes sends only for matching operation and thread IDs. Its normal conversation view also requests read marks; MCP deliberately makes this a separate action.
- `ui/src/views/calls/useCalls.ts` ignores global call results as proof of its own action. It observes targeted call/audio state. Dialing can remain uncertain even when an outgoing call appears.
- `ui/src/views/settings/useSettings.ts` uses matching host status to observe a requested setting. That proves the host value, not which client changed it.
- `ui/src/views/devices/useBluetoothCommands.ts` binds pair/unpair and numeric-comparison confirmation to operation IDs.
- `internal/gateway/uploads.go` stages bounded chunks, subscribes before forwarding `send_file`, and keeps ambiguous sends until a correlated terminal result or expiry.

### Ownership rationale

`docs/ARCHITECTURE.md` and `AGENTS.md` explicitly reserve domain decisions for `tetherd`. The gateway owns transport, HTTP security, staging, snapshots, and limits. Feature clients own their interaction state. Local history also records browser staging in `0067b1c` and guarded call handling in `6a8af42`; these corroborate the current split, but do not establish every implementation-time motivation.

Preserve the daemon protocol, transparent browser command handling, `gateway.Bus`, and the UI's result caution. Add MCP-specific interaction state outside gateway. Avoid arbitrary-command tools, invented daemon capabilities, independent Bluetooth policy, and convenience-only upstream protocol changes.

External PR discussions and other external evidence were not examined. This is a local source/document/history-grounded design.

## Shape

### Module map

```text
cmd/tether-web/
  main.go                 env parsing, composition, shared process lifecycle

internal/daemon/           unchanged transport ownership
  client.go
  connection.go
  events.go

internal/gateway/
  bus.go                  preserve the existing Bus interface
  server.go               optional MCP handler mount under shared security
  security.go             HTTP authentication and request validation
  commands.go             transparent browser commands and upload decoding
  uploads.go              one shared, typed upload-staging implementation

internal/mcpserver/
  server.go               MCP HTTP/session setup and owned tool-set lifetime

  tools/
    tools.go              tool-set construction and explicit group registration
    protocol.go           private validated daemon wire shapes actually used
    operations.go         bounded operation identity, expiry, and lookup
    confirmations.go      saved actions, expiry, approval/rejection continuations
    status.go             capabilities, current-session readiness, diagnostics
    messages.go           definitions, handlers, read matching, send outcomes
    contacts.go           definitions, handlers, bounded search/read adaptation
    notifications.go      definitions, handlers, dismissal outcome handling
    calls.go              definitions, handlers, call/audio state observation
    devices.go            discovery, trust, pairing, unpairing, supervision
    airpods.go            definitions, handlers, AirPods state/outcome handling
    files.go              shared staging, batches, and send outcomes
    settings.go           definitions, handlers, host-setting observation
```

This is an ownership map, not a requirement to create every file immediately. Add files with implemented features. Each domain file contains its tool definitions, typed inputs/outputs, handlers, command encoding, relevant event decoding, and completion rules.

In Go, `tools/` is a separate package, not just a visual folder. The dependency direction is `mcpserver -> tools -> gateway.Bus`. Tools must not import `mcpserver` or define methods on its `Server`. Shared tool interaction state lives with the handlers in `tools/`; the parent owns HTTP/session setup and the tool set's process lifetime.

### Package interfaces

The existing transport seam remains:

```go
type Bus interface {
    Send(context.Context, json.RawMessage) error
    Subscribe(*uint64) (Subscription, error)
    Snapshot() Snapshot
    Ready() bool
}
```

Raw JSON stays at this existing low-level transport seam. MCP tool inputs and results use concrete validated types, not raw daemon envelopes.

Proposed new package interface:

```go
package mcpserver

type Config struct {
    Version string
}

type Server struct { /* private HTTP/session state and owned tools.Set */ }

func New(bus gateway.Bus, uploads *gateway.Uploads, config Config) (*Server, error)
func (s *Server) Handler() http.Handler
func (s *Server) Run(ctx context.Context) error
```

Bodies are not implemented. The parent constructs a concrete `tools.Set`, registers its definitions with the SDK, and owns its runtime until cancellation. `Handler` exposes MCP HTTP behavior, not raw command forwarding. Exact SDK types must be selected and verified before implementation.

The tool package has a small integration interface:

```go
package tools

type Set struct { /* private feature state and operation records */ }

func New(bus gateway.Bus, uploads *gateway.Uploads) *Set
func (t *Set) Run(ctx context.Context) error
```

It also provides `Register` against the chosen SDK's server type. That SDK-specific registration seam is deliberate: these are MCP tool definitions, not a reusable transport-independent Tether client. The parent does not call individual feature handlers. `tools.go` registers the feature groups explicitly; domain handlers remain private methods on `Set`.

Gateway composition accepts an opaque handler:

```go
package gateway

type Config struct {
    AllowedHosts []string
    Auth         *BasicCredentials
    Uploads      *Uploads
    MCPHandler   http.Handler
}
```

Gateway does not import `mcpserver`. This avoids a cycle because MCP consumes `gateway.Bus`. The mount receives the same authentication and host protection as browser routes. Disabled MCP must explicitly return 404 at `/mcp`, not fall through to the embedded SPA.

The shared staging object replaces the private `uploadStore` with typed operations:

```go
type UploadID string

type UploadSpec struct {
    ID       UploadID
    Filename string
    Size     int64
}

type Uploads struct { /* existing bounded staging state */ }

func NewUploads(bus Bus, stagingDir string) *Uploads
func (u *Uploads) Start(spec UploadSpec) error
func (u *Uploads) Append(id UploadID, index int, data []byte) error
func (u *Uploads) Send(ctx context.Context, id UploadID) error
func (u *Uploads) Cancel(id UploadID) error
```

The gateway's browser adapter decodes JSON/base64 and translates typed errors to HTTP status codes. MCP translates the same typed errors into tool outcomes. Both use the same instance, limits, cleanup, and daemon-visible storage. `Send` means dispatch; its error must distinguish definitely-not-forwarded from potentially-forwarded. Terminal delivery still comes from the daemon.

Keep staging in gateway for now. Moving it into a new package that imports `gateway.Bus` would create a cycle when gateway imports that package. Moving the whole bus/type seam into a neutral package is an alternative, but is unnecessary for this feature.

### Feature interfaces inside MCP

Use concrete operations rather than an exported Tether interface with dozens of forwarding methods:

```go
type ThreadQuery struct {
    Search string
    Limit  int
}

type SendMessageInput struct {
    RequestKey string
    ThreadID   string
    Body       string
}

func (t *Set) listThreads(ctx context.Context, query ThreadQuery) (ThreadPage, error)
func (t *Set) sendMessage(ctx context.Context, input SendMessageInput) (Outcome, error)
func (t *Set) operation(ctx context.Context, id string) (Outcome, error)
```

The other features follow the same concrete pattern. SDK validation and wire parsing happen at the relevant inputs. Client adaptation includes explicit mark-read behavior, bounded output, thread/contact search semantics, readiness checks, pending state, and result interpretation. Phone validation and delivery policy still belong to `tetherd`.

`Outcome` should be a closed set of variants, not an optional-field struct permitting impossible combinations:

```text
Pending(operation_id)
ConfirmationRequired(challenge_id, exact_action_summary, expires_at)
PairingVerificationRequired(operation_id, displayed_code, expires_at)
CorrelatedSuccess(operation_id, daemon_result)
CorrelatedFailure(operation_id, daemon_result)
StateObserved(operation_id, observation, observed_at)
Unknown(operation_id, reason, next_check)
Cancelled(operation_id)
```

Input/capability rejection before dispatch is a typed error and does not imply an action happened. Operation variants map to structured MCP output with a discriminator. `StateObserved` deliberately differs from `CorrelatedSuccess`.

### Runtime ownership and invariants

- One MCP client event consumer handles routing and operation bookkeeping. It exists only while MCP is enabled; internal event consumption is needed even though agents have no monitoring feature.
- Register pending work before dispatch. Fast daemon results must not race registration, and a late dispatch return must not overwrite an already completed operation.
- Bound pending operations, confirmation challenges, request-key records, tool output, subscribers, request bodies, and all waiting durations.
- Keep bookkeeping locks short and outside daemon writes or waits. Feature completion rules remain concrete; do not add a declarative workflow engine.
- Reads match the available selectors and serialize/coalesce MCP requests where needed. Local serialization cannot exclude concurrent browser commands or manufacture correlation.
- Track connection generations. Clear private/current-phone observations on daemon/profile loss. Invalidated or closed event subscriptions stop confident result interpretation and make dispatched unresolved actions uncertain. Re-establish observation before accepting new work.
- A cancelled tool request does not undo a dispatched message, call, or file. Continue tracking dispatched operations under the process lifetime, and retain uncertain outcomes for a bounded time. A later matching result may resolve them.
- Use server-generated daemon operation IDs distinct from caller retry keys. Never let accidental duplicate IDs claim another browser's operation.
- Within the advertised bounded record lifetime, identical request-key/payload retries reuse the operation. Reusing a key with a different payload is rejected. Do not promise exactly-once behavior across expiry or restart, or automatically retry a key whose outcome is unknown.
- Confirmation challenges save the exact typed action and bind its target, connection generation, and caller continuity. Approval atomically consumes the challenge once, rechecks availability/state, and dispatches that saved action. Repeated approval resolves to the same tracked operation, not another dispatch.
- MCP sessions, operation IDs, and challenges do not replace HTTP authentication. All callers remain one owner; session scoping prevents accidental mix-ups, not a new permission tier.
- Keep transient message/contact/notification content out of persistent operation logs and disk caches. Do not log sensitive tool inputs by default.

### Upload behavior

Share the existing limits: two active staged files across browser and MCP, at most 256 MiB each, and bounded chunks currently 48 KiB. Do not allocate separate per-client stores that double these limits.

MCP can expose `begin_upload`, `append_upload`, `send_upload`, and `cancel_upload`, with an opaque upload ID. Batched sending sequences files and reports individual results. Once forwarding may have happened, cancellation cannot claim to recall delivery.

Chunk upload is a transport protocol, not a task for the model to manufacture base64. A real agent client needs file-I/O tooling or a helper to read and submit the bytes. Large files mean many chunk calls; verify a practical upload workflow with the chosen agent client before claiming large-file parity. A future binary upload path is infrastructure work, but is not assumed here.

The current staged `send_file` command contains a path and operation ID, not a recipient. MCP must preserve the existing daemon delivery behavior rather than advertise unsupported per-peer targeting. Upload progress means bytes staged, not confirmed phone/peer delivery progress.

### HTTP and authentication

Recommend a single optional `/mcp` endpoint on the existing listener, using a standard MCP HTTP transport and SDK. Do not implement JSON-RPC/session negotiation manually or call back into the server over localhost HTTP.

Reuse the existing owner authentication where supported by the target agent clients. HTTP Basic compatibility is not assumed to be universal; verify it before choosing the SDK/client configuration. If another credential scheme is necessary, it needs an explicit authentication design, not a weakening of browser security.

Preserve host checks, body limits, HTTPS deployment requirements, and no open CORS policy. Existing origin validation applies only to non-GET/non-HEAD requests. MCP HTTP methods and any streams need deliberate origin protection, including applicable GET behavior. SDK sessions and long-lived requests also need bounded resources and shutdown behavior. When the environment variable is off, create no MCP subscriber, sessions, or background work. Malformed configuration should fail startup rather than silently enable MCP.

## Synthesis decision

No independent model candidate completed. The requested multi-model workflow failed before either grounding child started because the host installation lacked `@earendil-works/pi-agent-core/node`. The owner authorized proceeding directly. This recommendation compares two structures through parent analysis; it is not presented as multi-model consensus.

Choose the concentrated MCP client design as the base. The owner's directory preference separates `internal/mcpserver` HTTP/session setup from `internal/mcpserver/tools` definitions and tool interaction state. This does not introduce an independent reusable Tether client interface: tools register directly with the SDK, and feature handlers remain private to their package. Retain the alternative's strong typed operation/result interfaces. Share upload staging because it already has two actual consumers.

The parent hides HTTP/session setup and process composition. The tool set hides daemon reply matching, client interaction state, result uncertainty, and confirmation lifecycles behind construction, SDK registration, and one runtime method. The dependency direction avoids circular imports and keeps feature knowledge colocated. The shared upload module hides bounded disk staging and cleanup rather than merely forwarding arguments.

## Tradeoffs accepted

- We accept separate React and Go client interaction logic in exchange for preserving a transparent gateway and avoiding a UI rewrite.
- We accept MCP-specific tool/client coupling in exchange for no unused general-purpose client interface. The `tools/` package separates tool code from HTTP/session setup; a second client caller can justify further extraction later.
- We accept uncertain outcomes where the daemon lacks request attribution in exchange for honest results and no unapproved upstream changes.
- We accept bounded, process-local retry tracking in exchange for no persistence system or false exactly-once claim.
- We accept chunk-based upload complexity initially in exchange for reusing the existing bounded transport; practical large-file ergonomics remain a verification requirement.

## Alternatives considered

### Independent Go client module plus MCP adapter

`internal/tetherclient` would expose typed feature operations and own pending state, while `internal/mcpserver` would register tools and format results. This is viable if the client is independently useful. Today it has one caller, introduces another interface and mapping for every feature, and risks many shallow pass-through methods. It loses on present locality and integration size, not because transport independence is inherently undesirable.

### Move feature behavior into a shared Go application module

Both HTTP and MCP would call typed Go feature methods. This hides complexity for both callers, but changes the browser's transparent transport contract and relocates feature ownership from React. It is a larger product/client refactor and conflicts with the current gateway contract. Reject for this feature.

### Raw daemon commands as MCP tools

This minimizes server implementation but makes agents understand protocol details, confirmation ordering, capability checks, and global result uncertainty. Its interface is shallow and exposes more than UI parity. Reject.

## Verification of the sketch

The design is not implemented. These are required proof cases, not passing tests:

1. MCP disabled returns 404 and creates no background subscriptions; enabled shares the protected listener while UI flows remain unchanged.
2. Status/read tools distinguish empty results from missing capabilities or disconnected profiles and cannot treat retained previous-phone metadata as current readiness.
3. Register-before-send catches an immediate correlated message result, including a result arriving before the write call returns.
4. Two agents and a browser cannot complete the wrong message/pairing operation. Global call results never claim a local dial completed.
5. An observed setting value reports observed state rather than attribution to the caller.
6. Request cancellation, partial socket writes, event-channel overflow, daemon reconnect, and late results preserve truthful uncertainty without automatic retries.
7. Duplicate mutation keys and duplicate confirmation approvals do not dispatch twice within the stated record lifetime; mismatched payloads are rejected.
8. Confirmations cannot change target/payload, survive an invalidated pairing generation, or approve an expired challenge.
9. Browser and MCP share upload quota. Pre-send cancellation cleans staged bytes; ambiguous forwarding retains the file until matching completion or expiry.
10. Real target-agent exercises validate authentication, supported confirmation interactions, bounded structured results, and file upload usability.

## Open questions and risks

- Which agent clients must work in version one, and do they support the chosen HTTP authentication and human-confirmation interaction?
- Is an explicit two-step caller acknowledgment sufficient for destructive settings, or must a supported client UI deliver human approval? The server cannot prove human intent from a tool argument.
- Is chunk-based MCP upload usable for the file sizes actually expected, or should a binary upload helper be part of the initial delivery?
- What record lifetime and capacity should operation lookup and duplicate-request protection advertise?

## Next implementation step

After agreement, add the opt-in protected endpoint and `get_status` through the real gateway against a fake Unix-socket daemon, then prove one correlated message-send workflow before expanding the tool inventory.
