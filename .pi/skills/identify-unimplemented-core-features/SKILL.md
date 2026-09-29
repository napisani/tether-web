---
name: identify-unimplemented-core-features
description: Review recent upstream changes in zackb/tether and maintain the root future-features.md backlog for tether-web. Use this whenever the user asks what upstream Tether changes are missing from the web client, wants a parity audit, asks to check recent Tether releases/commits for new core or user-facing capabilities, or says to update future-features.md—even when they do not name this skill.
compatibility: Requires internet/GitHub access to zackb/tether and write access to the tether-web repository.
---

# Identify unimplemented core features

Maintain a trustworthy, evidence-backed checklist of upstream Tether capabilities that tether-web does not yet implement. The source of truth for feature boundaries is the upstream project, especially its daemon protocol and GTK client; this skill must not invent a web-specific protocol or treat a browser convenience as an upstream feature.

## Operating contract

- Work from the repository root and update `future-features.md` there.
- Review changes in `zackb/tether` since the last successful review checkpoint recorded in `future-features.md`.
- Preserve existing backlog items and unrelated notes. Reconcile duplicates instead of creating near-identical entries.
- Cite immutable upstream evidence (commit SHA, merged PR, release tag, or a pinned file URL), not only a mutable `main` URL.
- Inspect local implementation before calling a feature unimplemented. A protocol or GTK change is not automatically missing from the web client.
- Do not modify upstream Tether, add feature-specific gateway routes, or implement the feature while performing this audit.
- If the upstream review is incomplete or a source is unavailable, do not advance the checkpoint; record the blocker in the final response.

## Review workflow

### 1. Establish the checkpoint

Read `future-features.md` if it exists. Look for a managed metadata block like:

```markdown
<!-- tether-upstream-review
repository: https://github.com/zackb/tether
head: <40-character SHA>
reviewed_at: YYYY-MM-DD
--> 
```

If there is no checkpoint, perform an initial baseline review of the latest upstream release and the commits/merged PRs since that release (or, if no release can be resolved, the most recent 30 days). Explain the chosen baseline in the file and response. Never pretend that a first run covered all historical Tether work.

Resolve the upstream default branch and current head dynamically. Use GitHub compare/history/release/PR views or equivalent GitHub API tooling. Keep the new head SHA only after the review succeeds.

### 2. Collect candidate changes

Inspect, in this order:

1. Releases and merged PRs in the review range, using release notes as an index rather than as sole evidence.
2. Commit subjects, changed paths, and diffs in the range.
3. The implementation and tests behind each candidate.
4. The current tether-web protocol, daemon transport, views, app lifecycle, and tests.

Prioritize upstream changes touching:

- daemon commands/events, protocol schemas, capabilities, correlation or operation ownership;
- `src/gtk` navigation, views, actions, dialogs, settings, device state, or lifecycle cleanup;
- `src/daemon` transport/pairing/session behavior that changes user outcomes;
- `apple/` views, view models, share-sheet actions, permissions, Bluetooth, or entitlements;
- CLI, extension/native-messaging behavior, or documented user workflows;
- packaging/build changes that add a supported executable, deployment mode, or integration;
- user-visible strings, docs, and tests that corroborate a new workflow.

Treat a change as a feature-surface candidate when it adds or materially expands a user workflow, command, event, capability, supported platform/deployment mode, device integration, or lifecycle state. Include fixes when they expose a newly usable workflow or change parity requirements (for example, reconnect, pairing, or operation-correlation behavior). Usually exclude refactors, test-only changes, documentation corrections, dependency bumps, and internal reliability fixes with no changed user outcome.

### 3. Verify against tether-web

Read the relevant local code before deciding status. Start with:

- `ui/src/protocol.ts` and `ui/src/protocolSchemas.ts`;
- `ui/src/daemon/DaemonClient.ts` and `ui/src/app/daemonLifecycle.ts`;
- the corresponding `ui/src/views/<feature>/` files and focused tests;
- `README.md`, `docs/UI_PARITY.md`, and `docs/ARCHITECTURE.md`.

Use the GTK/web correspondences from `AGENTS.md`. Check more than type declarations: commands and events must be wired into the right reducer/view, capability and reconnect behavior must be handled, pending operations must clean up, and user-visible states must be represented. Distinguish these statuses:

- **Missing**: no meaningful web support exists.
- **Partial**: some protocol/UI path exists but a user outcome, state, capability, or lifecycle case is absent.
- **Implemented**: the web client already provides the equivalent user outcome; do not add it to the backlog.
- **Blocked upstream**: parity requires a protocol capability that does not exist; document the exact gap rather than proposing an invented route.

If the upstream change is ambiguous, triangulate implementation, tests, docs, and release/PR evidence. A release-note label alone is insufficient.

### 4. Reconcile `future-features.md`

Create the file if it does not exist. Keep the managed checkpoint near the top, followed by a short legend and a checklist. Preserve unrelated content outside the managed sections. For each missing or partial capability, add or update one checkbox item using this shape:

```markdown
- [ ] **<Feature name>** *(missing|partial|blocked upstream)*
  - Upstream evidence: [<commit/PR/release>](<immutable URL>)
  - Surface change: <what user workflow, command, event, capability, or platform changed>
  - Protocol/daemon: `<commands/events/capabilities>`; <relevant pairing, reconnect, correlation, or ownership behavior>
  - Web touchpoints: `<likely local paths>`
  - Parity states: <loading/empty/unavailable/error/reconnect/accessibility cases to cover>
  - Acceptance: <observable outcome that proves parity>
  - Dependencies/blockers: <upstream or browser limitation, or `None`>
```

Keep evidence and implementation notes concrete. Name symbols or paths when known; do not guess a local file merely to fill the template. Group related work only when it shares one user outcome and can be accepted as one unit. If a prior item now appears implemented, mark it `[x]` only when local code and tests support that conclusion, and add a brief implementation reference. If upstream superseded or invalidated an item, retain it with a short `Status: stale/superseded — <evidence>` note rather than silently deleting it.

Add a review log entry after the checklist, for example:

```markdown
## Upstream review log

- 2025-01-31: reviewed `<old SHA>.. <new SHA>`; found 2 new parity items and reconciled 1 existing item.
```

Use the actual date, SHAs, and counts. Advance the metadata checkpoint and log only after all candidate changes were classified and the file was written successfully.

### 5. Report the result

Summarize:

1. upstream range reviewed (old/new SHA, releases or PRs inspected);
2. new, changed, completed, and intentionally ignored items;
3. blockers or uncertainty, with links;
4. validation performed (local paths/tests inspected).

Do not claim that no features were added unless the range and relevant surfaces were actually inspected. If there were no new missing features, say that explicitly and still record the checkpoint.

## Quality bar

A useful item lets another engineer implement it without repeating the upstream archaeology. It names the upstream behavior, proves why it is new, points to likely web seams, calls out protocol/capability/lifecycle implications, and defines an observable acceptance outcome. Favor a smaller list of well-supported items over speculative coverage.
