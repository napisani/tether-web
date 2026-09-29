# Run Tether core and tether-web with Docker Compose

This is an **example for one Linux host**, not a second implementation of Tether. By default Compose pulls two published images, `tetherd` and `tether-web`, and runs them as two non-root containers with one shared private runtime directory. You can build both images locally instead. The daemon owns Bluetooth, Wi-Fi peer behavior and persistent data; the web process only serves the UI, forwards commands/events and stages browser uploads. No container automatically pairs a phone.

The example has not been validated against every Linux Bluetooth adapter or iPhone. A healthy container and `/readyz` prove only that the processes and Unix socket are connected. See [Tether's container guide](https://github.com/zackb/tether/blob/main/docs/CONTAINER.md) for host prerequisites and hardware acceptance checks; the browser is still [experimental](../docs/UI_PARITY.md).

## 1. Check the host

Use **Linux Docker Engine with Compose** (amd64 or arm64), a working host BlueZ adapter, the host system D-Bus, and Avahi for Wi-Fi discovery. Docker Desktop/VM Bluetooth passthrough and rootless/user-namespace-remapped Docker are not validated. Do not run another `tetherd` against the same adapter, port or data directory.

Before building, follow Tether's [Bluetooth host setup](https://github.com/zackb/tether/blob/main/docs/BLUETOOTH.md) and [container prerequisites](https://github.com/zackb/tether/blob/main/docs/CONTAINER.md#host-prerequisites). The experimental bearer API and adapter class must be configured **on the host before pairing** for full Bluetooth features; don't change or delete an existing bond just to try this example. Verify Secure Connections on the host before setting `TETHER_BLUEZ_SECURE_CONNECTIONS=1`; use `0` if absent. The core image cannot manage host Bluetooth settings. For Wi-Fi peers, allow the existing Tether listener on 5134/tcp and mDNS 5353/udp on your trusted LAN. Bluetooth messaging still requires the iPhone to be in range of this host.

```sh
# Inspect only; fix missing host services using your distribution's instructions.
docker compose version
test -S /run/dbus/system_bus_socket
systemctl is-active bluetooth avahi-daemon
# On hosts with btmgmt installed, check controller capabilities as well:
sudo btmgmt info
```

The core container mounts `/run/dbus` read-only, but D-Bus calls can still **change host state**. Use an existing non-root host UID/GID authorized by the host's D-Bus policy. Do not switch to `privileged: true`, broad device mounts, or unrestricted D-Bus policy to bypass a permission failure.

## 2. Choose published or locally built images

The web client's pairing and send-result correlation need Tether **0.2.35 or newer**.

**Published images (default).** Nothing to build:

| Image | Contents |
| --- | --- |
| `ghcr.io/napisani/tether-core:<version>` | An **unofficial** build of an unmodified [zackb/tether](https://github.com/zackb/tether) release, made from upstream's own `packaging/container/Dockerfile` after upstream's container tests and smoke test pass. Upstream itself publishes no registry image. The tag is the upstream version; the `org.opencontainers.image.revision` label is the upstream commit. |
| `ghcr.io/napisani/tether-web:<version>` | A [tether-web release](https://github.com/napisani/tether-web/releases). |

Both are available for amd64 and arm64. Pin exact tags with `TETHER_CORE_TAG` and `TETHER_WEB_TAG` in step 4.

**Local builds.** Clone the Tether release into a separate directory outside this repository. **Do not replace another Tether checkout or reset its state.**

```sh
mkdir -p "$HOME/src"
git clone --branch v0.2.35 --depth 1 \
  https://github.com/zackb/tether.git "$HOME/src/tether-core"
```

`TETHER_CORE_DIR` points to this checkout, which is the core build context; the web image builds from the parent of this `deploy/` directory. The build settings live in `deploy/docker-compose.build.yml`, layered on the base file in step 5.

## 3. Prepare private host paths

Use your actual non-root UID/GID and **absolute** paths. Tether's persistent `/data` holds its certificate, trust, configuration and history; `/downloads` holds received files. The shared runtime directory holds the private session bus, `tether/tetherd.sock` and web upload staging. This example puts it under the host's **`/run` tmpfs**; staging uses memory-backed storage, unlike the disk-backed Kubernetes deployment. Check that `/run` has at least **1 GiB available** for two concurrent 256 MiB uploads plus other runtime files. On memory-constrained hosts, provision a separate private runtime mount with enough capacity rather than silently exhausting `/run`. Neither container exposes the control socket on a TCP port.

```sh
# Run as the non-root user who will own Tether's data. Do this once; don't
# rotate an existing password or change ownership of another deployment.
uid=$(id -u); gid=$(id -g)
install -d -m 0700 "$HOME/.local/share/tether-container" \
  "$HOME/tether-inbox" "$HOME/.config/tether-web"

# /run is ephemeral; the private runtime directory must exist before Compose.
runtime_dir="/run/tether-compose-$uid"
sudo install -d -m 0700 -o "$uid" -g "$gid" "$runtime_dir"
df -h /run

# The web image reads this file as the same UID as tetherd. Never put the
# password itself in Compose, .env, a command argument, or Git.
if [ ! -e "$HOME/.config/tether-web/password" ]; then
  (umask 077; openssl rand -hex 32 > "$HOME/.config/tether-web/password")
fi
chmod 0600 "$HOME/.config/tether-web/password"
stat -c '%u:%g %a %n' "$HOME/.local/share/tether-container" \
  "$HOME/tether-inbox" "$runtime_dir" "$HOME/.config/tether-web/password"
```

The core entrypoint **refuses** a `/data` or `/run/tether-runtime` directory that isn't owned by its UID or has group/other access. It never recursively changes your files. The runtime bind mount is intentionally separate from persistent data and downloads, and the web container cannot read either persistent mount. Do not back up the runtime directory.

For unattended restart **after reboot**, create the `/run` directory at boot, for example with a reviewed `systemd-tmpfiles` rule (replace the numbers and path with the ones above):

```sh
printf 'd /run/tether-compose-%s 0700 %s %s -\n' "$uid" "$uid" "$gid" \
  | sudo tee /etc/tmpfiles.d/tether-compose.conf
sudo systemd-tmpfiles --create /etc/tmpfiles.d/tether-compose.conf
```

Without a boot-time rule, re-create the directory before starting Compose after a reboot. On non-systemd hosts, use the host's equivalent boot mechanism. Do not put this runtime under a host login session that disappears on logout if you expect unattended restarts.

## 4. Configure Compose

```sh
cp deploy/.env.example deploy/.env
chmod 0600 deploy/.env
# Edit deploy/.env: replace every /home/your-user path, the UID/GID and
# /run/tether-compose-1000 with the values prepared above.
${EDITOR:-vi} deploy/.env
```

`deploy/.env` is ignored by Git and holds paths/settings, **not** the password. In particular:

| Setting | How to choose it |
| --- | --- |
| `TETHER_CORE_TAG`, `TETHER_WEB_TAG` | Published image tags from step 2. Pin exact versions; back up `/data` before changing the core tag. |
| `TETHER_UID`, `TETHER_GID` | Your non-root `id -u` / `id -g`; **the same identity in both containers**. |
| `TETHER_DATA_DIR`, `TETHER_DOWNLOADS_DIR` | Absolute, pre-created directories from step 3. Keep their backups private. |
| `TETHER_RUNTIME_DIR` | Absolute `/run/tether-compose-<uid>` path from step 3; the *same bind mount* in both containers. |
| `TETHER_WEB_PASSWORD_FILE` | Absolute path to the existing 0600 password file; the file is mounted read-only, not copied into the image. |
| `TETHER_BLUEZ_SECURE_CONNECTIONS` | `1` only after confirming the host setting; otherwise `0`. |
| `TETHER_HOSTNAME` | DNS-style display name for the core, e.g. `tether`; the stored certificate, not the label, is its identity. |
| `TETHER_WEB_AUTH_USER` | Username for the browser's HTTP Basic prompt. |
| `TETHER_WEB_ALLOWED_HOSTS` | `localhost,127.0.0.1` for the local example; add the exact Host name of an HTTPS reverse proxy if used. |
| `TETHER_CORE_DIR` | Local builds only: absolute path to the core checkout from step 2. |
| `TETHER_VERSION` | Local builds only: core version label; it does not select the core Git revision. |
| `TETHER_WEB_VERSION` | Local builds only: web version label; `make version` prints the value for this checkout. |

Compose binds the web port to **127.0.0.1:5135 on the host**. Inside its container the gateway listens on `0.0.0.0:5135` so Docker's port mapping works; wildcard listening requires both the Host allowlist and Basic credentials. Health endpoints are intentionally unauthenticated, but UI, state, events and commands require credentials. Do not publish the port on all interfaces or send Basic credentials over plain HTTP on a network. For remote browser access, terminate HTTPS at a trusted reverse proxy on this host, proxy to `127.0.0.1:5135`, and add its public Host name to `TETHER_WEB_ALLOWED_HOSTS`. All authenticated tabs share one daemon's privileges; this is not multi-user access control.

## 5. Validate, pull or build, start

Run these commands from the **tether-web repository root** in the same shell. The `compose` function just avoids repeating the file and environment arguments. For published images:

```sh
compose() { docker compose --env-file deploy/.env -f deploy/docker-compose.yml "$@"; }
compose config -q                # Fail early on missing variables or invalid YAML.
compose pull tether tether-web    # Pulls the pinned published images.
```

For local builds, layer the build file instead:

```sh
compose() { docker compose --env-file deploy/.env -f deploy/docker-compose.yml \
  -f deploy/docker-compose.build.yml "$@"; }
compose config -q
compose build tether tether-web   # Builds both local images; no registry push.
```

Then start either way:

```sh
compose up -d --no-build          # Waits for core health before starting web.
compose ps
compose logs --tail=80 tether tether-web
```

Compose's `depends_on` checks core health at startup only. A later unhealthy core does **not** cause Docker to restart a running web container; the web client will report that the daemon is unavailable until it reconnects. The core uses host networking for Tether's existing peer discovery and 5134/tcp listener; `ports:` on the core would have no effect. A name/port conflict with another Tether instance must be resolved deliberately, not by killing that instance from a script.

Check the processes without changing a bond, sending a message or opening a private conversation:

```sh
compose exec tether tether status   # May print identifiers: keep output private.
curl -fsS http://127.0.0.1:5135/healthz
curl -fsS http://127.0.0.1:5135/readyz
# Open http://127.0.0.1:5135/ in a browser; enter your Basic username/password.
```

`/healthz` means the web process is alive; `/readyz` means its connection to `tetherd` is up. Treat logs and status output as private: they can include device identifiers and file paths. Neither health endpoint proves iPhone/Bluetooth parity. Only test pairing, messages or transfers with operator-approved devices, recipients and data. A send with an uncertain result should be checked on the phone before retrying.

## Operate and troubleshoot

Use the same `compose` function (redefine it in a new shell). For logs and deliberate restart:

```sh
compose ps
compose logs -f --tail=100 tether tether-web
compose restart tether         # Only if you intend to interrupt active transfers.
compose down                   # Stops containers; does not erase host bind mounts.
```

- **`wrong-owner`, `invalid-layout`, or web upload permission failure:** inspect `stat -c '%u:%g %a %n'` on the data and runtime paths; both containers must run the same UID/GID, and the shared runtime needs free space. Do not make it world-writable.
- **`host-bus-missing` / `host-bus-denied`:** check `/run/dbus/system_bus_socket`, the selected UID and the host D-Bus policy. A read-only D-Bus mount is not a read-only permission boundary. Do not add `privileged` as a workaround.
- **Core unhealthy / `/readyz` returns 503:** inspect `compose logs tether tether-web` and confirm `tether/tetherd.sock` can be created inside the shared runtime. `/healthz` alone is insufficient.
- **401 or rejected Host:** check the Basic username, file ownership/mode and `TETHER_WEB_ALLOWED_HOSTS`. The gateway rejects invalid credentials or unlisted reverse-proxy Host names; do not weaken auth to test it remotely.
- **No Wi-Fi peer or Bluetooth feature:** inspect host Avahi, LAN firewall, BlueZ mode, adapter class, controller support and iPhone permissions using Tether's linked guides. A container build cannot establish hardware parity.
- **Upgrade:** read the upstream and web release notes, stop the core and back up `/data` (below), change `TETHER_CORE_TAG` or `TETHER_WEB_TAG` (or rebuild from a newer checkout), then pull and `compose up -d --no-build`.
- **Reboot fails to restart:** ensure `/run/tether-compose-<uid>` is created by the boot-time rule before Docker starts the services. Do not persist a stale Unix socket by moving runtime into `/data`.

Stop the core before backing up `/data` and `/downloads`, preserving ownership and permissions. The core's TLS identity and encrypted history key live under `/data`; restoring only part of that directory can break trust/history. Bluetooth bonds are stored separately by host BlueZ. **Never delete the host data, bonds or trust just to rerun this example.**
