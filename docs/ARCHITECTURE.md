# Architecture

`tether-web` is a client of [`tetherd`](https://github.com/zackb/tether/tree/main/src/daemon), not another implementation of [Tether](https://github.com/zackb/tether)'s domain behavior. The daemon protocol and GTK reference client remain owned by the upstream `zackb/tether` repository.

```text
Browser (React + TypeScript)
  | POST /api/v1/commands
  | GET  /api/v1/state
  | GET  /api/v1/events (SSE)
  v
tether-web (Go transport adapter)
  | newline-delimited JSON
  v
tetherd Unix socket
  |
  v
BlueZ and Tether's existing modules
```

The tested seams are:

1. The daemon control protocol over the Unix socket.
2. The gateway's HTTP/SSE interface.
3. Browser-visible workflows.

## Protocol authority

Upstream `tetherd` defines the authoritative command and event protocol. `tether-web` consumes that interface rather than designing a preferred protocol and pushing it into the daemon. Browser-local serialization, pending state, timeouts, and reconnect cleanup should absorb platform differences whenever they can do so safely.

Before proposing an upstream change, verify the corresponding GTK flow and exercise the existing daemon commands and events. A protocol addition is justified only when the exposed interface cannot safely produce the GTK-equivalent outcome—for example, an external numeric-comparison response must be bound to the pairing operation that displayed it. Browser files can instead be staged by the gateway on a bounded, daemon-visible volume before using the existing `send_file` command. Convenience, simpler reducers, or stronger correlation for globally observable status are not sufficient on their own.

A necessary upstream addition must be narrow, backward-compatible, separately reviewed in Tether, and free of unrelated GTK or daemon refactoring. Shared upstream bugs discovered here should normally be verified and fixed separately rather than folded into a web parity batch.

The Go gateway owns reconnection, fan-out, bounded replay, durable snapshots, HTTP request checks, resource limits, and embedded assets. It does not own Bluetooth policy or expose feature-specific HTTP routes.

## Browser interface

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/commands` | Forward one JSON daemon command |
| `GET` | `/api/v1/events` | Send an atomic snapshot, bounded replay, and live daemon events |
| `GET` | `/api/v1/state` | Return the latest durable status events |
| `GET` | `/healthz` | Report gateway process liveness |
| `GET` | `/readyz` | Report whether the gateway is connected to `tetherd` |

Live events carry monotonic SSE IDs. A reconnecting `EventSource` can request events newer than its last ID, which preserves transient pairing progress and confirmation requests across short disconnects.

External pairing commands carry an `operation_id` that the daemon echoes. Browser upload commands use an operation ID in the gateway's bounded staging transport; after staging, the gateway sends the existing `send_file` command with that optional ID, and the daemon echoes it in `file_send_complete`. A browser tab ignores results for other operations. Existing global Bluetooth supervision and permission-solicitation events retain their upstream semantics; the browser serializes its local controls and bounds their pending state without requiring a web-specific daemon protocol. File bytes travel as bounded JSON chunks and are staged by the Go gateway in the shared disk-backed runtime volume. The daemon reads the staged file through `send_file`; the gateway deletes it after a matching terminal event or a bounded timeout. A rejected `file_upload_finish` carries `X-Tether-Upload-Outcome: not-forwarded` only when the gateway knows it never called `send_file`; the browser can fail that upload immediately. A missing response or unmarked failure may have reached the daemon, so the browser waits for its correlated result rather than retrying. No web container access to daemon data or downloads is required.

`tetherd` emits `protocol_info` with a protocol version and capability groups. The browser hides controls until the daemon advertises the matching capability.

## Source ownership

```text
cmd/tether-web/       process setup and embedded assets
internal/daemon/      Unix-socket connection, snapshots, replay, and command writes
internal/gateway/     HTTP routes, SSE, security checks, and resource limits
ui/src/app/           application shell and app-wide state
ui/src/daemon/        browser transport
ui/src/views/         feature state and presentation
```

## Adding a feature

A browser feature should normally require:

1. An existing [`tetherd` command/event](https://github.com/zackb/tether/blob/main/src/core/src/net.cpp) and its advertised capability, where one exists. A new upstream command or event is an exception subject to the protocol-change threshold above.
2. A concrete shape in `ui/src/protocol.ts`.
3. A matching `ui/src/views/<feature>/<Feature>View.tsx` module.
4. Feature-owned state reduction and commands.
5. Reducer, component, and fake-gateway browser tests.
6. An update to [UI_PARITY.md](UI_PARITY.md).

Do not add routes such as `/api/v1/messages` or `/api/v1/contacts`. Those would duplicate the daemon interface and create a second domain implementation.

## Security boundary

The browser API is powerful: it can submit daemon commands and receive private daemon events. The current service has no authentication.

The process therefore defaults to `127.0.0.1:5135`. A wildcard listener requires an explicit Host allowlist, but Host validation is not authentication. Expose the service remotely only behind an authenticating reverse proxy or within a deliberately trusted and firewalled network.

Operation IDs provide correlation, not authorization. Every client that can read the event stream and submit commands is inside the same trust boundary; a malicious authorized client can replay a visible operation ID. The React client uses IDs to prevent accidental cross-tab state handling, while deployment authentication and access control remain responsible for excluding hostile clients.

The gateway also:

- rejects cross-origin and cross-site mutating requests;
- provides no CORS access;
- accepts commands only as `application/json`;
- limits command bodies and request-read time;
- limits subscribers and replay memory;
- bounds command and stream writes; and
- sends a restrictive content security policy.
