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
messaging, contact, notification, call, or file-transfer policy.

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
| App shell | Partial | Shared header, GTK tab order, route status footer | View switching, shortcuts, settings entry, shared unread state |
| Devices | Partial | Wi-Fi discovery, incoming/outgoing trust, online/offline state, forget flow, mDNS/firewall guidance, and file sending by picker or drop; Bluetooth discovery, pairing and connection capabilities; complete AirPods controls | Bluetooth setup/solicitation controls |
| Messages | Not started | Navigation placeholder | Threads, search, conversation, drafts, compose/send, read state, permission guidance |
| Notifications | Not started | Navigation placeholder | Notification list, refresh, removal, dismissal, connection guidance |
| Calls | Not started | Navigation placeholder | Availability, call list, dial, answer, hang up, audio routing, network state |
| Contacts | Not started | Navigation placeholder | Search, grouped contact details, message handoff |
| Settings | Not started | None | Bluetooth, ANCS, popup, call, away-lock, retention, and tray preferences where applicable |
| Shared helpers | Not started | None | Contact completion, message formatting, persisted preferences |

Update this table whenever either client gains or intentionally changes a
user-visible capability.

## Delivery sequence

1. **Keep the common shell stable.** Route all daemon traffic through one client,
   keep app-wide navigation/status in `app/`, and keep feature state in its view.
2. **Finish Devices parity.** AirPods, Wi-Fi peer management, and file sending
   are complete. Add the remaining Bluetooth controls. Preserve the current
   pairing workflow while adding the missing operations.
3. **Add Messages.** Mirror thread visibility refresh, conversation selection,
   drafts, compose/send state, errors, and disconnect cleanup. Add shared contact
   completion and message formatting as those dependencies appear.
4. **Add Notifications and Calls.** Keep their visibility-driven refresh and
   daemon capability behavior aligned with GTK.
5. **Add Contacts.** Preserve search and the handoff that opens a message thread.
6. **Add Settings and preferences.** Share terminology and daemon settings while
   adapting desktop-only controls to browser equivalents or recording why no
   equivalent exists.
7. **Close cross-cutting gaps.** Add keyboard navigation, unread indicators,
   browser notification behavior, and other shell-level parity.

Each step should be independently usable and should not require feature-specific
HTTP endpoints in the Go gateway.

## Verification

Every parity change should include the narrowest applicable checks:

1. daemon protocol tests for new or changed command/event behavior;
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

- AirPods management has the same daemon commands, state gating, and user outcomes
  as GTK. The browser uses semantic buttons, checkboxes, and a select control
  rather than GTK linked radio buttons and native combo boxes.
- AirPods state is retained by the gateway and requested whenever its daemon
  connection starts, because browser tabs may attach after the daemon's initial
  AirPods event.
- Wi-Fi peers use daemon-owned fingerprints and trust decisions. The browser
  displays the fingerprint before approval, requests discovery after each daemon
  reconnect, and presents browser-specific clipboard-permission wording instead
  of GTK compositor diagnostics. Discovery and outbound pairing have bounded
  client timeouts.
- Wi-Fi discovery and pairing events do not carry operation IDs. The browser
  serializes its own discovery and outbound-pair operations, scopes failures by
  a local token or peer fingerprint where the protocol permits it, and treats
  each valid discovery result as the daemon's latest authoritative snapshot.
- GTK passes a daemon-host filesystem path to `send_file`. Browsers cannot
  provide such a path, so the web client reads a selected file in bounded chunks.
  `tetherd` stages at most two 256 MiB uploads in its runtime directory, then
  forwards each completed file through the existing `Client::send_file` path.
  Upload commands and results carry an operation ID; unfinished uploads are
  cancellable, while an accepted send runs to one terminal result with a bounded
  browser wait. The Go gateway remains a transport-only JSON bridge.
- The current daemon's AirPods connection result has no operation ID or device
  address. The browser scopes pending state to the selected address, prevents a
  duplicate operation for that device in one tab, and times out a missing result; fully rejecting
  stale results from another tab requires a future upstream protocol addition.
