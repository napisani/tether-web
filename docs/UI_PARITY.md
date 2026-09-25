# GTK and web UI parity

The GTK and web applications are two clients of the same `tetherd` protocol. The
web application should reach functional parity with GTK without copying GTK's
widget implementation into React.

Tether's [`src/gtk/`](https://github.com/zackb/tether/tree/main/src/gtk) implementation is the reference for feature boundaries, terminology, navigation, and lifecycle behavior. `AGENTS.md` defines the source-layout and naming rules that preserve those correspondences.

## Parity contract

For each feature, parity covers:

- the same daemon commands, events, and capability gates;
- the same user-visible operations and outcomes;
- loading, empty, unavailable, failure, and reconnect states;
- refresh behavior when a view becomes visible;
- cleanup of operations waiting for a daemon response;
- equivalent keyboard and accessibility behavior where the platform permits it.

Parity does not require pixel-identical presentation. Responsive web layouts,
browser permission models, desktop integration, and native widgets may require
different interactions. Those differences should remain explicit rather than
silently dropping behavior.

Domain behavior belongs in `tetherd`. GTK and React may present state
differently, but neither client should independently redefine pairing,
messaging, contact, notification, call, or file-transfer policy. The existing
`tetherd` protocol is authoritative: parity work should adapt to its commands,
events, and capabilities before considering an upstream change. Browser-local
serialization, timeouts, and reconnect cleanup are preferred when they safely
bridge a platform difference. Any unavoidable protocol addition must document
the missing capability and remain narrow, backward-compatible, and separately
reviewed upstream.

## Source correspondence

The GTK links below point to the canonical implementation in
[`zackb/tether`](https://github.com/zackb/tether); this repository does not
vendor or duplicate those sources.

| Tether GTK module | Web module |
|---|---|
| [`src/gtk/main.cpp`](https://github.com/zackb/tether/blob/main/src/gtk/main.cpp) | `ui/src/app/TetherApp.tsx`, `AppShell.tsx` |
| [`src/gtk/daemon_client.cpp`](https://github.com/zackb/tether/blob/main/src/gtk/daemon_client.cpp) | `ui/src/daemon/DaemonClient.ts` |
| [`src/gtk/devices_view.cpp`](https://github.com/zackb/tether/blob/main/src/gtk/devices_view.cpp) | `ui/src/views/devices/DevicesView.tsx` |
| [`src/gtk/messages_view.cpp`](https://github.com/zackb/tether/blob/main/src/gtk/messages_view.cpp) | `ui/src/views/messages/MessagesView.tsx` |
| [`src/gtk/notifications_view.cpp`](https://github.com/zackb/tether/blob/main/src/gtk/notifications_view.cpp) | `ui/src/views/notifications/NotificationsView.tsx` |
| [`src/gtk/calls_view.cpp`](https://github.com/zackb/tether/blob/main/src/gtk/calls_view.cpp) | `ui/src/views/calls/CallsView.tsx` |
| [`src/gtk/contacts_view.cpp`](https://github.com/zackb/tether/blob/main/src/gtk/contacts_view.cpp) | `ui/src/views/contacts/ContactsView.tsx` |
| [`src/gtk/settings_view.cpp`](https://github.com/zackb/tether/blob/main/src/gtk/settings_view.cpp) | `ui/src/views/settings/SettingsView.tsx` |
| [`src/gtk/contact_completion.cpp`](https://github.com/zackb/tether/blob/main/src/gtk/contact_completion.cpp) | shared contact-completion component or hook |
| [`src/gtk/message_format.cpp`](https://github.com/zackb/tether/blob/main/src/gtk/message_format.cpp) | shared message-formatting module |
| [`src/gtk/prefs.cpp`](https://github.com/zackb/tether/blob/main/src/gtk/prefs.cpp) | shared browser-preferences module |
| [`src/gtk/ui_util.cpp`](https://github.com/zackb/tether/blob/main/src/gtk/ui_util.cpp) | app shell and shared presentation utilities |

A React view may contain smaller components and hooks. The public view name and
its ownership should still make the GTK/Web relationship obvious.

## Current status

| Area | Status | Web coverage | Remaining GTK behavior |
|---|---|---|---|
| App shell | Implemented locally | Shared header, capability-aware Calls tab, Devices/Messages/Notifications/Contacts/Settings navigation, live unread badge, browser-safe shortcuts, accessible focus/tab order, route status footer | GTK window/tray integration has no remote-browser equivalent; hardware validation remains separate |
| Devices | Partial | Wi-Fi discovery, trust, connection state, forget flow, mDNS/firewall guidance, sequential browser multi-file sending with batch progress/cancellation; Bluetooth discovery, pairing, supervision, host setup guidance, permission solicitation, and profile diagnostics; complete AirPods controls | Send Clipboard (deferred pending app-wide security review and a trustworthy completion signal); physical-phone/hardware validation |
| Messages | Partial | Thread list/search, grouped conversation history with safe links, per-thread drafts, contact suggestions and manual recipient input, correlated send results, mark-read requests, permission guidance, app-wide unread refresh and disconnect clearing, responsive navigation; user-validated on a physical phone | Broader device/permission matrix |
| Notifications | Partial | ANCS list/refresh, app metadata and content, iPhone dismissal and removal, ANCS reason/permission guidance, reconnect cleanup, responsive navigation, opt-in redacted browser alerts | Physical-phone ANCS validation |
| Calls | Partial | HFP availability, live call list, dial/answer/decline/hang up, daemon-host/iPhone audio routing, network indicators, withheld numbers, reconnect and uncertain-outcome handling | Physical-phone HFP validation, contact completion, persistent call history (not supplied by daemon) |
| Contacts | Implemented locally | PBAP-gated bounded address-book refresh, accent-insensitive name/address search, expandable phone/email details, copy and namespaced message-thread handoff, unavailable/error/reconnect states, responsive layout | Physical-phone PBAP validation |
| Settings | Implemented locally | Daemon-global ANCS mirroring/content, call-control and retention controls; authoritative status, destructive-storage confirmation, keyring/privacy guidance, uncertain-outcome handling and reconnect cleanup; links to Devices for Bluetooth supervision | Headless/browser-inapplicable desktop tray, host desktop popups and away-lock documented below; physical-phone validation |
| Shared helpers | Partial | Message formatting and contact suggestions in Messages; contact-to-message handoff; versioned browser-only alert preference | App-wide contact completion (where a browser flow needs it) |

Update this table whenever either client gains or intentionally changes a
user-visible capability.

## Delivery sequence

1. **Keep the common shell stable.** Route all daemon traffic through one client,
   keep app-wide navigation/status in `app/`, and keep feature state in its view.
2. **Finish Devices parity.** Bluetooth setup guidance, supervision, and
   permission recovery and multi-file queueing are implemented. Send Clipboard
   is deferred until app-wide security and completion semantics are resolved;
   complete physical-phone validation without replacing the existing bond.
3. **Add Messages.** Thread visibility refresh, selection, drafts, compose/send
   state, errors, and disconnect cleanup are implemented locally. Confirm the
   separate optional `bt_send_message` operation-ID change upstream before
   shipping: the web never treats an uncorrelated global send result as its own.
   Extend the device/permission matrix separately; app-wide unread refresh is
   implemented without attributing uncorrelated events to a browser tab.
4. **Add Notifications and Calls.** Both views now mirror GTK's visibility-
   driven refresh and daemon capability behavior locally. Validate notification
   dismissal and Hands-Free calls on a physical iPhone before rollout.
5. **Add Contacts.** Preserve search and the handoff that opens a message thread.
6. **Add Settings and preferences.** Share terminology and daemon settings while
   adapting desktop-only controls to browser equivalents or recording why no
   equivalent exists.
7. **Close cross-cutting gaps.** Browser-safe keyboard navigation, unread
   indicators, browser notification consent, and shell focus behavior are
   implemented locally. Physical-phone and broad accessibility checks remain
   separate from simulated browser tests.

Each step should be independently usable and should not require feature-specific
HTTP endpoints in the Go gateway.

## Verification

Every parity change should include the narrowest applicable checks:

1. daemon protocol tests only when upstream command/event behavior must change;
2. feature reducer tests for event ordering, stale operations, and disconnects;
3. React component tests for visible states and user actions;
4. Playwright coverage for complete browser workflows;
5. GTK-side coverage when shared daemon behavior changes.

For the initial web release, keep these tests focused within each client rather
than introducing shared fixture infrastructure. Shared event fixtures can be
added later if repeated cross-client drift justifies the additional coupling.

Platform-specific differences belong in this document or beside the relevant
code. They are decisions to review, not implicit omissions.

## Intentional platform differences

- The desktop browser shell keeps content between its header and status footer;
  Devices and Messages scroll their list and detail panes independently. Their
  scrollbar thumbs appear on hover, keyboard focus, or active scrolling. On
  narrow screens, Devices returns to normal page scrolling, navigation indicates
  when more routes are offscreen, and a compact connection summary expands to
  the full daemon, Wi-Fi, and Bluetooth diagnostics. GTK scrollbars and status
  chrome follow the host's native theme instead.
- Settings is a browser page instead of GTK's separate preferences window. Bluetooth
  supervision and permission recovery remain in Devices rather than duplicating
  their controls. ANCS mirroring (`bt_set_ancs`), notification text
  (`bt_set_ancs_content`), call control (`bt_set_calls`), and host message/contacts
  retention (`bt_set_retention`) operate on `tetherd` for all clients. The web
  requires the advertised `settings` capability and displays `bt_status` as
  the authority. It serializes local changes, waits for a matching global
  status before acknowledging a request, and requires an explicit check before
  retrying after an ambiguous result. Global broadcasts
  do not identify which browser made a request; matching status proves only
  that the *host setting* has the requested value. "Do not keep" irreversibly
  deletes retained host messages and contacts and needs confirmation; plaintext
  storage also needs a privacy confirmation. Encrypted mode without a ready
  host keyring warns that persistence is paused. Turning off ANCS content
  also disables daemon-side group-reply correlation.
- GTK's close-to-tray and symbolic/color tray icon choices have no browser
  process/tray equivalent. `set_desktop_popups` targets the **host desktop**;
  browser OS notifications have separate origin permissions and are controlled
  by the independent browser-only switch below, not this host setting. `bt_set_lock_on_away` locks the **host desktop
  session**, not a remote browser tab; neither control is presented in the
  headless web deployment. Their status may be observed in `bt_status`, but
  the browser never implies it can lock its remote user's screen.
- AirPods management has the same daemon commands, state gating, and user outcomes
  as GTK. The browser uses semantic buttons, checkboxes, and a select control
  rather than GTK linked radio buttons and native combo boxes.
- AirPods state is retained by the gateway and requested whenever its daemon
  connection starts, because browser tabs may attach after the daemon's initial
  AirPods event.
- Wi-Fi peers use daemon-owned fingerprints and trust decisions. The browser
  displays the fingerprint before approval, requests discovery after each daemon
  reconnect, and reports host compositor availability instead of browser
  clipboard permission. Discovery and outbound pairing have bounded client
  timeouts.
- Wi-Fi discovery and pairing events do not carry operation IDs. The browser
  serializes its own discovery and outbound-pair operations, scopes failures by
  a local token or peer fingerprint where the protocol permits it, and treats
  each valid discovery result as the daemon's latest authoritative snapshot.
- GTK passes a daemon-host filesystem path to `send_file`. Browsers cannot
  provide such a path, so the web client reads selected files in bounded chunks.
  Browser batches enqueue multiple files but stage/send one at a time; oversized
  items count as failures, non-file drops count as skipped, and cancelling or
  losing the daemon drops unstarted items. The Go gateway stages at most two
  256 MiB files on the shared disk-backed runtime volume and then calls the
  daemon's existing `send_file` with a path and optional operation ID. Once
  `file_upload_finish` forwards that command, cancellation cannot recall the
  send; the client waits for the matching terminal event and stops the batch
  if the result times out. The gateway cleans staged files on completion or
  bounded expiry. Folder drops are rejected where the browser exposes
  directory entries. Go owns only staging and transport, not file delivery.
- Message-send results are globally broadcast by older daemons. The web sends
  an optional operation ID and only clears a draft for a matching `bt_send_result`;
  missing or legacy results leave the draft intact and eventually show an
  uncertain-outcome warning. A manual new-message address is submitted in the
  daemon's documented `tel:`/`email:` namespace, with final validation owned by
  `tetherd`; unlike GTK, the browser does not prevalidate or normalize it. The
  Messages view requires the optional message-send ID at the stacked core tip.
- Notifications use the daemon's app name/ID rather than GTK's local icon-theme
  lookup; the browser shows a source initial instead of inventing an iPhone app
  icon. ANCS offers no deep link. The view does not request browser OS popup
  permission on load or persist sensitive content; it clears rows on disconnect.
  A separate Settings switch requests permission only on user action and enables
  generic live ANCS alerts only when the tab is hidden.
  A dismissal result identifies a notification UID but not the requesting tab,
  so the browser disables the matching row while the result is pending and
  leaves uncertain outcomes disabled until the daemon removes the notification
  or the connection is reset. The daemon's `ancs_reason` is shown verbatim.
- Calls use the daemon's live HFP `bt_calls` snapshot, not an invented call
  history. The browser deliberately leaves the dial number intact after a
  global, uncorrelated `bt_call_result`. Neither that result nor an unrelated
  outgoing call completes this browser's dial: repeat dialing stays disabled
  until the user checks the iPhone and explicitly enables retry after the
  pending action times out. Answer and hang-up actions resolve only from the
  targeted call's state; unrelated global results do not alter pending work.
  GTK's “Audio here” means the daemon host's PipeWire backend, not
  the device running a remote browser. The web UI explicitly names that host
  and does not claim to stream call audio into the browser. GTK hides the Calls
  tab when call control is off; the web now does the same, returning to Devices
  if the host disables Calls or the daemon disconnects while that view is open.
  Host opt-in remains in Settings. A remote gateway now
  requires a password file and protects the browser API with HTTP Basic over
  deployment-provided HTTPS; all authenticated sessions still share the same
  daemon permissions.
- Contacts request the same 5,000-entry bounded `bt_list_contacts` list as GTK and
  hand the daemon's `tel:`/`email:` keys directly to Messages. The browser
  filters names and addresses locally, including accent-insensitive matching,
  and does not persist the address book. Unlike GTK's persisted contact store,
  browser rows clear on PBAP loss and daemon disconnect to protect private data
  on remote devices; refresh is available again when PBAP reconnects. The
  daemon's uncorrelated `bt_contacts` replies are shared across tabs: this view
  accepts only full-list (`query: ""`) events while visible and connected, not
  the query-specific suggestions used by Messages. `tetherd` handles list
  commands synchronously over the gateway's single ordered socket, so an
  earlier full-list reply cannot overwrite a later one; a reply already in
  flight may briefly display old rows after PBAP reconnect until the fresh
  list arrives. All authenticated browser tabs intentionally share daemon
  privileges and receive its uncorrelated events, so this is not per-tab
  private storage or a claim of request ownership.
- GTK uses app accelerators and a tray unread count. The browser keeps an
  unread badge from `bt_threads` while Messages is hidden and refreshes it on
  incoming messages and successful reads. Retained host `bt_threads` replies
  are ignored until `map_open` confirms the current phone, including during
  contact handoff; counts, private rows, and the selected thread heading clear
  on daemon/MAP loss while unsent drafts and ambiguous-send warnings remain.
  Ctrl/Meta+1–5 selects Devices, Messages, Notifications, Contacts, Calls
  (only when enabled); Ctrl/Meta+N composes, Ctrl/Meta+F searches Messages,
  and Ctrl/Meta+, opens Settings. Editing fields and browser-reserved close/quit
  shortcuts are untouched; browser/OS shortcuts can still take precedence.
  All interactive controls use visible keyboard focus, and new-message and
  search shortcuts focus their respective fields. Browser tab order follows
  visible navigation rather than forcing GTK's window focus model.
- Browser OS notifications are **off by default** and independent of
  `set_desktop_popups`. The preference stores only `enabled`/`disabled` under
  a versioned localStorage key; no event, contact, sender, or message content
  is stored there. On a secure origin, a user-initiated action requests origin
  permission; denied/unsupported states and blocked storage are surfaced.
  Revoking permission in browser settings disables the saved preference on
  focus/visibility change or before the next alert. While the page is hidden,
  daemon/ANCS status is ready, and the latest host `bt_status` still allows
  ANCS on the selected device, live
  `bt_notification` events produce only “New iPhone notification” / “Open
  Tether to view it.” without source metadata or sensitive text. Opening an
  alert focuses the Notifications view, not an iPhone deep link. Initial
  `bt_notifications` snapshots never alert; a bounded in-memory UID set
  suppresses replay in one tab and resets on daemon/ANCS loss. A shared
  authenticated daemon can feed multiple tabs, so alerts are **not** exactly
  once across tabs. Browser notification centers can retain generic alerts
  after disconnect; the app cannot revoke those OS entries. Headless browser
  tests mock permissions and OS delivery, not physical ANCS behavior.
- **Send Clipboard** remains deferred. `clipboard_send` reads the *host desktop*
  selection, not the browser clipboard, and broadcasts plaintext clipboard
  events to every authenticated browser.
  The global `clipboard_content` response cannot safely confirm which request
  completed after a timeout or from another tab. Resolve app-wide security and
  confirmation semantics before exposing this action in the web UI.
- The current daemon's AirPods connection result has no operation ID or device
  address. The browser scopes pending state to the selected address, prevents a
  duplicate operation for that device in one tab, and times out a missing result; fully rejecting
  stale results from another tab requires a future upstream protocol addition.
- Bluetooth supervision and permission solicitation use the daemon's existing
  global `bt_set_enabled`, `bt_status`, `bt_solicit`, and `bt_solicit_result`
  semantics. The browser permits one local control operation at a time, bounds
  pending state with a timeout, and clears it on daemon disconnect. Because the
  global result has no operation ID, the next solicitation result while a local
  request is pending is treated as the authoritative daemon outcome; concurrent
  trusted clients are not independently attributable. The web does not require
  a client-specific daemon protocol for this globally observable state.
