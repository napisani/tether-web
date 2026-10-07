# MCP setup

tether-web's MCP endpoint uses Streamable HTTP at `/mcp` alongside the web UI.
HTTP Basic is the only implemented authentication method. There is no OAuth
login flow, API-key authentication, or stdio transport.

Use an MCP client that supports Basic credentials or a custom `Authorization`
header. It uses the same username and password as the web UI, with the same
owner authority. Sharing these credentials also grants access to the other
owner-authenticated web APIs, not just the current MCP tools.

## Configure the server

Start with a working [tether-web installation](../README.md#install) and a
build or image that includes MCP support. The endpoint is disabled by default.

### Password file

Reuse the existing web password file. For a new setup, create a private file
without putting the password in shell history, command arguments, or `.env`:

```sh
install -d -m 0700 "$HOME/.config/tether-web"
password_file="$HOME/.config/tether-web/password"
if [ ! -e "$password_file" ]; then
  (umask 077; set -C; openssl rand -hex 32 > "$password_file")
fi
chmod 0600 "$password_file"
```

The server process must be able to read this file. Passwords must contain
16 to 4096 bytes. Keep the password and any encoded authentication header out
of Git, logs, and agent prompts. Use the MCP client's credential store where
available, or a private client configuration file.

### Docker Compose

Follow the [deployment guide](../deploy/README.md) first. In `deploy/.env`, set:

```dotenv
TETHER_WEB_MCP_ENABLED=true
TETHER_WEB_AUTH_USER=owner
TETHER_WEB_PASSWORD_FILE=/home/your-user/.config/tether-web/password
```

Replace the password path with your existing absolute host path. Compose
mounts this file read-only and sets `TETHER_WEB_AUTH_PASSWORD_FILE` to its
container path. Do not put the password itself in `.env`.

From the repository root, recreate the web service:

```sh
docker compose --env-file deploy/.env -f deploy/docker-compose.yml \
  up -d --no-deps tether-web
```

Use the same Compose overlays as your existing deployment if you build images
locally. Restarting a container alone does not apply changed environment
variables. With `docker run`, add `-e TETHER_WEB_MCP_ENABLED=true` to the
[existing web-container example](../README.md#docker-with-an-existing-tetherd)
and recreate that container with its password mount and authentication settings.

### Built binary

After [building from source](../README.md#from-source), start the server with
both credential settings, even when listening on localhost:

```sh
TETHER_WEB_MCP_ENABLED=true \
TETHER_WEB_AUTH_USER=owner \
TETHER_WEB_AUTH_PASSWORD_FILE="$HOME/.config/tether-web/password" \
TETHER_SOCKET_PATH="$XDG_RUNTIME_DIR/tether/tetherd.sock" \
./bin/tether-web
```

The current server permits a loopback listener with no credentials. Enabling
MCP does not change that exception. Configure both authentication variables to
protect `/mcp`; a loopback address alone is not authentication. This also applies
when a reverse proxy forwards requests to a loopback listener. Non-loopback
listeners refuse to start without credentials.

### Remote access

Keep the host port bound to loopback and use an HTTPS reverse proxy for remote
clients. Add the proxy's hostname to `TETHER_WEB_ALLOWED_HOSTS`, for example:

```dotenv
TETHER_WEB_ALLOWED_HOSTS=localhost,127.0.0.1,tether.example.com
```

The proxy must forward `/mcp` and the client's `Authorization` header to
`tether-web`. Configure the client with the final URL, such as
`https://tether.example.com/mcp`. Never send Basic credentials across a network
using plain HTTP. Base64 encoding does not encrypt a password.

## Configure the MCP client

Client configuration formats differ. Supply these values through your client's
Streamable HTTP settings:

| Setting | Value |
| --- | --- |
| Transport | Streamable HTTP, not stdio or legacy HTTP/SSE |
| URL | `http://127.0.0.1:5135/mcp` on the same host, or the remote HTTPS URL |
| Username | The value of `TETHER_WEB_AUTH_USER` |
| Password | The contents of the password file, without its trailing newline |

If the client accepts only custom headers, set:

```text
Authorization: Basic <base64-encoded username:password>
```

Encode the UTF-8 username, a colon, and the password together, without adding
a newline. Treat the entire header as a secret. The client must send it on
every MCP request. Signing into the web UI does not sign in the MCP client.
Clients that only support OAuth cannot connect with the current authentication
method.

## Verify authentication and connectivity

Use your local URL or replace it with the remote HTTPS URL. Without
credentials, this command must print `401`:

```sh
curl --silent --output /dev/null --write-out '%{http_code}\n' \
  --request POST http://127.0.0.1:5135/mcp
```

If it does not, check the authentication settings before connecting an agent.
The unauthenticated `/healthz` and `/readyz` probes do not test MCP security.

Check the MCP handshake with credentials. Curl prompts for the password, so
it is not part of the command line or shell history:

```sh
curl --fail-with-body --user owner \
  --header 'Content-Type: application/json' \
  --header 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"setup-check","version":"1"}}}' \
  http://127.0.0.1:5135/mcp
```

A successful response contains the MCP protocol version and `serverInfo` for
`tether-web`. This verifies the endpoint and credentials, not phone availability.
Connect your MCP client and call `get_status` with no arguments to check the
daemon connection, capabilities, and phone profile availability. This check
does not send a message or change phone settings.

## Available tools and send outcomes

Full UI parity is not implemented yet. The current tools are:

| Tool | Purpose |
| --- | --- |
| `get_status` | Inspect daemon connectivity, capabilities, and current phone profile availability |
| `send_message` | Send a message or reply using an exact daemon thread/recipient ID |
| `get_operation` | Check a send without issuing it again |

For an intended, approved send, call `get_status` first. Pass its `instance_id`
to `send_message`, together with a unique `request_key`, the exact `thread_id`,
and `body`. Contact display names are not recipient identifiers. For example:

```json
{
  "instance_id": "<from get_status>",
  "request_key": "<unique ID for this exact send>",
  "thread_id": "<exact daemon thread ID or tel:/email: recipient identifier>",
  "body": "Running late"
}
```

A send returns an `operation_id` and a status:

- `pending` means the request has no matching terminal result yet. Call
  `get_operation` with `{"operation_id":"<returned ID>"}` to check it.
- `correlated_success` means the daemon reported successful sending. It does
  not mean the recipient received or read the message.
- `correlated_failure` means the daemon reported failure for this send.
- `unknown` means the server cannot confirm the outcome. Check the iPhone
  before deciding whether to send again. Never automatically resend.

Identical request-key retries return the same operation during its one-hour
record lifetime. Reusing a key with a different payload is rejected. The server
retains up to 256 sends; records expire after one hour and do not survive restart.
An old `instance_id` cannot dispatch into a new server process. This protection
is not exactly-once delivery across expiry or restart. A missing operation is
not evidence that the message was not sent.

Thread/history reads, contacts, notifications, calls, device controls, AirPods,
settings confirmations, and file-upload tools are not yet exposed. There is no
arbitrary daemon-command tool or live agent event subscription. See
[MCP_DESIGN.md](MCP_DESIGN.md) for the remaining design.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `401 Unauthorized` | Send the Basic header on every request. Check the username and password against the server's password file. |
| Authenticated request returns `404` | Check that the running build supports MCP and `TETHER_WEB_MCP_ENABLED=true` reached the process. Recreate a container after changing its environment. |
| `421 Misdirected Request` | Add the client's URL hostname to `TETHER_WEB_ALLOWED_HOSTS`, including any proxy hostname. |
| `403 Forbidden` | Check for a cross-origin `Origin` header or cross-site browser request. Do not disable Origin protection. |
| `405` for a standalone GET/SSE stream | Use Streamable HTTP POST requests. This endpoint does not provide a standalone event stream. |
| `get_status` reports unavailable profiles | Check `tetherd`, Bluetooth connectivity, and phone permissions. HTTP authentication alone does not make the phone available. |
| Server instance changed or operation expired | Inspect the phone before issuing any replacement send. Do not automatically retry with a new key or instance ID. |
