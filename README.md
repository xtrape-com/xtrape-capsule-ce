# xtrape-capsule CE

> **A lightweight, self-hosted operational control plane for Capsule Services.**
>
> xtrape-capsule CE 是一个轻量、可私有化部署的 Capsule Service 运行态治理平台。

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![Status: Public Preview](https://img.shields.io/badge/status-v0.1%20Public%20Preview-orange.svg)](https://xtrape-com.github.io/xtrape-capsule-site/roadmap)
[![Docs](https://img.shields.io/badge/docs-xtrape--capsule--site-blue.svg)](https://xtrape-com.github.io/xtrape-capsule-site/)

Opstage CE is the Community Edition of [Xtrape Capsule](https://xtrape-com.github.io/xtrape-capsule-site/). It gives you one place to see, govern, and operate the small services that power AI products — integration adapters, Playwright workers, account pools, AI Agent runtimes — through an embedded Agent SDK.

> **Status: v0.1 Public Preview.** Recommended for local evaluation, small private deployments, and demos. Not recommended for business-critical HA production yet.

## Why Capsule?

AI products quietly accumulate dozens of small services. They are too small for a service mesh, too important to leave unmanaged, and they don't deserve a custom admin panel each. Opstage gives them a single, opinionated control plane:

- **Inventory** — every Agent and every Capsule Service in one list, with `effectiveStatus`.
- **Health** — coarse, operator-facing (`HEALTHY` / `UNHEALTHY` / `STALE` / `OFFLINE`).
- **Configs** — observed from each service; never pushed.
- **Actions** — operator-callable, schema-driven, audited.
- **Commands** — the dispatch lifecycle (`PENDING → RUNNING → SUCCEEDED / FAILED / CANCELLED / EXPIRED`).
- **Audit** — every meaningful event, exportable as CSV / JSON.

## Features

- Single-container deployment (Fastify + SQLite + React console)
- Hash-only token storage (registration tokens + agent tokens)
- RBAC: `owner` / `operator` / `viewer`
- Agent disable / revoke; registration-token revoke
- Maintenance scheduler (offline detection, expiry, audit pruning)
- Metrics, diagnostics, audit export, owner-only SQLite backup
- Schema-driven action panels with `ACTION_PREPARE` → `ACTION_EXECUTE`
- UI in English and 中文 (selected language stored in `localStorage`)

## Architecture

```text
+---------------------+
|     Opstage UI      |   ← human operator
+----------+----------+
           |
           v
+---------------------+
|  Opstage Backend    |   ← control plane (Fastify + SQLite + Prisma)
+----------+----------+
           ^
           |  outbound only
           |
+----------+----------+
|  Embedded Agent     |   ← @xtrape/capsule-agent-node
+----------+----------+
           |
           v
+---------------------+
|  Capsule Service    |   ← your service
+---------------------+
```

The Backend never opens a socket to your services. All connections are initiated outbound by the Agent — this is what makes Opstage runnable behind NAT, on a laptop, or inside customer environments.

## Quick Start

> Public Docker images are planned for the v0.1.0 release. Until then, build locally with the Compose path below.

```bash
git clone https://github.com/xtrape-com/xtrape-capsule-ce.git
cd xtrape-capsule-ce
cp .env.example .env
# edit OPSTAGE_ADMIN_PASSWORD and OPSTAGE_SESSION_SECRET in .env
docker compose -f deploy/compose/docker-compose.yml up --build -d
```

Open `http://localhost:8080`. Default bootstrap credentials come from `.env.example`:

```text
Username: admin@example.local
Password: ChangeMeBeforeRunning123!
```

→ Full guide: [Quick Start](https://xtrape-com.github.io/xtrape-capsule-site/getting-started/quick-start)

## Connect your first Capsule Service

Use the Node embedded Agent SDK ([`@xtrape/capsule-agent-node`](https://github.com/xtrape-com/xtrape-capsule-agent-node)):

```ts
import { CapsuleAgent } from "@xtrape/capsule-agent-node";

const agent = new CapsuleAgent({
  backendUrl: process.env.OPSTAGE_BACKEND_URL!,
  registrationToken: process.env.OPSTAGE_REGISTRATION_TOKEN,
  tokenStore: { file: "./data/agent-token.txt" },
  service: {
    code: "my-capsule",
    name: "My Capsule Service",
    version: "0.1.0",
    runtime: "nodejs",
  },
});

await agent.start();
```

→ Full guide: [Build your first Capsule Service](https://xtrape-com.github.io/xtrape-capsule-site/getting-started/first-capsule-service)

## Documentation

The complete public docs live at **<https://xtrape-com.github.io/xtrape-capsule-site/>**.

Highlights:

- [Quick Start](https://xtrape-com.github.io/xtrape-capsule-site/getting-started/quick-start)
- [First Capsule Service](https://xtrape-com.github.io/xtrape-capsule-site/getting-started/first-capsule-service)
- [Concepts](https://xtrape-com.github.io/xtrape-capsule-site/concepts/capsule-service) — Capsule Service / Opstage / Agent / Registration / Management Contract
- [Opstage CE](https://xtrape-com.github.io/xtrape-capsule-site/opstage-ce/overview) — overview, Docker, configuration, admin UI, backup & upgrade
- [Agents](https://xtrape-com.github.io/xtrape-capsule-site/agents/node-embedded-agent) — Node embedded SDK, action model, health & config reporting
- [Security](https://xtrape-com.github.io/xtrape-capsule-site/security/overview) — token model, agent security, safe-deployment checklist
- [Roadmap](https://xtrape-com.github.io/xtrape-capsule-site/roadmap), [FAQ](https://xtrape-com.github.io/xtrape-capsule-site/faq), [Glossary](https://xtrape-com.github.io/xtrape-capsule-site/glossary)

## Editions

| Edition | Status | Highlight |
| --- | --- | --- |
| **CE** | Current · v0.1 Public Preview | Single-node, SQLite, self-hosted (this repo) |
| **EE** | Future · Planned | RBAC++, SSO, HA, Secret Vault |
| **Cloud** | Future · Planned | Hosted Opstage; Agents connect outbound |

→ [Editions comparison](https://xtrape-com.github.io/xtrape-capsule-site/editions/ce)

## Roadmap

`v0.1` Public Preview · Current. See the [full roadmap](https://xtrape-com.github.io/xtrape-capsule-site/roadmap) for v0.2 Basic Ops, v0.3 Capsule Spec freeze, v0.4 Agent expansion (Python / standalone), and v1.0 CE Stable.

## Development

This is a pnpm workspace.

```text
apps/opstage-backend       # Fastify + Prisma backend
apps/opstage-ui            # React 18 + Ant Design admin console
packages/contracts         # workspace mirror of @xtrape/capsule-contracts-node
packages/db                # Prisma schema and migrations
packages/agent-node        # workspace mirror of @xtrape/capsule-agent-node
packages/shared            # cross-cutting helpers
packages/test-utils        # in-process backend bootstrapping for tests
```

```bash
pnpm install
pnpm contracts:check
pnpm db:validate
pnpm typecheck
pnpm build
```

For local development with hot reload:

```bash
pnpm dev:backend          # http://localhost:8080
pnpm dev:ui               # http://localhost:5173 (Vite proxies /api to :8080)
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full developer flow, and [SECURITY.md](./SECURITY.md) for how to report vulnerabilities responsibly.

## Related repositories

| Repo | Purpose |
| --- | --- |
| [xtrape-capsule-site](https://github.com/xtrape-com/xtrape-capsule-site) | Public website + documentation |
| [xtrape-capsule-agent-node](https://github.com/xtrape-com/xtrape-capsule-agent-node) | Node embedded Agent SDK |
| [xtrape-capsule-contracts-node](https://github.com/xtrape-com/xtrape-capsule-contracts-node) | Shared contracts and Zod schemas |

## License

[Apache-2.0](./LICENSE). **"Xtrape", "Xtrape Capsule", and "Opstage"** are trademarks of their respective owners; the open-source license does not grant trademark rights.
