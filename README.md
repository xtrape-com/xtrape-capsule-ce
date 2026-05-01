# xtrape-capsule CE

Opstage CE is the first implementation target for the `xtrape-capsule` governance loop.

This repository follows the CE v0.1 plan from `xtrape-capsule-docs`:

- Fastify Backend
- React UI
- SQLite + Prisma persistence
- Node Embedded Agent SDK
- Demo Capsule Service

## Workspace

```text
apps/opstage-backend
apps/opstage-ui
apps/demo-capsule-service
packages/contracts
packages/db
packages/agent-node
packages/shared
packages/test-utils
```

## Phase 0 checks

```bash
pnpm install
pnpm contracts:check
pnpm db:validate
pnpm typecheck
pnpm build
```

## Admin UI

The CE console now includes the first governance UI slice:

- session login/logout with CSRF-aware API client
- dashboard summary and recent audit events
- registration token creation/revocation with one-time token display
- agent and Capsule Service inventory drawers
- service config/health/manifest review
- action execution modal that creates Commands
- command list/detail inspection
- command auto-refresh and admin cancellation for pending/running commands
- dedicated paginated Audit Events API/page
- Agents, Services, Commands, and Audit Events filter controls
- schema-driven Action payload form with JSON override

For local development, run Backend and UI separately:

```bash
pnpm dev:backend
pnpm dev:ui
```

Vite proxies `/api` to `http://localhost:8080`.

## Phase 7 notes

Backend/UI now expose richer governance operations: dashboard command counts and recent commands, `/api/admin/audit-events` pagination/filtering, and `/api/admin/commands/:commandId/cancel` for terminal-safe cancellation.

## Phase 8 notes

The console now has first-pass operator ergonomics: server-backed filters for Agents, Services, Commands, and Audit Events; richer Command detail drawers; and schema-driven action forms generated from reported `inputSchema` definitions while keeping a JSON override path for advanced payloads.


## Demo smoke test

The smoke test starts an in-process Backend, creates a registration token, starts the demo Agent SDK flow, triggers `echo` and `runHealthCheck`, and verifies CommandResults.

```bash
pnpm smoke:demo
```

## Production / Docker deployment

The backend can serve the built React console directly and run as a single container.

```bash
cp .env.example .env
# edit admin credentials and OPSTAGE_SESSION_SECRET
docker compose -f deploy/compose/docker-compose.yml up --build -d
```

Open `http://localhost:8080`. See `deploy/README.md` for operational notes, health checks, and backup guidance.

## Manual demo service

```bash
pnpm dev:backend
# create a registration token through API/UI, then:
OPSTAGE_BACKEND_URL=http://localhost:8080 \
OPSTAGE_REGISTRATION_TOKEN=opstage_reg_... \
CAPSULE_AGENT_TOKEN_FILE=./data/demo-agent-token.json \
pnpm --filter @xtrape/demo-capsule-service start
```

## Phase 9 notes

Production packaging now includes Backend-hosted static UI, a multi-stage Dockerfile, Compose deployment, container healthcheck script, `.dockerignore`, and deployment runbook.

## Phase 10 notes

Security model now includes owner/operator/viewer roles, owner-only user management, operator mutation gates for registration tokens and commands, Agent disable/revoke flows that invalidate active tokens, and UI controls for Users and Agent lifecycle operations.

## Phase 11 notes

Maintenance tasks now expire active registration tokens after `expiresAt`, expire pending/running commands after `expiresAt`, mark stale online Agents and their services offline, prune old audit events according to `OPSTAGE_AUDIT_RETENTION_DAYS`, run on a configurable interval, and can be triggered manually from Settings.

## Phase 12 notes

Observability and recovery now include admin metrics, runtime diagnostics, CSV/JSON audit export, owner-only SQLite backup downloads, Settings-page diagnostics, and Docker backup directory configuration.

## Phase 13 notes

Code quality pass extracted reusable Backend RBAC and static UI serving modules, extracted shared UI display components, and fixed duplicate public registration token fields while keeping behavior covered by the existing test suite.

## Phase 14 notes

Testing coverage now includes Backend RBAC unit tests, static UI resolver tests, UI shared component render tests, contract schema tests, and a Docker Compose config smoke script (`pnpm test:docker-smoke`).

## Phase 15 notes

Release governance is now scaffolded with `VERSION`, `CHANGELOG.md`, `LICENSE`, `NOTICE`, `RELEASE.md`, `release:check`, and `release:notes`. The release check verifies required release files, package/version alignment, changelog entry, Apache-2.0 metadata, environment placeholders, and Docker Compose config.

## Phase 16 notes

Final repository readiness now includes `ACCEPTANCE.md`, a `repo:check` script, release/acceptance verification, ignored generated artifacts, and a suggested commit message for v0.1.0.
