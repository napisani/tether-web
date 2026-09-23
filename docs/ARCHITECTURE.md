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

Pairing and browser file-upload commands carry an `operation_id`; their result events echo it. A browser tab ignores operation events it did not start. File bytes travel as bounded JSON chunks and are staged by `tetherd`; the Go gateway does not inspect or persist them.

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

1. An existing or new [`tetherd` command/event](https://github.com/zackb/tether/blob/main/src/core/src/net.cpp) and advertised capability.
2. A concrete shape in `ui/src/protocol.ts`.
3. A matching `ui/src/views/<feature>/<Feature>View.tsx` module.
4. Feature-owned state reduction and commands.
5. Reducer, component, and fake-gateway browser tests.
6. An update to [UI_PARITY.md](UI_PARITY.md).

Do not add routes such as `/api/v1/messages` or `/api/v1/contacts`. Those would duplicate the daemon interface and create a second domain implementation.

## Security boundary

The browser API is powerful: it can submit daemon commands and receive private daemon events. The current service has no authentication.

The process therefore defaults to `127.0.0.1:5135`. A wildcard listener requires an explicit Host allowlist, but Host validation is not authentication. Expose the service remotely only behind an authenticating reverse proxy or within a deliberately trusted and firewalled network.

The gateway also:

- rejects cross-origin and cross-site mutating requests;
- provides no CORS access;
- accepts commands only as `application/json`;
- limits command bodies and request-read time;
- limits subscribers and replay memory;
- bounds command and stream writes; and
- sends a restrictive content security policy.
