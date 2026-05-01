# Opstage CE v0.1.0 Acceptance Report

Date: 2026-05-01
Version: 0.1.0
Edition: CE

## Scope

Opstage CE v0.1.0 is a lightweight, self-hosted governance control plane for Capsule Services. This acceptance report summarizes the implemented product, architecture, verification commands, and commit-ready state.

## Implemented capabilities

### Product capabilities

- Admin login/logout with signed HTTP-only session cookies and CSRF protection.
- Dashboard with workspace status, Agent/Service/Command counts, recent commands, and recent audit events.
- User management with owner/operator/viewer RBAC.
- Registration token creation, listing, one-time raw token display, revocation, and expiration maintenance.
- Agent registration, heartbeat, service reporting, disable, and revoke flows.
- Capsule Service inventory with manifest, health, config, and action definitions.
- Command/action execution loop with confirmation gates, polling, result reporting, cancellation, and expiration.
- Audit event browsing and CSV/JSON export.
- Maintenance tasks for stale Agents, expired Commands, expired tokens, offline Services, and audit retention.
- Metrics, runtime diagnostics, and SQLite backup download.
- Node Embedded Agent SDK and Demo Capsule Service.
- Docker/Compose deployment with healthcheck and persistent SQLite volume.

### Technical architecture

- Monorepo managed by pnpm workspaces.
- Fastify Backend with modularized RBAC and static UI serving helpers.
- React + Ant Design governance console.
- SQLite runtime persistence via `better-sqlite3`.
- Prisma schema retained and validated as the relational contract.
- Zod-based contract schemas.
- Node Agent SDK for embedded Capsule Service registration/reporting/command dispatch.

## Verification matrix

Run from repository root:

```bash
pnpm contracts:check
pnpm db:validate
pnpm typecheck
pnpm test
pnpm smoke:demo
pnpm test:docker-smoke
pnpm release:check
```

Expected current results:

- Backend: 3 test files, 17 tests passed.
- UI: 1 test file, 2 tests passed.
- Contracts: 1 test file, 3 tests passed.
- Agent SDK: 1 test file, 2 tests passed.
- Demo smoke: passed.
- Docker Compose config smoke: passed.
- Release check: passed for v0.1.0.

## Release artifacts

- `VERSION`
- `CHANGELOG.md`
- `LICENSE`
- `NOTICE`
- `RELEASE.md`
- `README.md`
- `deploy/README.md`
- `.env.example`

## Deployment entrypoint

```bash
cp .env.example .env
# edit OPSTAGE_ADMIN_USERNAME, OPSTAGE_ADMIN_PASSWORD, OPSTAGE_SESSION_SECRET
docker compose -f deploy/compose/docker-compose.yml up --build -d
```

Open:

```text
http://localhost:8080
```

## Commit-ready checklist

- [x] Required release files present.
- [x] Version aligned: `VERSION` = `package.json` = `0.1.0`.
- [x] Generated `dist/` and `node_modules/` directories are ignored.
- [x] `.env` is ignored; `.env.example` uses placeholders.
- [x] Docker Compose config parses.
- [x] Tests and smoke checks pass.
- [x] Release check passes.

## Suggested commit message

```text
feat: scaffold Opstage CE v0.1.0 governance control plane

- add Fastify backend, React console, SQLite persistence, and contracts
- add Agent SDK, demo Capsule Service, command/action loop, and RBAC
- add maintenance, metrics, audit export, backup, Docker deployment, and release checks
- add unit, integration, smoke, Docker config, and release verification scripts
```
