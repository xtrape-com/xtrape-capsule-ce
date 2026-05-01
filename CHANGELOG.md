# Changelog

All notable changes to Opstage CE are documented in this file.

This project follows semantic versioning for public release artifacts.

## [0.1.0] - 2026-05-01

### Added

- Fastify Backend with session authentication, CSRF protection, audit logging, and static UI hosting.
- React/Ant Design governance console for Dashboard, Users, Agents, Capsule Services, Commands, Audit Events, and Settings.
- SQLite-backed runtime persistence with Prisma schema retained as the relational contract.
- Agent registration flow with one-time registration tokens and hashed Agent tokens.
- Capsule Service reporting, config/action/health inventory, and secret redaction.
- Command/action execution loop with confirmation gates, polling, result reporting, cancellation, and expiration.
- Node Embedded Agent SDK and Demo Capsule Service.
- RBAC model: owner/operator/viewer.
- Agent disable/revoke lifecycle controls.
- Maintenance tasks for token expiration, command expiration, stale Agent detection, service offline marking, and audit retention.
- Metrics, runtime diagnostics, audit export, and SQLite backup APIs.
- Dockerfile, Docker Compose deployment, healthcheck, and deployment runbook.
- Unit/integration/smoke tests for Backend, UI components, contracts, Agent SDK, demo flow, and Docker Compose config.

### Security

- Password hashing with bcryptjs.
- HTTP-only signed session cookie.
- CSRF token requirement for admin mutations.
- Agent tokens are stored hash-only and revoked on Agent revoke.
- Sensitive service config values are not persisted or returned.

### Known limitations

- CE v0.1 is single-workspace-first.
- Runtime DB layer currently uses `better-sqlite3`; Prisma schema is validated as contract but Prisma Client is not yet the runtime adapter.
- UI bundle is not yet code-split.
