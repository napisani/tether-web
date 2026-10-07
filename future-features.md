# Future features

Upstream [Tether](https://github.com/zackb/tether) capabilities that tether-web does not yet fully support. The `identify-unimplemented-core-features` skill (`.pi/skills/identify-unimplemented-core-features/`) maintains this file by reviewing upstream changes since the checkpoint below. For the overall parity status of each view, including known gaps that predate the first review, see [docs/UI_PARITY.md](docs/UI_PARITY.md).

<!-- tether-upstream-review
repository: https://github.com/zackb/tether
head: d2f705ad30c1e7870eb6e935b7c873b6376e1b87
reviewed_at: 2026-10-06
-->

Statuses: *missing* means the web client has no support. *Partial* means some support exists but a user outcome, state, or lifecycle case is absent. *Blocked upstream* means parity needs a protocol capability that `tetherd` does not expose.

## Backlog

- [ ] **Refresh the Calls tab when BlueZ availability changes** *(partial)*
  - Upstream evidence: [`6e3a7ee9d` fix(protocol): make capabilities accurate](https://github.com/zackb/tether/commit/6e3a7ee9dc7b344fb1735fd74f87bb7921dfd927), in [v0.2.35](https://github.com/zackb/tether/releases/tag/v0.2.35). `protocol_info` now advertises `calls` only when calls are enabled and BlueZ is running ([`net.cpp` L392-L396](https://github.com/zackb/tether/blob/a5ad39a0e8903f87384c257cd55daef91313b0f6/src/core/src/net.cpp#L392-L396)).
  - Surface change: the `calls` capability can now change while the daemon runs, both when calls are toggled and when BlueZ starts or stops. The daemon sends `protocol_info` only on `subscribe` or when asked. It does not broadcast a new one when the value changes.
  - Protocol/daemon: `protocol_info`, `bt_status.available`, `bt_status.calls_enabled`. GTK shows its Calls tab from `bt_status.calls_enabled` alone ([`main.cpp` L262-L263](https://github.com/zackb/tether/blob/a5ad39a0e8903f87384c257cd55daef91313b0f6/src/gtk/main.cpp#L262-L263)).
  - Web touchpoints: `refreshCallsCapability` in `ui/src/app/TetherApp.tsx` re-requests `protocol_info` only when `calls_enabled` changes; `useDaemonLifecycle` in `ui/src/app/daemonLifecycle.ts` passes it only `calls_enabled`. Also re-request when `bt_status.available` changes. Tests belong in `ui/src/app/TetherApp.test.tsx`.
  - Parity states: tetherd starts before `bluetoothd`, or `bluetooth` restarts, with calls enabled; reconnect resets the cached value; a failed `protocol_info` request keeps the existing `callsCapabilityError` behavior.
  - Acceptance: with calls enabled, `bt_status` changing from `available: false` to `available: true` makes the Calls tab appear without a page reload, and the reverse hides it.
  - Dependencies/blockers: None.

- [ ] **Name the pairing progress step, including the new rediscovery retry** *(partial)*
  - Upstream evidence: [#208 fix: make Bluetooth pairing retries reliable](https://github.com/zackb/tether/pull/208) ([`24c3d9dde`](https://github.com/zackb/tether/commit/24c3d9dde9c7ff3e1bf2612cd190cc72fbccf47a)). It adds a `rediscovering` step when BlueZ removes the device between attempts ([`pairing.cpp` L700](https://github.com/zackb/tether/blob/a5ad39a0e8903f87384c257cd55daef91313b0f6/src/core/src/bluetooth/pairing.cpp#L700)).
  - Surface change: pairing can now recover by finding the iPhone again mid-attempt. GTK shows every step as `step  detail` ([`devices_view.cpp` L1446](https://github.com/zackb/tether/blob/a5ad39a0e8903f87384c257cd55daef91313b0f6/src/gtk/devices_view.cpp#L1446)).
  - Protocol/daemon: `bt_pair_progress` with `step` and `detail`, correlated by `operation_id`. Steps at v0.2.35 are `discovering`, `already_paired`, `confirm`, `rediscovering`, `connecting`, `pairing`, `retrying`, `paired`, `settling`, `warning`, and `error`. For several of them, `detail` is only the device address or name.
  - Web touchpoints: `devicesState.ts` stores `pairing.step` but `PairingProgress` in `ui/src/views/devices/BluetoothPairing.tsx` renders only `pairing.message || pairing.detail` under a fixed "Pairing in progress" title. Map known steps to plain labels, and fall back to the raw step name for unknown ones.
  - Parity states: unknown future step names; `aria-live` announcements for each step change; the `confirming` and terminal phases keep their current titles.
  - Acceptance: during a pairing attempt that rediscovers the phone, the progress area says so (for example "Finding the iPhone again") instead of showing a bare Bluetooth address.
  - Dependencies/blockers: None.

## Upstream review log

- 2026-10-06: reviewed `a5ad39a0e8903f87384c257cd55daef91313b0f6..d2f705ad30c1e7870eb6e935b7c873b6376e1b87` (6 commits after v0.2.35); inspected merged PRs [#219](https://github.com/zackb/tether/pull/219), [#221](https://github.com/zackb/tether/pull/221), and [#224](https://github.com/zackb/tether/pull/224). No new web parity items; the two existing partial items remain open. [#221](https://github.com/zackb/tether/commit/5fcc1f49841240d22655e4119be42bea0f764d61) adds `set_popup_previews` and `popup_previews_enabled` for **daemon-host desktop popups** only. The web client's `useBrowserNotifications.ts` deliberately emits generic, content-free alerts independent of host popups, and `SettingsView.tsx` documents that platform difference; exposing this host setting as a browser notification preference would be misleading. [#224](https://github.com/zackb/tether/commit/ad8b6b0aca7df6e37d28fd113407af38cbf89748) enables local installation of Tether's separate Chromium native-messaging extension, not a GTK/web-client feature. [#219](https://github.com/zackb/tether/commit/efa0eaa98bf9db6cd3be881ccc037bc48648d255) only documents tether-web headless use. Checked the upstream compare's paths and diffs, related PRs and release, and the local protocol schemas, transport, lifecycle, Settings, browser alerts, and existing parity guidance.

- 2026-09-29: first review, baseline `v0.2.34..v0.2.35` (`f4173de675f1463c02543fa62d4914115b337590..a5ad39a0e8903f87384c257cd55daef91313b0f6`). Upstream `main` was at the v0.2.35 release and `develop` had nothing ahead of it. This covers only that release, not earlier Tether history; [docs/UI_PARITY.md](docs/UI_PARITY.md) tracks older gaps such as Send Clipboard. Inspected PRs #207, #208, #211, #214, #215 and #217. Found 2 partial items.
  - Already implemented in tether-web: `protocol_info` and capability gating, the `apple_nearby` hint, pairing `operation_id` on `bt_pair`, `bt_unpair` and `bt_pair_confirm`, `send_file` result correlation including connection failures, `bt_send_message` result correlation with `thread`, the conditional `clipboard` capability (`PeerPane.tsx`), and `TETHER_BLUEZ_SECURE_CONNECTIONS` in the Compose example.
  - Ignored, no web user outcome: Flatpak and libsecret documentation (#207, #215), issue templates, the `--bt-setup` experimental-API detection fix, and the fingerprint check on outgoing peer connections (#217).
