# xtrape-capsule CE

Opstage CE is the Community Edition of the `xtrape-capsule` governance platform — a control plane for managing Capsule Services and their lifecycle.

## Stack

- Fastify + TypeScript backend
- React 18 + Ant Design UI
- SQLite + Prisma persistence
- Node.js Agent SDK (embedded, connects services to Opstage)

## Workspace

```text
apps/opstage-backend
apps/opstage-ui
packages/contracts
packages/db
packages/agent-node
packages/shared
packages/test-utils
```

## Setup checks

```bash
pnpm install
pnpm contracts:check
pnpm db:validate
pnpm typecheck
pnpm build
```

## Admin UI

The CE console provides:

- Session login/logout with CSRF-aware API client
- Dashboard summary and recent audit events
- Registration token creation and revocation
- Agent and Capsule Service inventory with detail drawers
- Service config, health, and manifest review
- Action execution with schema-driven payload form and JSON override
- Command list, detail, and cancellation
- Paginated Audit Events with filter controls
- User management (owner/operator/viewer roles)
- Agent lifecycle operations (enable/disable/revoke)
- Maintenance settings with dynamic scheduler reload
- Metrics, diagnostics, audit CSV/JSON export, and SQLite backup download
- UI language switcher (`zh-CN` / `en-US`; stored in `localStorage` under `opstage.language`)

## Capsule Service Action API

Service report 中的 `actions` 只作为 **Action Catalog**：用于展示按钮列表和稳定说明，不承载动态表单。打开 Action 面板时，UI 通过 `GET` 创建 `ACTION_PREPARE` command，并使用 Agent 返回的动态 `inputSchema` / `initialPayload` / 当前状态渲染表单。

Action 面板和 Action 执行使用同一个资源 URL，通过 HTTP method 区分语义：

```text
GET  /api/admin/capsule-services/:serviceId/actions/:actionName
POST /api/admin/capsule-services/:serviceId/actions/:actionName
```

| Method | 语义 | 是否创建 Command | 用途 |
|---|---|---:|---|
| `GET` | 准备/打开 Action 面板 | 是：`ACTION_PREPARE` | 创建准备阶段 Command，由 Agent prepare handler 返回动态 action metadata、`inputSchema`、`initialPayload`、当前状态 |
| `POST` | 执行 Action | 是：`ACTION_EXECUTE` | 根据 payload 创建执行 command，等待 Agent 拉取并执行 |

`GET` 示例响应：

```json
{
  "action": {
    "name": "addAccount",
    "label": "Add Account",
    "requiresConfirmation": true,
    "inputSchema": {
      "type": "object",
      "required": ["email"],
      "properties": {
        "email": { "type": "string", "default": "user@example.com" }
      }
    }
  },
  "initialPayload": {
    "email": "user@example.com"
  },
  "currentState": {
    "service": { "code": "capi-chatgpt", "status": "HEALTHY" },
    "configs": []
  },
  "prepareCommand": {
    "id": "cmd_prepare_001",
    "type": "ACTION_PREPARE",
    "status": "SUCCEEDED"
  }
}
```

`POST` 示例请求：

```json
{
  "payload": {
    "email": "user@example.com",
    "enabled": true
  },
  "confirmation": true
}
```

UI 打开 action modal 时调用 `GET`，后端创建 `ACTION_PREPARE` command 并等待 Agent prepare handler 返回动态表单和初始 JSON；用户点击 Run / Confirm run 时调用 `POST` 创建 `ACTION_EXECUTE` command，并在当前弹窗中轮询展示 command 结果。

### Local development

Run Backend and UI separately:

```bash
pnpm dev:backend
pnpm dev:ui
```

Open `http://localhost:5173/` (Vite prints the next available port if 5173 is taken).  
Vite proxies `/api` to `http://localhost:8080`.

Default bootstrap credentials for a fresh local database:

```text
Username: admin@example.local
Password: ChangeMeBeforeRunning123!
```

These come from `.env.example` (`OPSTAGE_ADMIN_USERNAME` / `OPSTAGE_ADMIN_PASSWORD`) and are used only when the first admin user is bootstrapped into an empty database. Changing the env vars later does not reset an existing account. For production, change the password and `OPSTAGE_SESSION_SECRET` before first start.

## Production / Docker deployment

The backend can serve the built React console directly and run as a single container.

```bash
cp .env.example .env
# edit admin credentials and OPSTAGE_SESSION_SECRET
docker compose -f deploy/compose/docker-compose.yml up --build -d
```

Open `http://localhost:8080`. See `deploy/README.md` for operational notes, health checks, and backup guidance.
