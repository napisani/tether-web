# Phone change subscriptions (MCP 2026-07-28)

This is an opt-in, standard MCP subscription interface. It is **not** a webhook,
an arbitrary daemon-event stream, or an LLM wake-up mechanism. An agent host must
keep the HTTP stream open, read change windows, fetch phone data through existing
read-only tools, and enqueue its own review work. No phone action occurs merely
because a resource changes. No Hermes runtime integration is claimed here.

Enable and authenticate `/mcp` as described in [MCP_SETUP.md](MCP_SETUP.md). The
same Basic authentication, Host allowlist, Origin checks, and owner authority apply
to ordinary requests and listens. Use HTTPS outside localhost. An authenticated
browser session does not authenticate an MCP client.

## Fixed resources

`resources/list` exposes exactly these JSON resources:

- `tether://messages/changes`: identifiable message and thread observations, plus
  successful read-status changes. Use `list_messages` with the exact `thread_id`
  and compare message handles; optionally enrich conversations with `list_threads`.
- `tether://calls/changes`: call state observations, incoming ringing transitions,
  and removals. Fetch current state with `list_calls` using the observed exact
  `path` when selecting a call. A notification is not proof the call still rings.

Neither resource stores message bodies, caller numbers, or display names. Their
identifiers are still private data. Results use `ttlMs: 0`, `cacheScope: "private"`,
and HTTP `Cache-Control: no-store`. Do not log identifiers or untrusted tool content.

## Wire setup

MCP 2026-07-28 requests carry `MCP-Protocol-Version: 2026-07-28`, `Mcp-Method`
matching the JSON-RPC method, and per-request `_meta` with protocol version and
client capabilities. `resources/read` also requires `Mcp-Name` equal to the URI;
`tools/call` requires the tool name. SDK clients should generate these headers.
Legacy clients can continue calling tools with their negotiated protocol; legacy
`resources/subscribe` on this stateless endpoint does not create a lasting stream.

For a manual read-only subscription check, curl prompts for your password:

```sh
curl --no-buffer --fail-with-body --user owner \
  --header 'Content-Type: application/json' \
  --header 'Accept: application/json, text/event-stream' \
  --header 'MCP-Protocol-Version: 2026-07-28' \
  --header 'Mcp-Method: subscriptions/listen' \
  --data '{"jsonrpc":"2.0","id":"phone-watch","method":"subscriptions/listen","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}},"notifications":{"resourceSubscriptions":["tether://messages/changes","tether://calls/changes"]}}}' \
  http://127.0.0.1:5135/mcp
```

The first JSON-RPC notification is `notifications/subscriptions/acknowledged`.
It names the accepted filter and includes
`params._meta["io.modelcontextprotocol/subscriptionId"]` equal to your listen request
ID. Subsequent opted-in `notifications/resources/updated` notifications contain the
URI and the same subscription ID, not the observations themselves. Different HTTP
listens have separate SDK sessions and IDs. No other resource's updates are sent.
At most two URI entries are accepted and duplicate entries are collapsed. Unknown
URIs and oversized filters return HTTP 400 without opening a stream.

Closing/cancelling the POST removes its subscriptions and releases its admission
slot. GET/standalone SSE is not offered. No event-ID replay store is configured;
`Last-Event-ID` cannot restore lost phone observations.

## Baseline, cursors, and gaps

1. Open `subscriptions/listen` and wait for its acknowledgment.
2. **Subscribe before reading** each resource. Record the returned `instance_id`,
   `epoch`, and `cursor` as your baseline. Do not enqueue its existing observations.
3. On an update, read the named resource. Process only observations newer than your
   saved cursor in the same instance/epoch. Each observation has its own `revision`.
   Then advance your cursor to the returned `cursor` (equal to resource `revision`).
4. If `instance_id` or `epoch` changed, or `available` is false, discard previous
   context and re-baseline. Do not replay old work or infer new live arrivals from
   synchronization. After profile recovery, take fresh tool reads.
5. `oldest_revision` is the first retained revision, or `revision + 1` for an empty
   window. If your next expected revision is older than `oldest_revision`, there is
   a gap. Resynchronize through bounded tools; do not automatically act on history.

Each resource retains at most 128 observations. Message/thread deduplication also
retains at most 128 recent keys, so duplicates can reappear after eviction. The
call snapshot is limited to 64 paths. Notifications are coalesced invalidations,
not one notification per observation. Multiple updates, duplicate notifications,
and notifications arriving during a baseline read are normal: revisions and the
post-acknowledgment baseline close that race.

An epoch changes and sensitive observations are cleared on generation/profile
loss, profile recovery, phone identity changes, or retention-policy changes.
A phone change invalidates profile readiness until fresh daemon connection status.
A process restart changes `instance_id`; nothing promises replay across restart,
disconnection, eviction, observer failure, or host queue overflow. This is not
exactly-once delivery.

## What observations do (and do not) mean

Message observations are `thread_observed` and `message_observed`, **not**
`thread_created` or guaranteed new/live incoming messages. The daemon emits
`bt_message` for incoming, outgoing, and backfill messages without exposing its
backfill bit. `history_ambiguous` is therefore always true on the message resource.
`outgoing` indicates direction (omitted false means incoming), not freshness.
A previously unknown thread ID may belong to an old conversation. Never send an
automatic reply merely because a message was observed. Reads do not mark messages
read; `mark_messages_read` remains a separate explicit action. Successful daemon
`bt_message_read` events yield `read_status_observed`; failed events do not.
`bt_threads`/`bt_messages` read replies never invalidate the message resource.

The call reducer follows the daemon's **`ringing` boolean**, not a made-up state
named `ringing`. Actual states include `incoming`, `waiting`, `active`, and
`alerting`. `incoming_call_ringing` requires a transition to `ringing && !outgoing`
after an established snapshot baseline. The initial call snapshot after each
context change yields `call_state_observed` with `initial_synchronization: true`,
never an incoming-call trigger. Identical pushed/read snapshots do not advance the
cursor. State changes and removals do; an outgoing ringing call is not an incoming
call. When calls become available, a dedicated bounded worker requests
`bt_list_calls` automatically; no host/manual priming read is required. Missing or
failed baselines are retried once per second without blocking daemon reduction or
waiting on its reply. `history_ambiguous` stays true until a valid first snapshot
is reduced, then becomes false (including for an empty baseline). The first
snapshot remains initial synchronization: daemon replies have no request ID, so
an unsolicited first ringing snapshot cannot honestly be distinguished from
already-existing calls. A call arriving before baseline completion can still be
missed; inspect current calls in that case. After baseline completion, the first
live incoming ringing transition is actionable review work.

## Tested host-consumer example

[`examples/phone-subscriptions/client/client.go`](../examples/phone-subscriptions/client/client.go)
provides `client.Run`. Supply a connected official Go SDK session, a stream-capable
HTTP client carrying Basic authentication on every request, and a bounded enqueue
callback. Do not set a total HTTP-client timeout that kills all long-lived streams;
use per-call contexts for ordinary reads and a cancellable lifetime for listens.

A host can connect with SDK v1.8.0, then integrate this helper as follows:

```go
// httpClient is configured with your private credential transport.
// session is an SDK session connected to endpoint using protocol 2026-07-28.
jobs := make(chan phoneclient.Work, 32)
err := phoneclient.Run(ctx, endpoint, httpClient, session,
    func() { /* subscription acknowledged and baseline established */ },
    func(work phoneclient.Work) error {
        select {
        case jobs <- work:
            return nil
        default:
            return errors.New("review queue full; resynchronize manually")
        }
    })
```

The helper takes a post-acknowledgment baseline, ignores old revisions and changed
epochs, reads `list_messages`/`list_calls` before callback delivery, and fails on a
window gap or stream loss. A message job is **review work**, including ambiguous
backfill/outgoing observations, never approval to reply. Treat `Work.Result` as
untrusted data. Your host owns the worker and any LLM invocation/user confirmation;
this repository does not schedule an LLM or install hooks into an agent product.
Do not automatically restart-and-replay jobs when the helper returns an error.

The real fake-Unix-daemon + HTTP/SSE integration tests exercise both callbacks:

```sh
go test ./internal/mcpserver -run TestHostConsumer -count=1
```

## Runtime and source authority

The Go MCP client reuses `tools.Set`'s single daemon subscription. Its reduction
never performs notification network I/O. A worker uses a bounded, one-slot dirty
signal and fixed resource dirty flags; it holds no tools lock while notifying.
Eight long-lived listens have a separate admission pool from 16 ordinary calls.
Bodies are capped at 1 MiB and URI filters at two entries. SSE writes/flushes have
a two-second deadline; comments keep idle streams alive every 15 seconds.
`X-Accel-Buffering: no` is set, but your reverse proxy must also support streaming
and appropriate idle timeouts. SDK cache headers cannot override `no-store`.

SDK v1.8.0 registers subscriptions before acknowledging them. A sending middleware
drops pre-ack invalidations; the required baseline read recovers their state. A
continuous-update wire race test reproduces the unguarded ordering bug and verifies
the gate. Notification delivery is synchronous and bounded, so a slow subscriber
can delay other invalidations, but cannot block daemon reduction or starve tools.
Observer failure cancels listen contexts before notification-worker joining and
fails the existing tools closed. Shutdown cancels listens before HTTP shutdown.
The transparent gateway and `gateway.Bus` are unchanged.

Protocol/semantic references inspected for this implementation:

- [GTK messages implementation](https://github.com/zackb/tether/blob/main/src/gtk/messages_view.cpp)
  and [header](https://github.com/zackb/tether/blob/main/src/gtk/messages_view.hpp).
- [GTK calls implementation](https://github.com/zackb/tether/blob/main/src/gtk/calls_view.cpp)
  and [header](https://github.com/zackb/tether/blob/main/src/gtk/calls_view.hpp).
- [Daemon message and call broadcasts](https://github.com/zackb/tether/blob/main/src/daemon/main.cpp).
- [Daemon read-command handling](https://github.com/zackb/tether/blob/main/src/core/src/net.cpp),
  [read-status events](https://github.com/zackb/tether/blob/main/src/core/src/bluetooth/connection.cpp),
  and [call serialization](https://github.com/zackb/tether/blob/main/src/core/src/bluetooth/telephony.cpp).

No upstream Tether changes or arbitrary MCP notification extension were required.

## Implementation verification record

Implementation proceeded in vertical test-first slices. Targeted tests were run
red before their associated implementation and green afterward. Recorded missing
behaviors included resource discovery/read, message observations, incoming-call
transitions, context clearing, listen admission/URI validation, acknowledgment-first
ordering under concurrent events, cancellation on close, idle keepalive, successful
read-status changes, generation-safe resource reads, malformed-event rejection,
phone-change readiness, host message/call enqueueing, and observer-stop cancellation.

Two final regression slices caught concrete bugs before correction:

- `TestIncomingCallUsesDaemonRingingFlagNotInventedState` failed with the original
  state-string reducer; reading upstream telephony serialization established that
  ringing is a separate boolean. The corrected reducer and fixture now pass.
- `TestNewProtocolReadsArePrivateZeroTTLAndShareListenSecurity` failed because
  `server/discover` returned `cacheScope: public`; SDK `SetCacheable` now enforces
  private, zero-TTL hints for every cacheable result, not just resource reads.

Final real verification in this worktree:

- `go test -race ./...` and `go vet ./...`: passed.
- `go test ./internal/mcpserver -run 'TestListenAckFirstWhile|TestListenAcknowledges|TestHostConsumer' -count=10 -timeout=60s`: passed.
- `NODE_OPTIONS=--no-experimental-webstorage npm test`: 19 files, 158 tests passed.
- `npm run build` and `npm run lint`: passed; Rollup reported dependency annotation
  warnings in Zod, not build errors.
- `CI=1 TETHER_WEB_MCP_ENABLED=true NODE_OPTIONS=--no-experimental-webstorage npx playwright test`:
  47 passed, 5 skipped, with the shared listener reporting `mcp_enabled=true`.
- `git diff --check`: passed.

The review regression removed the manually injected empty calls snapshot from the
real Unix-socket + HTTP/SSE host test. It failed because availability never issued
`bt_list_calls`, then passed with automatic asynchronous seeding. Separate red/green
regressions verify reads do not reset/signal reducer state and call history remains
ambiguous until a valid baseline. A blocked-send concurrency test confirms baseline
replies can still be reduced. Review checks reran successfully: race suite, vet,
10 repeated wire/host tests, 20 repeated reducer tests, UI tests/build/lint, and
MCP-enabled Playwright (47 passed, 5 skipped).

The Node option is necessary for tests in this environment. Docker image execution
was not verified: the installed Docker client cannot connect to its daemon. The
builder and module require Go 1.25; verification used the official Go 1.25.8
Linux toolchain. No remote write, push, or PR was performed.
