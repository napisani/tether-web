---
name: identify-unimplemented-core-features
description: Review upstream zackb/tether changes for web UI and MCP parity, maintain future-features.md, and guide explicitly requested implementation. Use for upstream release or commit audits, missing features, new or changed MCP tools driven by Tether changes, backlog updates, or implementing an upstream parity item.
compatibility: Requires internet/GitHub access to zackb/tether and write access to the tether-web repository.
---

# Identify unimplemented core features

Maintain an evidence-backed checklist of upstream Tether capabilities that tether-web's web UI or MCP tools do not yet implement. Assess both clients against the daemon protocol and GTK behavior. An upstream change can require a new MCP tool or an adjustment to an existing tool even when the web UI already supports it.

## Operating contract

- Work from the repository root, read `AGENTS.md`, and update `future-features.md` there.
- Default to an audit. Implement only when the user explicitly requests implementation, and only within that requested scope.
- Review changes in `zackb/tether` since the last successful review checkpoint recorded in `future-features.md`.
- Preserve existing backlog items and unrelated notes. Reconcile duplicates instead of creating near-identical entries.
- Cite immutable upstream evidence (commit SHA, merged PR, release tag, or a pinned file URL), not only a mutable `main` URL.
- Inspect local implementation before calling a feature unimplemented. A protocol or GTK change is not automatically missing from the web client.
- Keep audit runs limited to backlog updates. For explicitly requested implementation, use the implementation workflow below. Upstream changes still require separate owner approval under `AGENTS.md`.
- If the upstream review is incomplete or a source is unavailable, do not advance the checkpoint; record the blocker in the final response.

## Review workflow

### 1. Establish the checkpoint

Read `future-features.md` if it exists. Look for a managed metadata block like:

```markdown
<!-- tether-upstream-review
repository: https://github.com/zackb/tether
head: <40-character SHA>
reviewed_at: YYYY-MM-DD
clients: web-ui,mcp
-->
```

If there is no checkpoint, perform an initial baseline review of the latest upstream release and the commits/merged PRs since that release (or, if no release can be resolved, the most recent 30 days). Explain the chosen baseline in the file and response. Never pretend that a first run covered all historical Tether work.

Resolve the upstream default branch and current head dynamically. Use GitHub compare/history/release/PR views or equivalent approved tooling. Keep the new head SHA only after the review succeeds.

A checkpoint without `clients: web-ui,mcp` is a legacy UI-only review, not evidence of MCP coverage. On the first MCP-aware run, also review the existing backlog and the prior review log's classified capabilities against MCP. Record that bounded MCP baseline separately from new upstream changes. It does not imply coverage of all historical features. Add the client coverage field only when both clients have been assessed for the reviewed range and this baseline is complete.

### 2. Collect candidate changes

Inspect, in this order:

1. Releases and merged PRs in the review range, using release notes as an index rather than as sole evidence.
2. Commit subjects, changed paths, and diffs in the range.
3. The implementation and tests behind each candidate.
4. The current tether-web protocol, daemon transport, views, app lifecycle, MCP tools, and focused tests.

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
- `internal/mcpserver/tools/`, including registration, private wire types, domain handlers, operation tracking, and focused tests;
- `internal/mcpserver/server.go`, its HTTP/SDK tests, and gateway authentication tests when transport or authentication is relevant;
- `README.md`, `docs/UI_PARITY.md`, `docs/ARCHITECTURE.md`, `docs/MCP_SETUP.md`, and `docs/MCP_DESIGN.md`.

Use the GTK/web correspondences from `AGENTS.md`. Check more than type declarations: commands and events must reach the right view or tool handler, capability and reconnect behavior must be handled, pending operations must clean up, and users or agents must receive the relevant states. Planned tools in a design document do not count as registered, implemented tools.

Assign a status independently to the web UI and MCP:

- **Missing**: no meaningful support exists in that client.
- **Partial**: some implementation exists but a user outcome, state, capability, or lifecycle case is absent.
- **Implemented**: local code and tests demonstrate the equivalent outcome in that client.
- **Blocked upstream**: parity needs an unavailable protocol capability; name the exact gap.
- **Not applicable**: a browser-only interaction or a documented scope exclusion does not require an MCP equivalent. Cite the reason rather than treating presentation differences as missing tools.

A feature implemented in the UI can still belong in the backlog because MCP is missing or partial. Add no work for a client that is implemented or not applicable.

### MCP tool impact

For every candidate, identify `new tool`, `existing tool change`, or `no tool change`, with evidence. Match user outcomes, not one tool per daemon command. Browser layout, focus, navigation, and local preferences do not by themselves require tools.

For new or existing tools, check:

- tool registration, name, description, annotations, typed input/output schemas, argument constraints, and compatibility with existing callers;
- command encoding and event decoding, including added fields, enum values, capabilities, and changed defaults;
- current-state reads, unavailable/empty/error results, capability refresh, and current-generation data after reconnect;
- operation ownership/correlation, pending records, expiry, cancellation, duplicate protection, and disconnect cleanup;
- whether the result proves command acceptance, correlated completion, observed state, or an unknown outcome; weakly correlated global events must not become false success or automatic retries;
- explicit agent-client confirmation for destructive retention, plaintext storage, and device trust changes, plus human verification of physical Bluetooth codes;
- bounds and privacy for returned content, uploads, retained state, and errors. Agent uploads must not expose server filesystem selection.

Keep MCP on the same owner authority and the currently implemented HTTP Basic authentication. OAuth or another credential scheme is separate work requiring owner agreement. Inspect the current setup guide for authentication conditions rather than assuming loopback access is authenticated.

If the upstream change is ambiguous, triangulate implementation, tests, docs, and release/PR evidence. A release-note label alone is insufficient. Finish classification only when each candidate has a status for both clients and an explicit MCP tool impact.

### 4. Reconcile `future-features.md`

Create the file if it does not exist. Keep the managed checkpoint near the top, followed by a short legend and a checklist. Preserve unrelated content outside the managed sections. For each capability missing, partial, or blocked in either client, add or update one checkbox item using this shape:

```markdown
- [ ] **<Feature name>**
  - Web UI status: <missing|partial|implemented|blocked upstream|not applicable>
  - MCP status: <missing|partial|implemented|blocked upstream|not applicable>
  - Upstream evidence: [<commit/PR/release>](<immutable URL>)
  - Surface change: <what user workflow, command, event, capability, or platform changed>
  - Protocol/daemon: `<commands/events/capabilities>`; <relevant pairing, reconnect, correlation, or ownership behavior>
  - Web touchpoints: `<verified local paths>` or `None` with a reason
  - MCP impact: <new tool|existing tool change|no tool change>; <tool names, input/output or outcome changes, and verified local paths>
  - Parity states: <UI loading/empty/unavailable/error/reconnect/accessibility cases and MCP capability/confirmation/pending/unknown/expiry cases>
  - Web acceptance: <observable UI outcome, existing implementation evidence, or not-applicable reason>
  - MCP acceptance: <observable agent outcome, schema/result/lifecycle assertions, existing implementation evidence, or not-applicable reason>
  - Dependencies/blockers: <upstream or browser limitation, or `None`>
```

Keep evidence and implementation notes concrete. Name symbols or paths when known; do not guess a local file merely to fill the template. Group related work only when it shares one user outcome, with separate client acceptance criteria. Mark it `[x]` only when both clients are implemented or not applicable, with local code/test references or a documented exclusion. A UI-only implementation leaves the item open if MCP work remains. Treat old single-status items as UI assessments until MCP has been inspected. Reopen legacy completed items if MCP work remains, preserving the UI completion reference. If upstream superseded or invalidated an item, retain it with a short `Status: stale/superseded, <evidence>` note rather than silently deleting it.

Add a review log entry after the checklist, for example:

```markdown
## Upstream review log

- 2025-01-31: reviewed `<old SHA>.. <new SHA>`; found 2 new parity items and reconciled 1 existing item.
```

Use the actual date, SHAs, and counts. Advance the metadata checkpoint and log only after all candidate changes were classified for both clients and the file was written successfully. Record any initial MCP baseline scope and counts separately from post-checkpoint discoveries.

### 5. Report the result

Summarize:

1. upstream range reviewed (old/new SHA, releases or PRs inspected);
2. new, changed, completed, and intentionally ignored items, with separate UI and MCP statuses;
3. proposed new tools and existing tool/schema/outcome changes, or an evidence-backed finding that no tool changes are needed;
4. blockers or uncertainty, with links;
5. validation performed, distinguishing code/tests inspected from tests actually run.

Do not claim that no features were added unless the range and relevant surfaces were actually inspected. If there were no new missing features, say that explicitly and still record the checkpoint.

## Explicitly requested implementation

For a user-approved item, use its evidence and separate client acceptance criteria to bound the work. If only one client is requested, implement that client and retain the other client's backlog status.

1. Read the upstream daemon handler and the corresponding GTK implementation/header. Exercise the existing protocol with focused fixtures or a fake daemon before declaring it insufficient. Live phone actions require explicit approval of recipients, devices, and data.
2. Inspect both clients and decide the MCP tool impact even when the requested implementation is UI-only. Preserve the current protocol and existing tool names/contracts where compatible; document unavoidable caller-visible changes.
3. Put React behavior in the corresponding view and update its concrete protocol types/schemas. Put MCP definitions, typed handlers, command/event interpretation, and completion rules in `internal/mcpserver/tools/`. Keep HTTP/session concerns in `internal/mcpserver/server.go`, shared agent operation/confirmation handling in the tools package, and gateway transport behind `gateway.Bus`. Follow `AGENTS.md` rather than moving domain behavior into gateway or adding feature-specific HTTP routes.
4. Verify the affected client. For MCP, use focused Go tests with a fake bus plus authenticated SDK/HTTP tests for registration, schemas, validation, outcomes, and lifecycle cases. Run `go test -race ./...` for Go changes. For UI changes, run `cd ui && npm test` and `cd ui && npm run build`; run Playwright when browser behavior or a user flow changes.
5. Update `docs/MCP_SETUP.md` when available tools or their usage change, `docs/UI_PARITY.md` when UI parity changes, and relevant architecture/design notes when implementation intentionally differs. Reconcile the backlog with actual test evidence. Implementation alone does not advance the upstream review checkpoint.

Stop and record an exact blocker when the exposed protocol or client interaction cannot safely meet acceptance. Request owner agreement before an upstream protocol addition, authentication change, or scope expansion.

## Quality bar

A useful item lets another engineer implement it without repeating the upstream archaeology. It names the upstream behavior, distinguishes new changes from pre-existing gaps, points to verified UI and MCP code, identifies protocol/capability/lifecycle implications, and defines an observable outcome for each affected client. Favor a smaller list of well-supported items over speculative coverage.
