# Web Package Guidelines

## GTK/Web semantic mirroring

The GTK app and web app are separate clients of the same `tetherd` protocol. They should eventually provide the same user-facing features, even though their implementation details differ.

Treat the upstream [Tether GTK source](https://github.com/zackb/tether/tree/main/src/gtk) as the reference for feature boundaries, terminology, navigation, and lifecycle behavior. A local Tether checkout may be used for development convenience, but documentation and code comments must link to `zackb/tether` rather than depend on a sibling repository layout. Mirror GTK semantically, not line by line: keep the React code idiomatic and extract components where React benefits from doing so.

Use these top-level correspondences:

| GTK | Web UI |
| --- | --- |
| `main.cpp` | `src/app/TetherApp.tsx` and `src/app/AppShell.tsx` |
| `daemon_client.cpp` | `src/daemon/DaemonClient.ts` |
| `devices_view.cpp` | `src/views/devices/DevicesView.tsx` |
| `messages_view.cpp` | `src/views/messages/MessagesView.tsx` |
| `notifications_view.cpp` | `src/views/notifications/NotificationsView.tsx` |
| `calls_view.cpp` | `src/views/calls/CallsView.tsx` |
| `contacts_view.cpp` | `src/views/contacts/ContactsView.tsx` |
| `settings_view.cpp` | `src/views/settings/SettingsView.tsx` |
| `contact_completion.cpp` | a shared `ContactCompletion` component or hook |
| `message_format.cpp` | a shared `messageFormat` module |
| `prefs.cpp` | a shared `prefs` module |
| `ui_util.cpp` | shared presentation utilities or components |

### Naming and layout rules

- Name each top-level React feature after its GTK counterpart: `DevicesView`, `MessagesView`, `NotificationsView`, `CallsView`, `ContactsView`, and `SettingsView`.
- Put top-level features under `src/views/<feature>/`. Do not rename a GTK `View` to `Page` or `Screen` in the web app.
- Keep app-wide navigation, header, status, and routing in `src/app/`; do not place shared chrome inside a feature directory.
- Keep daemon transport in `src/daemon/`. Transport code may parse, reconnect, and send commands, but it must not own feature behavior.
- Let each view own its feature-specific state reduction, commands, components, and lifecycle handling. Use names that reflect the concepts in the corresponding GTK view.
- React-only subcomponents are expected. Prefer concrete names such as `DeviceList`, `DevicePane`, `BluetoothPairing`, `ThreadList`, and `Conversation` over generic names such as `Panel`, `Section`, or `Manager`.
- Do not create a generic view framework merely to make the directory trees look identical. The correspondence should be obvious without forcing GTK and React into the same programming model.

### Styling and visual parity

Mirror GTK's information hierarchy, states, and interaction emphasis rather than copying widget geometry or fixed pixels. GTK mostly inherits the active system theme, while the browser needs explicit CSS, so parity means a recognizable shared visual language rather than identical color values.

Before styling a web view, inspect both the corresponding view in [Tether's GTK source](https://github.com/zackb/tether/tree/main/src/gtk) and its shared [`ui_util.cpp`](https://github.com/zackb/tether/blob/main/src/gtk/ui_util.cpp) rules. Preserve the same distinctions between selected and unselected rows, primary and secondary actions, muted and active status, setup guidance, errors, empty states, and route availability.

Keep styling organized as follows:

- `src/styles/theme.css` owns shared color and typography tokens.
- `src/styles/base.css` owns only document defaults, focus behavior, and accessibility-wide rules.
- `src/app/AppShell.css` owns app-wide header, navigation, and route-status styling.
- Each top-level view owns one colocated stylesheet such as `src/views/devices/DevicesView.css`.
- Root view styles under that view's class, such as `.devices-view`, so feature styles do not leak into later views.
- Keep responsive rules with the component or view that owns the affected layout.

Use semantic tokens such as `--color-surface-selected`, `--color-text-muted`, `--color-accent`, and `--color-danger`. Do not name shared tokens after a literal hue, and do not scatter new hex colors through component styles. GTK theme concepts map to web tokens by role: foreground to text, selected background to accent or selected surface, and reduced opacity to muted text.

Prefer plain CSS and concrete semantic class names. Do not add CSS-in-JS, a utility framework, a generic design-system layer, or shared components solely to deduplicate a few declarations. Extract a shared style only after multiple views use the same visual concept.

Browser-specific treatments are allowed when they preserve the same meaning. Record intentional differences in `docs/UI_PARITY.md`; do not let decorative web-only styling obscure status or behavior that GTK presents directly.

### Parity rules

Before adding or changing a web feature, read the corresponding implementation and header in the upstream [`zackb/tether` GTK source](https://github.com/zackb/tether/tree/main/src/gtk). Account for:

- daemon commands and events;
- capability checks;
- loading, empty, unavailable, error, and reconnect states;
- refresh behavior when a view becomes visible;
- disconnect cleanup for operations awaiting a daemon reply;
- keyboard and accessibility behavior where the browser has an equivalent.

Keep domain decisions in `tetherd`. Neither GTK nor the web client should independently redefine pairing, messaging, contact, notification, call, or file-transfer behavior.

Parity means equivalent user outcomes and state handling, not pixel-identical interfaces. Browser- or desktop-specific behavior may differ, but intentional differences must be explicit in code comments or web documentation. Do not silently omit a GTK behavior from an otherwise equivalent web view.

When a Tether protocol change affects this client, update the concrete types and focused tests here.

### Protocol authority and change threshold

Treat the protocol exposed by upstream `tetherd` as authoritative. The web client adapts to that protocol; it must not assume the protocol should change merely because a browser-specific implementation would be easier with a different event shape, command, capability, or correlation token.

For each parity feature:

1. Inspect GTK and the corresponding daemon command/event handling.
2. Exercise the existing protocol before proposing an upstream change.
3. Implement browser-local presentation, serialization, pending state, timeouts, and reconnect cleanup where those are sufficient.
4. Use the Go gateway as a transparent transport. Do not translate existing commands into a web-specific domain protocol.
5. If parity is genuinely impossible through the exposed protocol, document the exact missing capability and why client-side adaptation is unsafe or insufficient. Obtain explicit owner agreement before changing upstream Tether.

Any necessary upstream change must be the smallest backward-compatible protocol addition, live in a separate Tether branch and pull request, preserve GTK behavior, and avoid unrelated daemon or GTK refactoring. Do not modify GTK merely to make the web client easier to implement. Shared upstream bugs discovered during parity work should be verified and handled separately from the web feature unless they directly block it.

Examples of justified protocol additions are browser file staging, because a browser cannot supply a daemon-host filesystem path, and operation ownership for external numeric-comparison pairing, where accepting the wrong client's confirmation would be unsafe. Convenience-only correlation for globally observable status is not enough by itself.

## Go gateway boundaries

The Go gateway is transport infrastructure, not a third domain client. Keep it limited to:

- serving embedded assets;
- enforcing HTTP security and resource limits;
- forwarding commands to `tetherd`;
- publishing ordered daemon events and snapshots to browsers.

Preserve the `gateway.Bus` interface between HTTP handlers and the daemon client. Do not add feature-specific HTTP routes or duplicate daemon behavior in Go.

## Validation

Run the smallest relevant checks after changes:

```bash
go test -race ./...
cd ui && npm test
cd ui && npm run build
```

Run the Playwright suite when browser behavior or a user flow changes.
