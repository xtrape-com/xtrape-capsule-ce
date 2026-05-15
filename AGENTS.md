# AGENTS.md

## Repository Role

This repository owns Xtrape Capsule CE, including Opstage CE.

Opstage CE is the control plane for Xtrape Capsule.

Primary responsibilities:

- Opstage backend
- Opstage admin UI
- SQLite persistence
- registration tokens
- agent management
- Capsule Service management
- action/config/health management
- command dispatch
- command result handling
- audit events
- system health/version endpoints
- CE Docker packaging

## Non-goals

This repository is not:

- the Node Embedded Agent SDK
- the OpHub Go runtime
- the demo service
- the public documentation site
- an Enterprise Edition implementation
- a marketplace backend unless explicitly scoped in a future issue

Do not add:

- demo-only logic
- agent-node runtime implementation
- OpHub Go code
- Java/Python SDK code
- public marketing docs that belong in `xtrape-capsule-site`

## Architecture Boundaries

CE may depend on:

```text
@xtrape/capsule-contracts-node
```

CE should generally not depend on:

```text
@xtrape/capsule-agent-node
xtrape-capsule-demo
xtrape-capsule-ophub-go
```

Reason:

- CE defines and serves the control-plane API.
- Agent SDK and OpHub are clients/runtimes that talk to CE.
- Demo validates CE behavior but should not be a CE dependency.

## Important Runtime Concepts

### Stored Status vs Effective Status

For Capsule Services:

```text
storedStatus = last persisted service status from service report
status       = operator-facing effective status computed at query time
```

Expected semantics:

```text
STALE   = agent row is still ONLINE/PENDING but heartbeat freshness expired
OFFLINE = agent missing, disabled, revoked, or already OFFLINE
```

### Command Failure Surface

When an agent reports a failed command result, CE should surface actionable fields directly on the command row:

```text
errorCode
errorMessage
durationMs
```

### System Version

Local/dev fallback must not claim a final release version.

Use a dev suffix such as:

```text
0.2.0-dev
0.3.0-dev
```

## Version / Release Train Rules

Xtrape Capsule uses matching minor versions across public packages.

During development:
- Before starting implementation, run `git fetch --all --prune` and check whether the current branch is behind its upstream. Pull or rebase the latest upstream code before editing, unless local uncommitted work must first be stashed or committed.
- Do not assume unpublished npm versions exist.
- Do not set dependencies to versions such as `^0.3.0` before that version is published.
- Use GitHub branch dependencies, local workspace linking, or npm prerelease packages when needed.
- Release candidates should use `0.3.0-rc.x` with the `next` npm dist-tag.
- Final releases should use semver versions with the `latest` npm dist-tag.

Recommended release order:

```text
1. contracts-node
2. agent-node
3. CE
4. OpHub
5. demo
6. site
```


## Dependency Policy

Keep CE dependencies appropriate for a small private-deployment control plane.

Allowed:

- backend framework dependencies already used by CE
- SQLite-related dependencies
- UI dependencies already used by the admin console
- shared contract package
- small operational utilities

Avoid:

- depending on the demo repository
- depending on the Agent SDK unless explicitly justified
- introducing heavy infrastructure requirements for CE
- adding services that require multi-node operation unless scoped for EE/future versions

## Development Commands

Common commands:

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

For Docker-related changes, also verify the documented Docker build or compose flow when possible.

## Testing Expectations

Backend changes should test:

- API validation
- auth/rbac behavior
- registration token behavior
- agent authentication
- heartbeat behavior
- service report behavior
- command lifecycle
- command result handling
- audit events
- system endpoints
- metrics shape
- maintenance sweep behavior

UI changes should verify:

- list rendering
- detail drawer rendering
- action modal behavior
- error states
- empty states
- i18n impact if applicable

## Documentation Rules

When changing CE behavior, update repository-local docs where appropriate and coordinate public docs in `xtrape-capsule-site`.

Avoid promising Docker tags or npm versions that are not published.

## AI Safety Rules

When working in this repository:

- Do not add OpHub implementation here.
- Do not add demo-specific shortcuts.
- Do not change wire contracts locally without updating `contracts-node`.
- Do not expose management APIs without auth/rbac unless explicitly designed as public health/version endpoints.
- Do not expose secrets in command results, audit metadata, logs, or UI.
- Do not document `latest` Docker tags unless the workflow actually publishes them.
- Keep CE suitable for lightweight private deployment.

## PR Checklist

- [ ] The change belongs in Opstage CE.
- [ ] Contract dependency is valid for the release stage.
- [ ] Backend tests/typecheck pass.
- [ ] UI build/typecheck pass if UI changed.
- [ ] API behavior is documented.
- [ ] Security/rbac implications are considered.
- [ ] No demo/SDK/OpHub boundaries are crossed.
- [ ] Release notes impact is noted.
