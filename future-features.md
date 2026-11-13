# Future features

Upstream [Tether](https://github.com/zackb/tether) capabilities that tether-web does not yet fully support. The `identify-unimplemented-core-features` skill (`.pi/skills/identify-unimplemented-core-features/`) maintains this file by reviewing upstream changes since the checkpoint below. For the overall parity status of each view, including known gaps that predate the first review, see [docs/UI_PARITY.md](docs/UI_PARITY.md).

<!-- tether-upstream-review
repository: https://github.com/zackb/tether
head: adb03f60c9c69e2b439c751e2c24434a8abfffaa
reviewed_at: 2026-11-13
clients: web-ui,mcp
-->

Statuses: *missing* means the web client has no support. *Partial* means some support exists but a user outcome, state, or lifecycle case is absent. *Blocked upstream* means parity needs a protocol capability that `tetherd` does not expose.

## Backlog

- [ ] **Refresh the Calls tab when BlueZ availability changes** *(partial)*
  - Web UI status: partial. MCP status: partial: `get_status` reads cached `protocol_info` (`internal/mcpserver/tools/status.go`) and does not re-request it when `bt_status.available` changes, so its `calls` capability can also be stale until reconnect. MCP impact: existing `get_status` capability refresh, no new tool; acceptance is current-generation `calls` capability after BlueZ starts/stops, without a stale positive result.
  - Upstream evidence: [`6e3a7ee9d` fix(protocol): make capabilities accurate](https://github.com/zackb/tether/commit/6e3a7ee9dc7b344fb1735fd74f87bb7921dfd927), in [v0.2.35](https://github.com/zackb/tether/releases/tag/v0.2.35). `protocol_info` now advertises `calls` only when calls are enabled and BlueZ is running ([`net.cpp` L392-L396](https://github.com/zackb/tether/blob/a5ad39a0e8903f87384c257cd55daef91313b0f6/src/core/src/net.cpp#L392-L396)).
  - Surface change: the `calls` capability can now change while the daemon runs, both when calls are toggled and when BlueZ starts or stops. The daemon sends `protocol_info` only on `subscribe` or when asked. It does not broadcast a new one when the value changes.
  - Protocol/daemon: `protocol_info`, `bt_status.available`, `bt_status.calls_enabled`. GTK shows its Calls tab from `bt_status.calls_enabled` alone ([`main.cpp` L262-L263](https://github.com/zackb/tether/blob/a5ad39a0e8903f87384c257cd55daef91313b0f6/src/gtk/main.cpp#L262-L263)).
  - Web touchpoints: `refreshCallsCapability` in `ui/src/app/TetherApp.tsx` re-requests `protocol_info` only when `calls_enabled` changes; `useDaemonLifecycle` in `ui/src/app/daemonLifecycle.ts` passes it only `calls_enabled`. Also re-request when `bt_status.available` changes. Tests belong in `ui/src/app/TetherApp.test.tsx`.
  - Parity states: tetherd starts before `bluetoothd`, or `bluetooth` restarts, with calls enabled; reconnect resets the cached value; a failed `protocol_info` request keeps the existing `callsCapabilityError` behavior.
  - Acceptance: with calls enabled, `bt_status` changing from `available: false` to `available: true` makes the Calls tab appear without a page reload, and the reverse hides it.
  - Dependencies/blockers: None.

- [ ] **Name the pairing progress step, including the new rediscovery retry** *(partial)*
  - Web UI status: partial. MCP status: implemented: `pair_bluetooth_device`/`get_operation` already report `bt_pair_progress.step` and `detail` verbatim (`internal/mcpserver/tools/devices.go`, `actions_test.go`); `rediscovering` is an open string, so no new MCP schema/tool change. Agent acceptance: the step is surfaced with its detail without translating an unknown future step into false success.
  - Upstream evidence: [#208 fix: make Bluetooth pairing retries reliable](https://github.com/zackb/tether/pull/208) ([`24c3d9dde`](https://github.com/zackb/tether/commit/24c3d9dde9c7ff3e1bf2612cd190cc72fbccf47a)). It adds a `rediscovering` step when BlueZ removes the device between attempts ([`pairing.cpp` L700](https://github.com/zackb/tether/blob/a5ad39a0e8903f87384c257cd55daef91313b0f6/src/core/src/bluetooth/pairing.cpp#L700)).
  - Surface change: pairing can now recover by finding the iPhone again mid-attempt. GTK shows every step as `step  detail` ([`devices_view.cpp` L1446](https://github.com/zackb/tether/blob/a5ad39a0e8903f87384c257cd55daef91313b0f6/src/gtk/devices_view.cpp#L1446)).
  - Protocol/daemon: `bt_pair_progress` with `step` and `detail`, correlated by `operation_id`. Steps at v0.2.35 are `discovering`, `already_paired`, `confirm`, `rediscovering`, `connecting`, `pairing`, `retrying`, `paired`, `settling`, `warning`, and `error`. For several of them, `detail` is only the device address or name.
  - Web touchpoints: `devicesState.ts` stores `pairing.step` but `PairingProgress` in `ui/src/views/devices/BluetoothPairing.tsx` renders only `pairing.message || pairing.detail` under a fixed "Pairing in progress" title. Map known steps to plain labels, and fall back to the raw step name for unknown ones.
  - Parity states: unknown future step names; `aria-live` announcements for each step change; the `confirming` and terminal phases keep their current titles.
  - Acceptance: during a pairing attempt that rediscovers the phone, the progress area says so (for example "Finding the iPhone again") instead of showing a bare Bluetooth address.
  - Dependencies/blockers: None.

- [x] **Recent call history and favorite-contact indicators** *(UI and MCP implemented locally)*
  - Upstream evidence: [#234](https://github.com/zackb/tether/pull/234), commit [`1dc52a4c120e3b5dca81bdf9943c5d7da6508381`](https://github.com/zackb/tether/commit/1dc52a4c120e3b5dca81bdf9943c5d7da6508381), [v0.2.36](https://github.com/zackb/tether/releases/tag/v0.2.36). Inspected GTK calls/contacts implementation and headers, `ui_util.cpp`, daemon `net.cpp` and Bluetooth `connection.cpp` at that SHA.
  - Web UI status: implemented in `protocolSchemas.ts`, `protocol.ts`, `views/calls/useCallHistory.ts`, `useCalls.ts`, `CallsView.tsx`, and `views/contacts/ContactsView.tsx`. Live calls take precedence; otherwise up to 100 recent caller/type/timestamp rows with callback through existing guarded `bt_call_dial`. Favorite markers are accessible and daemon favorite-first order is preserved; absent/false favorites remain compatible.
  - MCP status: implemented by extending existing `list_calls` (`history.calls`, bounded 100, `truncated`, client-derived `availability`/`reason`) and `search_contacts` (optional `favorite`) in `internal/mcpserver/tools/`. No new tools or feature-specific gateway routes.
  - Protocol/daemon: `bt_list_call_history` → `bt_call_history` entries contain `number`, `name`, `type`, `timestamp`; `bt_contacts` gains optional `favorite`. History uses PBAP, independently of HFP call-control availability, and is memory-only upstream. No history availability or sync flag is emitted: an empty response cannot distinguish no recent calls from unsupported/disabled Phone Recents sync or an unpopulated cache.
  - Parity states: loading, ambiguous empty snapshot, PBAP unavailable, timeout/older daemon, failed request, daemon/PBAP disconnect and reconnect, stale replies/failures. Callback requires a number and HFP readiness and retains uncertain-dial retry guards. MCP reads fail across daemon generations and clear content when profiles close.
  - Web acceptance evidence: `ui/src/callHistoryProtocol.test.ts`, `views/calls/useCallHistory.test.ts`, `CallsView.test.tsx`, existing uncertain-dial `useCalls.test.ts`, `views/contacts/ContactsView.test.tsx`, and `ui/e2e/recent-calls.spec.ts` (desktop and mobile).
  - MCP acceptance evidence: `internal/mcpserver/tools/history_test.go` exercises bounds, unknown-empty and unavailable results, PBAP without HFP, profile loss and disconnect; `internal/mcpserver/server_test.go` verifies authenticated SDK results and output schemas. Existing dial-operation safeguards remain unchanged.
  - Verification: `go test -race ./...`; UI unit tests and production build; type-aware lint; Playwright desktop/mobile suite. See [UI parity](docs/UI_PARITY.md#recent-calls-and-favorites-v0236) and [MCP usage](docs/MCP_SETUP.md#recent-calls-and-favorite-contacts) for protocol limitations and intentional presentation differences.
  - Dependencies/blockers: no implementation blocker. Physical-phone validation remains separate; the client cannot confirm history support from an empty upstream snapshot.

## New findings from the 2026-11-13 full-range audit

The statuses below are independent client assessments from the audit checkpoint; implementation progress is recorded per item below. Every upstream link pins a commit in `bcf83b1..adb03f6`; the two older partial UI items above remain open with MCP statuses now reconciled. The existing recent-calls item remains complete.

- [x] **Call a phone number directly from a contact card** *(web implemented after audit)*
  - Web UI status: implemented locally. MCP status: implemented (`dial_call` already accepts a number).
  - Upstream evidence: [`09c8414`](https://github.com/zackb/tether/commit/09c84149bee89665dd4f1b13d8a53368fde418f4) / [#241](https://github.com/zackb/tether/pull/241).
  - Surface change: GTK Contacts adds a Call action to telephone rows when HFP calls are available, handing off to its existing dial flow.
  - Protocol/daemon: existing `bt_call_dial`, `bt_connection_changed.calls.available`, and global `bt_call_result`; no new command or request correlation.
  - Web touchpoints: `ui/src/views/contacts/ContactsView.tsx` offers Call on usable telephone rows; `ui/src/app/TetherApp.tsx` gates on the current daemon, `calls` capability, host Calls setting, HFP readiness, and pending dial, then hands the number to `ui/src/views/calls/useCalls.ts` and opens Calls. No extra daemon command or protocol field.
  - MCP impact: no tool change; `internal/mcpserver/tools/calls.go` already registers `dial_call` with uncertain-outcome protection.
  - Parity states: omit/disable Call without a telephone address or HFP availability; preserve the existing pending/uncertain dial and reconnect rules rather than directly sending a second dial.
  - Web acceptance: an available contact telephone action reaches the guarded Calls dial flow; unavailable calls do not offer an actionable control. `ContactsView.test.tsx` covers telephone/email/empty-address gating and handoff; `TetherApp.test.tsx` covers missing capability, HFP loss/recovery, guarded single dial and global result; `ui/e2e/recent-calls.spec.ts` covers desktop/mobile browser navigation and pending retry guard.
  - MCP acceptance: existing `dial_call` works for a number from `search_contacts`; see `internal/mcpserver/tools/actions_test.go`.
  - Dependencies/blockers: None for this feature. Fake-daemon browser tests do not validate a physical phone.

- [ ] **Release/reclaim Bluetooth profiles and yield messages/contacts when inactive**
  - Web UI status: missing. MCP status: partial (current `get_status` has profile open/error fields, not `*_held` or the yield preference; no control tool).
  - Upstream evidence: [`a5cbabd`](https://github.com/zackb/tether/commit/a5cbabd45851176552a82d31d1cc0e725c6ae462), [`8d4e826`](https://github.com/zackb/tether/commit/8d4e826d8c2a3724ccebbb1dd678c62f1948d7ab) / [#257](https://github.com/zackb/tether/pull/257).
  - Surface change: a computer can hand MAP/PBAP/ANCS to another computer and reclaim them, or release MAP/PBAP automatically while locked/idle. GTK Devices exposes per-profile release and a persisted yield toggle.
  - Protocol/daemon: `bt_hold` (`profile: map|pbap|ancs|all`, `held`), `bt_set_yield_when_inactive`, `bt_status.yield_when_inactive`, `bt_connection_changed.map_held/pbap_held/ancs_held`; `bt_hold` is transient and reclaim cannot seize a profile held by another host.
  - Web touchpoints: `ui/src/protocolSchemas.ts`, `ui/src/views/devices/DevicesView.tsx`, `devicesState.ts`, `ui/src/views/settings/SettingsView.tsx`; the open/error status is present but held fields and commands are absent.
  - MCP impact: new tool or scoped existing-tool change for hold/reclaim; existing tool change to `get_status` and settings setter (`internal/mcpserver/tools/{protocol,status,settings,devices}.go`), with explicit confirmation before releasing phone permissions/trust-sensitive profiles.
  - Parity states: show held versus busy/forbidden/disconnected separately; observe broadcast status, clear stale state across reconnect, do not report reclaim success merely because the command was accepted; account for inactive Wayland sessions.
  - Web acceptance: a held profile and yield setting reflect current daemon status and recover after reconnect without conflating `held` with `open: false`.
  - MCP acceptance: bounded profile enum, owner confirmation for release, `get_status` held/yield values, observed or unknown outcomes and expiry, never unconditional success.
  - Dependencies/blockers: requires daemon version carrying these commands; no upstream protocol addition.

- [ ] **Choose first- or last-name contact ordering**
  - Web UI status: missing. MCP status: partial (`search_contacts` finds contacts, but `get_settings`/setter omit ordering).
  - Upstream evidence: [`a8e3852`](https://github.com/zackb/tether/commit/a8e38523c4e766f970f3769e493b33dead62077a) / [#265](https://github.com/zackb/tether/pull/265).
  - Surface change: a persisted sort preference changes daemon `bt_contacts` ordering, favorites first, using vCard family/given names.
  - Protocol/daemon: `bt_set_contacts_by_last_name` (`enabled`), `bt_status.contacts_by_last_name`; contact list order comes from daemon, not browser-local guessed surname parsing.
  - Web touchpoints: `ui/src/views/settings/SettingsView.tsx`, `ui/src/views/contacts/useContacts.ts`, `ui/src/protocolSchemas.ts` (no sort preference).
  - MCP impact: existing tool change in `internal/mcpserver/tools/{settings,protocol}.go`; `search_contacts` currently performs its own matching and must not pretend to preserve daemon ordering after filtering.
  - Parity states: unknown initial setting, PBAP unavailable, refreshed contacts and reconnect; retain favorite-first semantics.
  - Web acceptance: status-backed toggle and refreshed ordered list after a change, not a cosmetic local-only sort.
  - MCP acceptance: read and set the preference with a status-observed result; clarify whether search result order mirrors the daemon.
  - Dependencies/blockers: None.

- [ ] **Hide unknown senders with daemon's safe exceptions**
  - Web UI status: missing. MCP status: partial (thread listing works, but setting cannot be read/set).
  - Upstream evidence: [`5e01e62`](https://github.com/zackb/tether/commit/5e01e622227d9edc139a00d91c8efc65924d3642) / [#269](https://github.com/zackb/tether/pull/269).
  - Surface change: persisted filter excludes one-to-one unknown/unreplied threads only when contacts are loaded; OTPs still reach the vault, and code/short-code popups remain. It is not message deletion.
  - Protocol/daemon: `set_hide_unknown_senders` (`enabled`), `bt_status.hide_unknown_senders`, `bt_threads` broadcast; daemon owns sender classification.
  - Web touchpoints: `ui/src/views/settings/SettingsView.tsx`, `ui/src/views/messages/useMessages.ts`, `ui/src/protocolSchemas.ts`; no toggle, existing thread event reducer can consume the daemon list.
  - MCP impact: existing tool change to `get_settings` plus a setting setter in `internal/mcpserver/tools/{settings,protocol}.go`; `list_threads` already reads the authoritative filtered snapshot, so do not filter again in MCP.
  - Parity states: unavailable contacts means filter may be ineffective; refresh and reconnect must not preserve obsolete threads; explain that hidden messages/codes are retained.
  - Web acceptance: toggle reflects daemon status and the thread list updates after its broadcast.
  - MCP acceptance: status-backed preference and an observed/unknown setter outcome; `list_threads` returns daemon-selected rows without claiming deletion.
  - Dependencies/blockers: None.

- [ ] **Remove a conversation locally up to its observed timestamp**
  - Web UI status: missing. MCP status: missing (thread listing/mark-read are present, removal is not).
  - Upstream evidence: [`c5d389b`](https://github.com/zackb/tether/commit/c5d389b8065ab1984c7021970d2d124ff84f6c6f) / [#273](https://github.com/zackb/tether/pull/273).
  - Surface change: GTK confirms removal of a conversation from this computer's display only; no phone or journal deletion. Newer messages bring it back; retention mode determines whether cutoff survives restart.
  - Protocol/daemon: `bt_remove_thread` requires nonempty `thread` and integer `before` from the selected `bt_threads.timestamp`; reply is an uncorrelated `bt_threads` broadcast, and normalization/repeated cutoffs are daemon-owned.
  - Web touchpoints: `ui/src/views/messages/MessagesView.tsx`, `ui/src/views/messages/useMessages.ts`, `ui/src/protocolSchemas.ts`; no remove control/command. Capture timestamp before opening confirmation, not after async UI state changes.
  - MCP impact: new `remove_thread` tool in `internal/mcpserver/tools/messages.go` with thread identity and cutoff from a current snapshot, explicit destructive-retention confirmation despite the non-destructive phone semantics; no gateway-specific route.
  - Parity states: avoid deleting messages that arrived while confirmation was open; reconcile changed/empty snapshots, no timestamp, disconnect, expiry, and another client's same-thread removal; broadcast alone is not attributable success.
  - Web acceptance: confirmed action hides only messages at/before the captured cutoff, and a newer message remains visible.
  - MCP acceptance: require explicit confirmation and current thread/timestamp, report observed state versus unknown outcome without falsely claiming phone deletion; bound stale snapshots and reconnect.
  - Dependencies/blockers: None.

- [ ] **Route iPhone music/audio to the host or back to the phone**
  - Web UI status: missing. MCP status: missing (`control_call` routes **call audio**, not this media route).
  - Upstream evidence: [`779479c`](https://github.com/zackb/tether/commit/779479c07f08ae3c8b73862142fdb494cf0968f7) / [#280](https://github.com/zackb/tether/pull/280).
  - Surface change: GTK Settings has a switch for iPhone music/sounds on the computer versus phone; calls are unaffected and live route changes made on iPhone take precedence.
  - Protocol/daemon: `bt_set_phone_audio` with `route: here|phone` (TUI also sends `enabled`); `bt_status.phone_audio` preference and `phone_audio_route` observed route, `unavailable` when BlueZ is down.
  - Web touchpoints: `ui/src/views/settings/SettingsView.tsx`, `ui/src/protocolSchemas.ts`; current Calls description explicitly says call audio is not played in the browser. This host route is not browser playback.
  - MCP impact: new phone-media-audio route setter and existing `get_settings`/`get_status` field changes in `internal/mcpserver/tools/{settings,protocol,status}.go`; do not reuse `control_call` audio_here/audio_phone.
  - Parity states: unavailable adapter/profile, distinguish saved preference from observed route, delayed asynchronous BlueZ route change, errors and reconnect.
  - Web acceptance: describe the **host** route accurately and display the actual status rather than promising browser audio.
  - MCP acceptance: validated route input and status-backed observed/unknown result; no conflation with HFP call audio.
  - Dependencies/blockers: requires host audio path/BlueZ, not an upstream protocol change.

- [ ] **Control host clipboard auto-sharing**
  - Web UI status: missing. MCP status: missing.
  - Upstream evidence: [`f10fe09`](https://github.com/zackb/tether/commit/f10fe09ea423140bedc1f8dd7a29c266534657dc) / [#308](https://github.com/zackb/tether/pull/308).
  - Surface change: a persisted setting stops automatic **host desktop** text/image clipboard broadcasts; manual `clipboard_send` still works.
  - Protocol/daemon: `set_clipboard_auto_share` (`enabled`), `bt_status.clipboard_auto_share`; unlike a browser's own clipboard API this setting is host-global.
  - Web touchpoints: `ui/src/views/settings/SettingsView.tsx`, `ui/src/protocolSchemas.ts`; docs/UI_PARITY.md already explains manual host clipboard sending is deferred, not an implicit browser clipboard.
  - MCP impact: new setter or existing-settings extension plus `get_settings` field in `internal/mcpserver/tools/{settings,protocol}.go`; plaintext transfer/retention implications require explicit agent confirmation before turning on sharing.
  - Parity states: distinguish host-wide preference from browser notifications, unknown old-daemon status, reconnect and asynchronously observed broadcast; do not claim clipboard content is accessible to MCP.
  - Web acceptance: toggle accurately names host-to-phone automatic sharing and reflects daemon status.
  - MCP acceptance: explicit consent to enable, status-observed or unknown outcome, no implicit clipboard read.
  - Dependencies/blockers: None for the setting; browser Send Clipboard remains a separate pre-existing limitation.

- [ ] **Link bare, known-TLD domains in message bodies**
  - Web UI status: partial (HTTP(S) and `www.` links work, bare `example.com` does not). MCP status: not applicable (message bodies are returned as data, not HTML).
  - Upstream evidence: [`26f1af5`](https://github.com/zackb/tether/commit/26f1af506adfbbae0c1d5f347b98747efeba7536) / [#285](https://github.com/zackb/tether/pull/285), with `src/ui_common/message_format.cpp` and `test/test_message_format.cpp`.
  - Surface change: GTK/TUI linkify a bare domain only if its TLD is known, excluding email/address fragments; unknown domains remain text.
  - Protocol/daemon: no new command/event; `bt_messages.body` remains untrusted plain text. Do not blindly link every dotted token.
  - Web touchpoints: `ui/src/views/messages/messageFormat.tsx` regex currently matches only `https?://` or `www.`; `messageFormat.test.tsx` covers these, not bare domains.
  - MCP impact: no tool change; `internal/mcpserver/tools/messages.go` already returns plain message body rather than rendered markup.
  - Parity states: malformed/unknown TLD, email, punctuation, Unicode, and safe URL scheme; no HTML injection.
  - Web acceptance: known bare domains become safe HTTPS links while unknown domains and email fragments remain text.
  - MCP acceptance: return exact text as untrusted data, not clickable markup.
  - Dependencies/blockers: use an authoritative TLD policy or equivalent safe guard; no protocol change.

- [ ] **Show phone battery consistently outside HFP calls**
  - Web UI status: partial (Calls shows HFP's 0–5 indicator but Devices has no phone battery; new daemon top-level battery is 0–100 or null). MCP status: partial (`get_status` omits top-level `bt_connection_changed.battery`; `list_calls` has HFP indicator only).
  - Upstream evidence: [`43581bb`](https://github.com/zackb/tether/commit/43581bbeb7339a9bb8cb28b081d445ee6d98a4f5) / [#292](https://github.com/zackb/tether/pull/292).
  - Surface change: GTK Devices/tray show phone battery even when HFP unavailable, preferring LE Battery Service over HFP; Calls shows carrier/signal where available.
  - Protocol/daemon: `bt_connection_changed.battery` percent, null when unavailable; `calls.operator`, `calls.signal`, `calls.battery` (0–5) pre-existed. Keep those units distinct.
  - Web touchpoints: `ui/src/protocolSchemas.ts` has nested `calls.battery` but no top-level percent; `ui/src/views/calls/CallsView.tsx` shows carrier/signal/HFP battery, `ui/src/views/devices/DevicesView.tsx` lacks phone percent.
  - MCP impact: existing `get_status` output change in `internal/mcpserver/tools/{protocol,status}.go` for top-level battery; existing `list_calls` nested indicators remain valid, no new tool.
  - Parity states: null/absent versus zero, LE unavailable, HFP fallback, disconnected stale value, and browser accessibility labels.
  - Web acceptance: Devices displays daemon percent while connected without requiring HFP; Calls does not multiply an already-percent top-level value.
  - MCP acceptance: `get_status.connection.battery` is bounded percentage or absent with clear unit; no stale post-reconnect data.
  - Dependencies/blockers: None.

- [ ] **Choose a single paired recipient for each file send**
  - Web UI status: missing (staged browser files currently omit target, so tetherd broadcasts to all connected phones). MCP status: missing (`send_upload` likewise omits target and its description incorrectly says tetherd chooses one recipient).
  - Upstream evidence: [`4ec4bb3`](https://github.com/zackb/tether/commit/4ec4bb39f5e2bddc362fe40419752945ec36fb15) / [#258](https://github.com/zackb/tether/pull/258).
  - Surface change: GTK's Send to picker chooses a connected device when several are available; `send_file` gains optional target fingerprint, and `target_not_connected` distinguishes a missing selected device. The new host file-manager entry is platform-specific, but **single-recipient routing is not**.
  - Protocol/daemon: `send_file.target` chooses one paired peer by fingerprint; absent target explicitly means broadcast to every peer. `file_start/chunk/end` can also carry target, but browser/MCP use staged `send_file` through the gateway. `file_send_complete.operation_id` still correlates terminal results.
  - Web touchpoints: `ui/src/views/devices/PeerPane.tsx`, `ui/src/views/devices/FileTransfer.tsx`, `ui/src/views/devices/useFileTransfer.ts`, `internal/gateway/uploads.go` sends only `command/path/operation_id`; target is not bound to the staged upload.
  - MCP impact: existing `begin_upload`/`send_upload` schema and outcome change in `internal/mcpserver/tools/files.go` and `internal/gateway/uploads.go`; require an explicit recipient fingerprint from a current paired `list_peers` snapshot, and correct the description. No new feature-specific HTTP route or domain behavior in Go.
  - Parity states: zero/one/multiple recipients, target disconnect between staging and send, stale fingerprint after reconnect, cancellation and operation expiry, and potential ambiguous send; never silently downgrade an explicit target to broadcast.
  - Web acceptance: user sees the selected paired recipient and one upload reaches only that peer, with an error if it disappears; no implicit broadcast with multiple peers.
  - MCP acceptance: agent supplies/validates one current paired target before forwarding; correlated send result remains scoped to its operation; unknown delivery is not retried automatically.
  - Dependencies/blockers: target must be safely propagated through the existing bounded shared upload transport. A previously deployed daemon silently ignores `send_file.target` while advertising the same version/capability as a target-aware daemon; the web cannot establish single-recipient safety from the current protocol. Do not offer targeted sending or claim it is safe without a trustworthy daemon-side compatibility signal and owner approval for an upstream change.

## Upstream review log

- 2026-11-13: reviewed the complete `bcf83b1ed35ad3fec70b5d4b7e22b223898cc7f5..adb03f60c9c69e2b439c751e2c24434a8abfffaa` range (148 commits including merge commits), across web UI and MCP. Inspected the full ordered commit subject/path inventory, changed protocol, candidate GTK/daemon/iOS/TUI implementation and tests, merged PR index #238–#320 and releases v0.2.37–v0.3.5. Ten new open findings above: one web-only missing, one web-only partial, four missing in both clients, and four web-missing/MCP-partial or web-partial/MCP-partial findings; check individual entries for exact statuses. Reconciled two older UI-only items with MCP (Calls capability partial, pairing progress implemented); both remain open for web. Recent calls/favorites remain implemented. No code was implemented in this audit.
  - Not separate client gaps: [#240](https://github.com/zackb/tether/pull/240) adds a native terminal UI, not a new daemon command; [#245](https://github.com/zackb/tether/pull/245)/[#247](https://github.com/zackb/tether/pull/247) app-specific icons, [#263](https://github.com/zackb/tether/pull/263) inline desktop notification replies, and [`feeab24`](https://github.com/zackb/tether/commit/feeab24e916e9ff4205be8b3158d2ac18c85fb8) grouped file-arrival popups are daemon-host desktop notification behavior, while web/MCP already have message-send and upload flows. The host file-manager entry in [#258](https://github.com/zackb/tether/pull/258) is platform-specific, but its targeted send is tracked above; web already selects multiple browser files (`ui/src/views/devices/FileTransfer.tsx`) and MCP stages uploads via `begin_upload`/`send_upload`. [#252](https://github.com/zackb/tether/pull/252), [#268](https://github.com/zackb/tether/pull/268), [#282](https://github.com/zackb/tether/pull/282), [#304](https://github.com/zackb/tether/pull/304), [#306](https://github.com/zackb/tether/pull/306), and [#311](https://github.com/zackb/tether/pull/311) change the separate iOS app's sharing, image encoding, theme, batching, or reconnect UI. [#295](https://github.com/zackb/tether/pull/295) camera streaming uses a separate phone-to-daemon TLS/binary session and PipeWire video source, not a local Unix JSON browser/MCP command; the phone's camera controls belong to iOS. [#313](https://github.com/zackb/tether/pull/313) registers an encrypted BlueZ GATT address read for the iOS app when mDNS fails; neither web nor MCP discovers the daemon over that path.
  - Reliability and deployment classification: [#253](https://github.com/zackb/tether/pull/253), [#256](https://github.com/zackb/tether/pull/256), and [#302](https://github.com/zackb/tether/pull/302) extend daemon Bluetooth setup/reason diagnostics; clients already render daemon reasons (`DevicesView`, `get_status`) and should not recreate host probes. [#254](https://github.com/zackb/tether/pull/254), [#286](https://github.com/zackb/tether/pull/286), [#298](https://github.com/zackb/tether/pull/298), [#300](https://github.com/zackb/tether/pull/300), and [#310](https://github.com/zackb/tether/pull/310) fix daemon normalization, duplicate session, AirPods handoff, and Bluetooth reconnect without a new client command (existing event reducers refresh after reconnect). [`c0e23f5`](https://github.com/zackb/tether/commit/c0e23f5) reports failed inbound file transfers to the **iOS** sender rather than adding a local `send_file` result shape. [#261](https://github.com/zackb/tether/pull/261), [#279](https://github.com/zackb/tether/pull/279), [#297](https://github.com/zackb/tether/pull/297), and [#314](https://github.com/zackb/tether/pull/314) change packaging. [#318](https://github.com/zackb/tether/pull/318), [#319](https://github.com/zackb/tether/pull/319), [#320](https://github.com/zackb/tether/pull/320) add Flathub/Flatpak repository and native extension/secrets portal distribution for upstream Tether, not tether-web's headless gateway or MCP deployment mode. Version bumps, translation regenerations, formatting, docs-only, build-only and merge bookkeeping add no further client outcome.

- 2026-10-09: reviewed `d2f705ad30c1e7870eb6e935b7c873b6376e1b87..bcf83b1ed35ad3fec70b5d4b7e22b223898cc7f5` (20 commits across releases v0.2.36 and follow-on changes); inspected merged PRs [#229](https://github.com/zackb/tether/pull/229), [#231](https://github.com/zackb/tether/pull/231), [#232](https://github.com/zackb/tether/pull/232), [#233](https://github.com/zackb/tether/pull/233), [#234](https://github.com/zackb/tether/pull/234), [#235](https://github.com/zackb/tether/pull/235), and [#236](https://github.com/zackb/tether/pull/236), along with release [v0.2.36](https://github.com/zackb/tether/releases/tag/v0.2.36). Identified one new web UI parity item (recent call history and callback); MCP support is also missing, so the item remains for future implementation. MCP baseline: checked existing backlog and preceding review log against registered handlers, schemas and tests; prior two partial items remain UI-only assessments pending MCP reconciliation. No new MCP tools or changes were introduced in this upstream range; existing `list_calls`/`search_contacts` do not expose history/callback or favorite metadata.
  - [#234](https://github.com/zackb/tether/pull/234) (`1dc52a4c120e3b5dca81bdf9943c5d7da6508381`) adds PBAP `cch` recent-call history (bounded 100), `bt_list_call_history`/`bt_call_history`, callback via `bt_call_dial`, and favorite flags in `bt_contacts`; GTK displays history when live calls are absent, offers callback, and marks favorites. Verified daemon handlers and GTK calls/contacts views plus tests. Web status: missing; schemas have no history command/event or favorite field, `CallsView` renders live HFP only, and `useContacts` consumes ordinary `bt_contacts`. Existing upstream protocol support means future UI work is actionable. MCP status: missing; `list_calls` and `search_contacts` remain live-call and address-book search only, with no history/favorite fields. No implementation in this audit-only stage.
  - [#235](https://github.com/zackb/tether/pull/235) adds a GTK collapsible icon sidebar and local preference; navigation geometry/preferences are desktop presentation, no browser gap.
  - [#233](https://github.com/zackb/tether/pull/233) retries daemon Wayland clipboard initialization; host clipboard lifecycle only. #229 UTF-8 clipboard MIME handling fixes host clipboard representation; #231 peer backpressure and #232 BlueZ warnings are internal reliability/diagnostics without a new web workflow. #236 regenerates translations; #222 GTK redesign changes native layout but adds no capability. Existing #221 host desktop popup setting and #224 separate native extension remain browser-inapplicable as previously recorded. Checked complete range commit subjects, paths and diffs, release/merged PRs, targeted GTK/daemon code/tests, and corresponding web/MCP schemas and handlers.

- 2026-10-06: reviewed `a5ad39a0e8903f87384c257cd55daef91313b0f6..d2f705ad30c1e7870eb6e935b7c873b6376e1b87` (6 commits after v0.2.35); inspected merged PRs [#219](https://github.com/zackb/tether/pull/219), [#221](https://github.com/zackb/tether/pull/221), and [#224](https://github.com/zackb/tether/pull/224). No new web parity items; the two existing partial items remain open. [#221](https://github.com/zackb/tether/commit/5fcc1f49841240d22655e4119be42bea0f764d61) adds `set_popup_previews` and `popup_previews_enabled` for **daemon-host desktop popups** only. The web client's `useBrowserNotifications.ts` deliberately emits generic, content-free alerts independent of host popups, and `SettingsView.tsx` documents that platform difference; exposing this host setting as a browser notification preference would be misleading. [#224](https://github.com/zackb/tether/commit/ad8b6b0aca7df6e37d28fd113407af38cbf89748) enables local installation of Tether's separate Chromium native-messaging extension, not a GTK/web-client feature. [#219](https://github.com/zackb/tether/commit/efa0eaa98bf9db6cd3be881ccc037bc48648d255) only documents tether-web headless use. Checked the upstream compare's paths and diffs, related PRs and release, and the local protocol schemas, transport, lifecycle, Settings, browser alerts, and existing parity guidance.

- 2026-09-29: first review, baseline `v0.2.34..v0.2.35` (`f4173de675f1463c02543fa62d4914115b337590..a5ad39a0e8903f87384c257cd55daef91313b0f6`). Upstream `main` was at the v0.2.35 release and `develop` had nothing ahead of it. This covers only that release, not earlier Tether history; [docs/UI_PARITY.md](docs/UI_PARITY.md) tracks older gaps such as Send Clipboard. Inspected PRs #207, #208, #211, #214, #215 and #217. Found 2 partial items.
  - Already implemented in tether-web: `protocol_info` and capability gating, the `apple_nearby` hint, pairing `operation_id` on `bt_pair`, `bt_unpair` and `bt_pair_confirm`, `send_file` result correlation including connection failures, `bt_send_message` result correlation with `thread`, the conditional `clipboard` capability (`PeerPane.tsx`), and `TETHER_BLUEZ_SECURE_CONNECTIONS` in the Compose example.
  - Ignored, no web user outcome: Flatpak and libsecret documentation (#207, #215), issue templates, the `--bt-setup` experimental-API detection fix, and the fingerprint check on outgoing peer connections (#217).
