# GTK parity implementation plan

## Objective

Reach browser parity with every feature currently supported by the upstream
[`zackb/tether`](https://github.com/zackb/tether) GTK client while keeping
`tether-web` an independent client of the authoritative `tetherd` protocol.

The Go gateway remains a bounded transport adapter. Domain behavior stays in
`tetherd`, and React owns browser presentation and client-local lifecycle state.
The web repository is public. Infrastructure deployment remains a separate,
explicitly authorized operation.

## Protocol-first rule

Upstream `tetherd` defines the protocol. For every feature:

1. Inspect the canonical GTK implementation and corresponding daemon handlers.
2. Exercise the existing commands, events, and capabilities first.
3. Prefer browser-local serialization, pending state, timeouts, and reconnect
   cleanup when those can safely bridge platform differences.
4. Keep the Go gateway transparent; do not invent feature-specific HTTP APIs or
   translate the daemon protocol into a second domain model.
5. Do not assume Tether must change to make the web implementation easier.

If the existing protocol cannot safely produce the GTK-equivalent outcome,
document the exact gap and stop for owner agreement. Any approved Tether change
must be minimal, backward-compatible, separately branched and reviewed, preserve
GTK behavior, and avoid unrelated daemon or GTK refactoring. Handle unrelated
upstream bugs separately unless they directly block parity.

Two established exceptions illustrate the threshold:

- external numeric-comparison pairing needs operation correlation so a
  conforming client only presents and answers the confirmation it initiated;
- browsers cannot supply daemon-host paths to `send_file`, so the Go gateway
  stages bounded bytes on a shared, daemon-visible volume before invoking the
  existing send path. An optional send result ID is reviewed separately;
- message sends need an optional result ID to avoid mistaking another client's
  global `bt_send_result` for this tab's confirmation.

## Batch delivery contract

Every batch is independently usable and follows this sequence:

1. Inspect upstream GTK and daemon behavior.
2. Record the existing protocol surface and browser-specific differences.
3. Implement the smallest browser change.
4. Add applicable Go, TypeScript, parser, reducer, component, fake-gateway,
   Playwright, accessibility, reconnect, and responsive coverage.
5. Run Go formatting, `go vet`, Go race tests, Vitest, TypeScript/Vite build,
   desktop/mobile Playwright, container build/runtime smoke, and `git diff --check`.
6. Run Luna multi-valued review, remediate defensible findings, and rerun affected
   gates.
7. Update `docs/UI_PARITY.md`.
8. Commit and push the bounded batch.
9. Require successful `check` and `container` CI.
10. Confirm a clean working tree before starting the next batch.

Stop with evidence and required owner input if Luna is unavailable, the existing
protocol cannot support the feature, manual hardware confirmation is required,
or no defensible path remains.

## Batch 1 — Bluetooth setup and status

Deliver browser parity for the existing GTK Bluetooth setup/status experience:

- host capability mode, reasons, and setup commands;
- Classic, Low Energy, MAP, PBAP, and ANCS diagnostics;
- supervision preference using existing `bt_set_enabled` and `bt_status` semantics;
- iPhone permission solicitation using existing `bt_solicit` and
  `bt_solicit_result` semantics;
- strict client-side pairing correlation for numeric comparison;
- post-pair/unpair refresh through existing `bt_status` and `bt_list_devices`
  commands;
- capability-gated controls, unavailable states, timeout/failure recovery,
  disconnect cleanup, accessible confirmation dialogs, and responsive behavior.

No new Bluetooth-control capability or control-specific operation ID is required.
The browser serializes these global controls locally and bounds pending state.

Acceptance requires full local gates, a review verdict, a committed and
pushed web batch, successful CI, and a clean `tether-web` working tree.
PR #211 remains unchanged at its existing committed head.

## Batch 2 — Finish Devices

- Select and drop multiple files.
- Send sequentially through the existing browser-upload protocol.
- Show current item, batch progress, failures, skipped items, and final tally.
- Define cancellation and clear queues on disconnect/unmount.
- Defer **Send Clipboard** until cross-client event visibility and
  response-confirmation semantics are approved; HTTP Basic protects access but
  the uncorrelated `clipboard_content` broadcast cannot prove request ownership.
- Show accurate compositor/clipboard availability guidance.

This batch should not require C++ changes.

## Batch 3 — Messages and shared foundations

Implement thread discovery, search, conversation selection, history, drafts,
compose/send, read state, permission guidance, lifecycle refresh, reconnect
cleanup, responsive navigation, and accessibility. Introduce contact completion
and message-formatting helpers only when these concrete flows need them.

## Batch 4 — Notifications

Implement list, refresh, source metadata, dismissal/removal, empty and unavailable
states, ANCS/permission guidance, reconnect cleanup, responsive presentation, and
accessibility. Keep live-hardware claims separate from simulated protocol proof.

## Batch 5 — Calls

Implement telephony availability, current/recent calls, dial, answer, hang up,
audio routing, cellular/network state, withheld callers, failure handling,
reconnect cleanup, and mobile-safe accessible controls.

## Batch 6 — Contacts

Implement search, grouped details, phone/email presentation, name resolution,
message handoff, empty/unavailable states, and responsive navigation. Reuse the
shared foundations introduced by Messages.

## Batch 7 — Settings and preferences

Classify every GTK setting as an existing daemon setting with a browser
equivalent, a browser-local preference, or a desktop-only behavior with no useful
browser equivalent. Implement or explicitly document Bluetooth, ANCS, popup,
call, away-lock, retention, tray, and related preferences accordingly.

## Batch 8 — Shared application parity

Complete view switching, tab order, shortcuts, unread state, visibility-driven
refresh, persisted browser preferences, browser notifications, global reconnect
behavior, responsive navigation, and an application-wide accessibility pass.

## Final prompt-to-artifact audit

Before declaring parity complete:

1. Restate every success criterion.
2. Map every upstream GTK feature and explicit requirement to its daemon
   command/event, browser implementation, tests, commit, and successful CI run.
3. Inspect the actual files and evidence rather than relying on test or manifest
   summaries alone.
4. Verify all intentional platform differences are documented.
5. Verify the gateway is still transport-only and no unapproved upstream change,
   publication, or deployment occurred.
6. Verify the public repository and all relevant working trees are clean.
7. Treat every uncertain or weakly verified item as incomplete.

## Current execution boundary

Batches 1–3 are deployed to the homelab from pinned core and web stack tips;
Messages passed user-led phone testing. Batch 4 Notifications is committed but
not deployed. Batch 5 Calls is in a separate stacked local web worktree, still
awaiting physical-phone HFP validation. Send Clipboard is deferred pending
app-wide security and trustworthy completion semantics. Each new deployment
needs separate approval.
