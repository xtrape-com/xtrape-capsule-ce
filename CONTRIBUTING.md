# Contributing to xtrape-capsule CE

Thanks for helping improve Xtrape Capsule CE. This repository contains the self-hosted Opstage CE backend, UI, deploy assets, and workspace mirrors of the Agent SDK and Contracts packages.

## Development environment

Requirements:

- Node.js 20+
- pnpm 9+
- Docker / Docker Compose for deployment checks

```bash
pnpm install
```

## Local startup

Backend:

```bash
pnpm dev:backend
```

UI:

```bash
pnpm dev:ui
```

Open the Vite UI at `http://localhost:5173`; it proxies `/api` to the backend at `http://localhost:8080`.

Docker Compose path:

```bash
cp .env.example .env
# edit OPSTAGE_ADMIN_PASSWORD and OPSTAGE_SESSION_SECRET

docker compose -f deploy/compose/docker-compose.yml up --build
```

## Required checks before PR

Run the checks that match your change. For general backend/UI changes, run all of these:

```bash
pnpm contracts:check
pnpm db:validate
pnpm --filter @xtrape/opstage-backend typecheck
pnpm --filter @xtrape/opstage-backend test
pnpm --filter @xtrape/opstage-ui typecheck
pnpm --filter @xtrape/opstage-ui test
pnpm --filter @xtrape/opstage-ui build
```

For full workspace confidence:

```bash
pnpm typecheck
pnpm build
```

## Code style

- TypeScript only for runtime code.
- Prefer small, typed helpers over ad-hoc parsing.
- Validate external input with Zod schemas before touching the data layer.
- Keep UI state explicit and URL-shareable for operator-facing filters.
- Never log or return raw tokens, secrets, passwords, cookies, OTP codes, browser session files, or API keys.

## Contracts workflow

Protocol changes must be kept in sync across:

1. Backend implementation and tests.
2. `scripts/opstage-contracts-check.mjs`.
3. `xtrape-capsule-docs/09-contracts/openapi/opstage-ce-v0.1.yaml`.
4. Operations documentation when behavior changes.
5. Agent SDK / Contracts packages when wire schemas change.

Do not change a wire contract silently.

## Agent SDK workflow

When changing Agent behavior, verify:

- registration token and agent token handling;
- service report shape;
- heartbeat behavior;
- `ACTION_PREPARE` and `ACTION_EXECUTE` command behavior;
- command result redaction and payload-size limits.

## Documentation workflow

Public-facing behavior should be reflected in the docs site and/or implementation docs:

- `xtrape-capsule-site` for user-facing guides;
- `xtrape-capsule-docs` for specifications, OpenAPI, and implementation details;
- this README for repository-level onboarding.

## Branch and PR guidance

- Keep PRs focused on one topic.
- Include a short summary and test evidence.
- Mention any contract, migration, security, or operator-facing UI impact.
- For security-sensitive fixes, do not open a public PR before following `SECURITY.md`.
