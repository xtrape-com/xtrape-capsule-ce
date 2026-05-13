import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_WORKSPACE, openDatabase } from "@xtrape/capsule-db";

// Provide the required env *before* importing buildApp, because buildApp's
// module path eventually calls loadConfig(process.env) which validates the
// schema. The per-test `config` object below still wins via the override
// merge inside buildApp; this just keeps the schema check happy.
process.env.OPSTAGE_SESSION_SECRET =
  process.env.OPSTAGE_SESSION_SECRET ?? "test-session-secret-must-be-at-least-32-chars";

import { buildApp } from "./app.js";

const config = {
  DATABASE_URL: ":memory:",
  OPSTAGE_SESSION_SECRET: "test-session-secret-must-be-at-least-32-chars",
  OPSTAGE_ADMIN_USERNAME: "admin@example.local",
  OPSTAGE_ADMIN_PASSWORD: "ChangeMeBeforeRunning123!",
  OPSTAGE_SESSION_TTL_SECONDS: 3600,
  OPSTAGE_HOST: "127.0.0.1",
  OPSTAGE_PORT: 0
};

describe("Phase 1 backend kernel", () => {
  it("exposes safe system health", async () => {
    const app = await buildApp({ logger: false, config });
    const res = await app.inject({ method: "GET", url: "/api/system/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: true, data: { status: "UP" } });
    expect(res.body).not.toContain("SESSION_SECRET");
    await app.close();
  });


  it("serves built UI as static SPA without intercepting API 404", async () => {
    const staticDir = await mkdtemp(path.join(os.tmpdir(), "opstage-ui-"));
    await writeFile(path.join(staticDir, "index.html"), "<html><title>Opstage CE</title><body>UI</body></html>");
    await writeFile(path.join(staticDir, "asset.txt"), "asset-ok");
    const app = await buildApp({ logger: false, config: { ...config, OPSTAGE_STATIC_DIR: staticDir } });

    const root = await app.inject({ method: "GET", url: "/" });
    expect(root.statusCode).toBe(200);
    expect(root.body).toContain("Opstage CE");

    const asset = await app.inject({ method: "GET", url: "/asset.txt" });
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toBe("asset-ok");

    const spaFallback = await app.inject({ method: "GET", url: "/commands" });
    expect(spaFallback.statusCode).toBe(200);
    expect(spaFallback.body).toContain("Opstage CE");

    const apiMissing = await app.inject({ method: "GET", url: "/api/missing" });
    expect(apiMissing.statusCode).toBe(404);
    expect(apiMissing.json().error.code).toBe("NOT_FOUND");
    await app.close();
    await rm(staticDir, { recursive: true, force: true });
  });

  it("bootstraps admin and supports login/me/dashboard", async () => {
    const app = await buildApp({ logger: false, config });
    const login = await app.inject({
      method: "POST",
      url: "/api/admin/auth/login",
      payload: {
        username: config.OPSTAGE_ADMIN_USERNAME,
        password: config.OPSTAGE_ADMIN_PASSWORD
      }
    });
    expect(login.statusCode).toBe(200);
    const cookie = login.cookies.find(item => item.name === "opstage_session");
    expect(cookie?.httpOnly).toBe(true);
    const csrfToken = login.json().data.csrfToken;
    expect(csrfToken).toBeTypeOf("string");

    const me = await app.inject({
      method: "GET",
      url: "/api/admin/auth/me",
      cookies: { opstage_session: cookie!.value }
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().data.user.username).toBe(config.OPSTAGE_ADMIN_USERNAME);

    const filteredUsers = await app.inject({ method: "GET", url: "/api/admin/users?role=owner&status=ACTIVE&q=admin", cookies: { opstage_session: cookie!.value } });
    expect(filteredUsers.statusCode).toBe(200);
    expect(filteredUsers.json().pagination.total).toBe(1);
    const invalidUsers = await app.inject({ method: "GET", url: "/api/admin/users?role=root", cookies: { opstage_session: cookie!.value } });
    expect(invalidUsers.statusCode).toBe(422);
    expect(invalidUsers.json().error.code).toBe("VALIDATION_FAILED");

    const dashboard = await app.inject({
      method: "GET",
      url: "/api/admin/dashboard/summary",
      cookies: { opstage_session: cookie!.value }
    });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json().data.workspace.code).toBe("default");

    const logoutWithoutCsrf = await app.inject({
      method: "POST",
      url: "/api/admin/auth/logout",
      cookies: { opstage_session: cookie!.value }
    });
    expect(logoutWithoutCsrf.statusCode).toBe(403);

    const logout = await app.inject({
      method: "POST",
      url: "/api/admin/auth/logout",
      cookies: { opstage_session: cookie!.value },
      headers: { "x-csrf-token": csrfToken }
    });
    expect(logout.statusCode).toBe(200);
    await app.close();
  });

  it("audits failed login without leaking password", async () => {
    const app = await buildApp({ logger: false, config });
    const failed = await app.inject({
      method: "POST",
      url: "/api/admin/auth/login",
      payload: {
        username: config.OPSTAGE_ADMIN_USERNAME,
        password: "wrong-password"
      }
    });
    expect(failed.statusCode).toBe(401);

    const login = await app.inject({
      method: "POST",
      url: "/api/admin/auth/login",
      payload: {
        username: config.OPSTAGE_ADMIN_USERNAME,
        password: config.OPSTAGE_ADMIN_PASSWORD
      }
    });
    const cookie = login.cookies.find(item => item.name === "opstage_session")!;
    const dashboard = await app.inject({
      method: "GET",
      url: "/api/admin/dashboard/summary",
      cookies: { opstage_session: cookie.value }
    });
    const body = dashboard.body;
    expect(body).toContain("session.login");
    expect(body).not.toContain("wrong-password");
    await app.close();
  });
});

describe("Phase 2 agent registration and service report", () => {
  it("creates registration token, registers agent, heartbeats, and reports service", async () => {
    const app = await buildApp({ logger: false, config });
    const login = await app.inject({
      method: "POST",
      url: "/api/admin/auth/login",
      payload: {
        username: config.OPSTAGE_ADMIN_USERNAME,
        password: config.OPSTAGE_ADMIN_PASSWORD
      }
    });
    const cookie = login.cookies.find(item => item.name === "opstage_session")!;
    const csrfToken = login.json().data.csrfToken as string;

    const tokenRes = await app.inject({
      method: "POST",
      url: "/api/admin/registration-tokens",
      cookies: { opstage_session: cookie.value },
      headers: { "x-csrf-token": csrfToken },
      payload: { name: "test token", expiresInSeconds: 3600 }
    });
    expect(tokenRes.statusCode).toBe(200);
    const registrationToken = tokenRes.json().data.token as string;
    expect(registrationToken).toMatch(/^opstage_reg_/);
    expect(tokenRes.json().data.rawToken).toBe(registrationToken);

    const registerRes = await app.inject({
      method: "POST",
      url: "/api/agents/register",
      payload: {
        registrationToken,
        agent: {
          code: "demo-agent",
          name: "Demo Agent",
          mode: "embedded",
          runtime: "nodejs"
        },
        service: {
          code: "demo-capsule-service",
          name: "Demo Capsule Service",
          version: "0.1.0",
          runtime: "nodejs",
          manifest: { kind: "CapsuleService", code: "demo-capsule-service" },
          health: { status: "UP", message: "ok" },
          configs: [
            { key: "demo.message", type: "string", sensitive: false, valuePreview: "hello" },
            { key: "demo.secret", type: "string", sensitive: true, valuePreview: "must-not-leak", secretRef: "env:DEMO_SECRET" }
          ],
          actions: [{ name: "echo", label: "Echo", dangerLevel: "LOW" }]
        }
      }
    });
    expect(registerRes.statusCode).toBe(200);
    const { agentId, agentToken } = registerRes.json().data as { agentId: string; agentToken: string };
    expect(agentId).toMatch(/^agt_/);
    expect(agentToken).toMatch(/^opstage_agent_/);

    const heartbeat = await app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/heartbeat`,
      headers: { authorization: `Bearer ${agentToken}` },
      payload: {}
    });
    expect(heartbeat.statusCode).toBe(200);

    const filteredTokens = await app.inject({ method: "GET", url: "/api/admin/registration-tokens?status=USED", cookies: { opstage_session: cookie.value } });
    expect(filteredTokens.statusCode).toBe(200);
    expect(filteredTokens.json().pagination.total).toBe(1);
    const invalidTokenFilter = await app.inject({ method: "GET", url: "/api/admin/registration-tokens?status=BAD", cookies: { opstage_session: cookie.value } });
    expect(invalidTokenFilter.statusCode).toBe(422);
    expect(invalidTokenFilter.json().error.code).toBe("VALIDATION_FAILED");

    const agents = await app.inject({
      method: "GET",
      url: "/api/admin/agents",
      cookies: { opstage_session: cookie.value }
    });
    expect(agents.statusCode).toBe(200);
    expect(agents.json().data[0].code).toBe("demo-agent");
    const filteredAgents = await app.inject({
      method: "GET",
      url: "/api/admin/agents?status=ONLINE&q=demo",
      cookies: { opstage_session: cookie.value }
    });
    expect(filteredAgents.json().pagination.total).toBe(1);
    const invalidAgents = await app.inject({ method: "GET", url: "/api/admin/agents?status=BAD", cookies: { opstage_session: cookie.value } });
    expect(invalidAgents.statusCode).toBe(422);
    expect(invalidAgents.json().error.code).toBe("VALIDATION_FAILED");

    const services = await app.inject({
      method: "GET",
      url: "/api/admin/capsule-services",
      cookies: { opstage_session: cookie.value }
    });
    expect(services.statusCode).toBe(200);
    expect(services.json().data[0].code).toBe("demo-capsule-service");
    const serviceId = services.json().data[0].id as string;
    const filteredServices = await app.inject({ method: "GET", url: `/api/admin/capsule-services?healthStatus=UP&status=HEALTHY&agentId=${agentId}&q=demo`, cookies: { opstage_session: cookie.value } });
    expect(filteredServices.json().pagination.total).toBe(1);
    const invalidServices = await app.inject({ method: "GET", url: "/api/admin/capsule-services?healthStatus=BAD&agentId=bad", cookies: { opstage_session: cookie.value } });
    expect(invalidServices.statusCode).toBe(422);

    const detail = await app.inject({
      method: "GET",
      url: `/api/admin/capsule-services/${serviceId}`,
      cookies: { opstage_session: cookie.value }
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.health.status).toBe("UP");
    expect(JSON.stringify(detail.json())).not.toContain("must-not-leak");
    expect(detail.json().data.actions[0].name).toBe("echo");

    await app.close();
  });

  it("rejects revoked registration tokens and invalid agent tokens", async () => {
    const app = await buildApp({ logger: false, config });
    const login = await app.inject({
      method: "POST",
      url: "/api/admin/auth/login",
      payload: {
        username: config.OPSTAGE_ADMIN_USERNAME,
        password: config.OPSTAGE_ADMIN_PASSWORD
      }
    });
    const cookie = login.cookies.find(item => item.name === "opstage_session")!;
    const csrfToken = login.json().data.csrfToken as string;
    const tokenRes = await app.inject({
      method: "POST",
      url: "/api/admin/registration-tokens",
      cookies: { opstage_session: cookie.value },
      headers: { "x-csrf-token": csrfToken },
      payload: { name: "revoked token" }
    });
    const rawToken = tokenRes.json().data.token as string;
    const tokenId = tokenRes.json().data.id as string;
    const revoke = await app.inject({
      method: "POST",
      url: `/api/admin/registration-tokens/${tokenId}/revoke`,
      cookies: { opstage_session: cookie.value },
      headers: { "x-csrf-token": csrfToken }
    });
    expect(revoke.statusCode).toBe(200);

    const register = await app.inject({
      method: "POST",
      url: "/api/agents/register",
      payload: {
        registrationToken: rawToken,
        agent: { code: "bad-agent", mode: "embedded" }
      }
    });
    expect(register.statusCode).toBe(401);

    const deleteRevoked = await app.inject({
      method: "DELETE",
      url: `/api/admin/registration-tokens/${tokenId}`,
      cookies: { opstage_session: cookie.value },
      headers: { "x-csrf-token": csrfToken }
    });
    expect(deleteRevoked.statusCode).toBe(200);
    expect(deleteRevoked.json().data.status).toBe("REVOKED");

    const heartbeat = await app.inject({
      method: "POST",
      url: "/api/agents/agt_missing/heartbeat",
      headers: { authorization: "Bearer opstage_agent_bad" },
      payload: {}
    });
    expect(heartbeat.statusCode).toBe(401);
    await app.close();
  });

  it("revokes the prior agent token when an agent re-registers", async () => {
    const app = await buildApp({ logger: false, config });
    const login = await app.inject({
      method: "POST",
      url: "/api/admin/auth/login",
      payload: {
        username: config.OPSTAGE_ADMIN_USERNAME,
        password: config.OPSTAGE_ADMIN_PASSWORD
      }
    });
    const cookie = login.cookies.find(item => item.name === "opstage_session")!;
    const csrfToken = login.json().data.csrfToken as string;

    const issueToken = async (name: string) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/admin/registration-tokens",
        cookies: { opstage_session: cookie.value },
        headers: { "x-csrf-token": csrfToken },
        payload: { name, expiresInSeconds: 3600 }
      });
      expect(res.statusCode).toBe(200);
      return res.json().data.token as string;
    };

    // First registration with token A
    const tokA = await issueToken("first");
    const reg1 = await app.inject({
      method: "POST",
      url: "/api/agents/register",
      payload: { registrationToken: tokA, agent: { code: "rotating-agent", mode: "embedded" } }
    });
    expect(reg1.statusCode).toBe(200);
    const agentId = reg1.json().data.agentId as string;
    const oldAgentToken = reg1.json().data.agentToken as string;

    // Confirm token A is currently good
    const heartbeatA = await app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/heartbeat`,
      headers: { authorization: `Bearer ${oldAgentToken}` },
      payload: {}
    });
    expect(heartbeatA.statusCode).toBe(200);

    // Second registration with token B — same agent code, simulates "lost token, re-register"
    const tokB = await issueToken("second");
    const reg2 = await app.inject({
      method: "POST",
      url: "/api/agents/register",
      payload: { registrationToken: tokB, agent: { code: "rotating-agent", mode: "embedded" } }
    });
    expect(reg2.statusCode).toBe(200);
    expect(reg2.json().data.agentId).toBe(agentId); // same agent identity preserved
    const newAgentToken = reg2.json().data.agentToken as string;
    expect(newAgentToken).not.toBe(oldAgentToken);

    // Old token must now be rejected
    const heartbeatOld = await app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/heartbeat`,
      headers: { authorization: `Bearer ${oldAgentToken}` },
      payload: {}
    });
    expect(heartbeatOld.statusCode).toBe(401);

    // New token works
    const heartbeatNew = await app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/heartbeat`,
      headers: { authorization: `Bearer ${newAgentToken}` },
      payload: {}
    });
    expect(heartbeatNew.statusCode).toBe(200);

    // The rotation produced an audit event
    const auditRes = await app.inject({
      method: "GET",
      url: "/api/admin/audit-events?action=agent.token.rotated",
      cookies: { opstage_session: cookie.value }
    });
    expect(auditRes.statusCode).toBe(200);
    const events = auditRes.json().data as Array<{ targetId: string; metadata?: { revokedTokens?: number } }>;
    const rotation = events.find(e => e.targetId === agentId);
    expect(rotation).toBeDefined();
    // The redactor used to live on key names; this assertion regresses the
    // bug where a numeric `revokedTokens` was being clobbered to "[REDACTED]".
    expect(rotation?.metadata?.revokedTokens).toBe(1);

    await app.close();
  });
});

describe("Phase 3 command and action loop", () => {
  async function setupRegisteredService(db?: ReturnType<typeof openDatabase>, configPatch: Record<string, unknown> = {}) {
    const app = await buildApp({ logger: false, config: { ...config, ...configPatch }, ...(db ? { db } : {}) });
    const login = await app.inject({
      method: "POST",
      url: "/api/admin/auth/login",
      payload: { username: config.OPSTAGE_ADMIN_USERNAME, password: config.OPSTAGE_ADMIN_PASSWORD }
    });
    const cookie = login.cookies.find(item => item.name === "opstage_session")!;
    const csrfToken = login.json().data.csrfToken as string;
    const tokenRes = await app.inject({
      method: "POST",
      url: "/api/admin/registration-tokens",
      cookies: { opstage_session: cookie.value },
      headers: { "x-csrf-token": csrfToken },
      payload: { name: "command token" }
    });
    const registrationToken = tokenRes.json().data.token as string;
    const registerRes = await app.inject({
      method: "POST",
      url: "/api/agents/register",
      payload: {
        registrationToken,
        agent: { code: "command-agent", name: "Command Agent", mode: "embedded", runtime: "nodejs" },
        service: {
          code: "command-service",
          name: "Command Service",
          version: "0.1.0",
          runtime: "nodejs",
          manifest: { kind: "CapsuleService", code: "command-service" },
          health: { status: "UP" },
          configs: [],
          actions: [
            { name: "echo", label: "Echo", dangerLevel: "LOW" },
            { name: "danger", label: "Danger", dangerLevel: "HIGH", requiresConfirmation: true }
          ]
        }
      }
    });
    const { agentId, agentToken } = registerRes.json().data as { agentId: string; agentToken: string };
    const services = await app.inject({ method: "GET", url: "/api/admin/capsule-services", cookies: { opstage_session: cookie.value } });
    const serviceId = services.json().data[0].id as string;
    return { app, cookie, csrfToken, agentId, agentToken, serviceId };
  }



  it("treats command polling as lightweight heartbeat", async () => {
    const db = openDatabase({ databaseUrl: ":memory:" });
    const { app, agentId, agentToken } = await setupRegisteredService(db);
    db.prepare("update agents set status = 'OFFLINE', lastHeartbeatAt = ? where id = ?").run("2000-01-01T00:00:00.000Z", agentId);

    const poll = await app.inject({
      method: "GET",
      url: `/api/agents/${agentId}/commands`,
      headers: { authorization: `Bearer ${agentToken}` }
    });

    expect(poll.statusCode).toBe(200);
    const row = db.prepare("select status, lastHeartbeatAt from agents where id = ?").get(agentId) as { status: string; lastHeartbeatAt: string };
    expect(row.status).toBe("ONLINE");
    expect(Date.parse(row.lastHeartbeatAt)).toBeGreaterThan(Date.parse("2000-01-01T00:00:00.000Z"));
    await app.close();
    db.close();
  });

  it("creates command, agent polls it, and reports success result", async () => {
    const { app, cookie, csrfToken, agentId, agentToken, serviceId } = await setupRegisteredService();
    const create = await app.inject({
      method: "POST",
      url: `/api/admin/capsule-services/${serviceId}/actions/echo`,
      cookies: { opstage_session: cookie.value },
      headers: { "x-csrf-token": csrfToken },
      payload: { payload: { message: "hello", password: "agent-secret-value" } }
    });
    expect(create.statusCode).toBe(200);
    expect(create.json().data.status).toBe("PENDING");
    const commandId = create.json().data.id as string;

    const poll = await app.inject({
      method: "GET",
      url: `/api/agents/${agentId}/commands`,
      headers: { authorization: `Bearer ${agentToken}` }
    });
    expect(poll.statusCode).toBe(200);
    expect(poll.json().data[0]).toMatchObject({ id: commandId, status: "RUNNING", actionName: "echo" });
    expect(poll.json().data[0].payload.password).toBe("agent-secret-value");

    const result = await app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/commands/${commandId}/result`,
      headers: { authorization: `Bearer ${agentToken}` },
      payload: { success: true, message: "done", data: { echoed: true, generatedKey: "demo_one_time_secret" } }
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().data.success).toBe(true);

    const detail = await app.inject({
      method: "GET",
      url: `/api/admin/commands/${commandId}`,
      cookies: { opstage_session: cookie.value }
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.status).toBe("SUCCEEDED");
    expect(detail.json().data.payload.password).toBe("[REDACTED]");
    expect(JSON.stringify(detail.json())).not.toContain("agent-secret-value");
    expect(detail.json().data.result.data.echoed).toBe(true);
    expect(detail.json().data.result.data.generatedKey).toBe("demo_one_time_secret");

    const detailAfterSecretConsumed = await app.inject({
      method: "GET",
      url: `/api/admin/commands/${commandId}`,
      cookies: { opstage_session: cookie.value }
    });
    expect(JSON.stringify(detailAfterSecretConsumed.json())).not.toContain("demo_one_time_secret");
    expect(detailAfterSecretConsumed.json().data.result.data.generatedKey).toBe("[REDACTED]");

    const list = await app.inject({ method: "GET", url: "/api/admin/commands", cookies: { opstage_session: cookie.value } });
    expect(list.statusCode).toBe(200);
    expect(list.json().data[0].id).toBe(commandId);
    const filteredList = await app.inject({ method: "GET", url: `/api/admin/commands?status=SUCCEEDED&type=ACTION_EXECUTE&actionName=echo&agentId=${agentId}&serviceId=${serviceId}`, cookies: { opstage_session: cookie.value } });
    expect(filteredList.json().pagination.total).toBe(1);
    const mismatchedTypeList = await app.inject({ method: "GET", url: "/api/admin/commands?type=ACTION_PREPARE", cookies: { opstage_session: cookie.value } });
    expect(mismatchedTypeList.json().pagination.total).toBe(0);
    const invalidTypeList = await app.inject({ method: "GET", url: "/api/admin/commands?type=BAD_TYPE", cookies: { opstage_session: cookie.value } });
    expect(invalidTypeList.statusCode).toBe(422);
    expect(invalidTypeList.json().error.code).toBe("VALIDATION_FAILED");
    const invalidAgentFilter = await app.inject({ method: "GET", url: "/api/admin/commands?agentId=bad-agent", cookies: { opstage_session: cookie.value } });
    expect(invalidAgentFilter.statusCode).toBe(422);

    const dashboard = await app.inject({ method: "GET", url: "/api/admin/dashboard/summary", cookies: { opstage_session: cookie.value } });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json().data.commandCounts.SUCCEEDED).toBe(1);
    expect(dashboard.json().data.recentCommands[0].id).toBe(commandId);

    const auditEvents = await app.inject({ method: "GET", url: "/api/admin/audit-events?pageSize=5", cookies: { opstage_session: cookie.value } });
    expect(auditEvents.statusCode).toBe(200);
    expect(auditEvents.json().data.some((event: { action: string }) => event.action === "command.completed" || event.action === "command.failed")).toBe(true);
    const filteredAuditEvents = await app.inject({ method: "GET", url: "/api/admin/audit-events?action=command.completed&actorType=AGENT&result=SUCCESS&from=2000-01-01T00:00:00.000Z", cookies: { opstage_session: cookie.value } });
    expect(filteredAuditEvents.json().pagination.total).toBe(1);
    const filteredAuditByTarget = await app.inject({ method: "GET", url: `/api/admin/audit-events?targetType=Command&targetId=${commandId}`, cookies: { opstage_session: cookie.value } });
    expect(filteredAuditByTarget.statusCode).toBe(200);
    expect(filteredAuditByTarget.json().data.every((event: { targetType: string; targetId: string }) => event.targetType === "Command" && event.targetId === commandId)).toBe(true);
    const toBeforeEvents = await app.inject({ method: "GET", url: "/api/admin/audit-events?to=2000-01-01T00:00:00.000Z", cookies: { opstage_session: cookie.value } });
    expect(toBeforeEvents.json().pagination.total).toBe(0);
    const invalidAuditFilter = await app.inject({ method: "GET", url: "/api/admin/audit-events?actorType=BOT", cookies: { opstage_session: cookie.value } });
    expect(invalidAuditFilter.statusCode).toBe(422);
    expect(invalidAuditFilter.json().error.code).toBe("VALIDATION_FAILED");
    const invalidAuditRange = await app.inject({ method: "GET", url: "/api/admin/audit-events?from=2026-01-02T00:00:00.000Z&to=2026-01-01T00:00:00.000Z", cookies: { opstage_session: cookie.value } });
    expect(invalidAuditRange.statusCode).toBe(422);
    const invalidAuditTargetId = await app.inject({ method: "GET", url: "/api/admin/audit-events?targetId=%20%20%20", cookies: { opstage_session: cookie.value } });
    expect(invalidAuditTargetId.statusCode).toBe(422);
    expect(JSON.stringify(auditEvents.json())).not.toContain("opstage_agent_");
    await app.close();
  });

  it("captures failure reason and duration on the command row when an action fails", async () => {
    const { app, cookie, csrfToken, agentId, agentToken, serviceId } = await setupRegisteredService();
    const create = await app.inject({
      method: "POST",
      url: `/api/admin/capsule-services/${serviceId}/actions/echo`,
      cookies: { opstage_session: cookie.value },
      headers: { "x-csrf-token": csrfToken },
      payload: { payload: { message: "hi" } },
    });
    const commandId = create.json().data.id as string;

    // poll → RUNNING (also produces a non-null startedAt that durationMs needs)
    await app.inject({
      method: "GET",
      url: `/api/agents/${agentId}/commands`,
      headers: { authorization: `Bearer ${agentToken}` },
    });

    // Report a failure. error.code + error.message should land on the command row.
    const result = await app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/commands/${commandId}/result`,
      headers: { authorization: `Bearer ${agentToken}` },
      payload: {
        success: false,
        error: { code: "UPSTREAM_5XX", message: "vendor returned 503 after 3 retries" },
      },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().data.success).toBe(false);

    const detail = await app.inject({
      method: "GET",
      url: `/api/admin/commands/${commandId}`,
      cookies: { opstage_session: cookie.value },
    });
    expect(detail.statusCode).toBe(200);
    const body = detail.json().data;
    expect(body.status).toBe("FAILED");
    expect(body.errorCode).toBe("UPSTREAM_5XX");
    expect(body.errorMessage).toBe("vendor returned 503 after 3 retries");
    expect(typeof body.durationMs).toBe("number");
    expect(body.durationMs).toBeGreaterThanOrEqual(0);

    // Also surfaces in the list endpoint without an extra join.
    const list = await app.inject({
      method: "GET",
      url: "/api/admin/commands?status=FAILED",
      cookies: { opstage_session: cookie.value },
    });
    expect(list.json().pagination.total).toBe(1);
    expect(list.json().data[0]).toMatchObject({
      id: commandId,
      status: "FAILED",
      errorCode: "UPSTREAM_5XX",
      errorMessage: "vendor returned 503 after 3 retries",
    });

    // Reports without an explicit error.code still produce a fallback ACTION_FAILED
    // entry, never an empty string.
    const create2 = await app.inject({
      method: "POST",
      url: `/api/admin/capsule-services/${serviceId}/actions/echo`,
      cookies: { opstage_session: cookie.value },
      headers: { "x-csrf-token": csrfToken },
      payload: { payload: { message: "another" } },
    });
    const command2Id = create2.json().data.id as string;
    await app.inject({
      method: "GET",
      url: `/api/agents/${agentId}/commands`,
      headers: { authorization: `Bearer ${agentToken}` },
    });
    await app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/commands/${command2Id}/result`,
      headers: { authorization: `Bearer ${agentToken}` },
      payload: { success: false, message: "no code provided here" },
    });
    const detail2 = await app.inject({
      method: "GET",
      url: `/api/admin/commands/${command2Id}`,
      cookies: { opstage_session: cookie.value },
    });
    expect(detail2.json().data.errorCode).toBe("ACTION_FAILED");
    expect(detail2.json().data.errorMessage).toBe("no code provided here");

    await app.close();
  });

  it("respects agent command poll limit", async () => {
    const db = openDatabase({ databaseUrl: ":memory:" });
    const { app, cookie, csrfToken, agentId, agentToken, serviceId } = await setupRegisteredService(db);
    const commandIds: string[] = [];
    for (const message of ["one", "two", "three"]) {
      const create = await app.inject({
        method: "POST",
        url: `/api/admin/capsule-services/${serviceId}/actions/echo`,
        cookies: { opstage_session: cookie.value },
        headers: { "x-csrf-token": csrfToken },
        payload: { payload: { message } }
      });
      expect(create.statusCode).toBe(200);
      commandIds.push(create.json().data.id as string);
    }

    const firstPoll = await app.inject({
      method: "GET",
      url: `/api/agents/${agentId}/commands?limit=1`,
      headers: { authorization: `Bearer ${agentToken}` }
    });
    expect(firstPoll.statusCode).toBe(200);
    expect(firstPoll.json().data).toHaveLength(1);
    expect(firstPoll.json().data[0].id).toBe(commandIds[0]);

    const statusesAfterFirstPoll = commandIds.map((id) => (db.prepare("select status from commands where id = ?").get(id) as { status: string }).status);
    expect(statusesAfterFirstPoll).toEqual(["RUNNING", "PENDING", "PENDING"]);

    const secondPoll = await app.inject({
      method: "GET",
      url: `/api/agents/${agentId}/commands?limit=2`,
      headers: { authorization: `Bearer ${agentToken}` }
    });
    expect(secondPoll.statusCode).toBe(200);
    expect(secondPoll.json().data.map((item: { id: string }) => item.id)).toEqual(commandIds.slice(1));
    const metrics = await app.inject({ method: "GET", url: "/api/admin/metrics", cookies: { opstage_session: cookie.value } });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.json().data.operational.agentCommandPolls).toBe(2);
    expect(metrics.json().data.operational.commandsDispatched).toBe(3);

    await app.close();
    db.close();
  });

  it("clamps invalid agent command poll limits", async () => {
    const db = openDatabase({ databaseUrl: ":memory:" });
    const { app, cookie, csrfToken, agentId, agentToken, serviceId } = await setupRegisteredService(db);
    const createCommand = async (message: string) => {
      const create = await app.inject({
        method: "POST",
        url: `/api/admin/capsule-services/${serviceId}/actions/echo`,
        cookies: { opstage_session: cookie.value },
        headers: { "x-csrf-token": csrfToken },
        payload: { payload: { message } }
      });
      expect(create.statusCode).toBe(200);
      return create.json().data.id as string;
    };

    const first = await createCommand("zero-limit");
    const zeroLimitPoll = await app.inject({
      method: "GET",
      url: `/api/agents/${agentId}/commands?limit=0`,
      headers: { authorization: `Bearer ${agentToken}` }
    });
    expect(zeroLimitPoll.statusCode).toBe(200);
    expect(zeroLimitPoll.json().data.map((item: { id: string }) => item.id)).toEqual([first]);

    for (let i = 0; i < 12; i += 1) await createCommand(`large-limit-${i}`);
    const largeLimitPoll = await app.inject({
      method: "GET",
      url: `/api/agents/${agentId}/commands?limit=99`,
      headers: { authorization: `Bearer ${agentToken}` }
    });
    expect(largeLimitPoll.statusCode).toBe(200);
    expect(largeLimitPoll.json().data).toHaveLength(10);

    const invalidLimitPoll = await app.inject({
      method: "GET",
      url: `/api/agents/${agentId}/commands?limit=abc`,
      headers: { authorization: `Bearer ${agentToken}` }
    });
    expect(invalidLimitPoll.statusCode).toBe(200);
    expect(invalidLimitPoll.json().data).toHaveLength(2);

    await app.close();
    db.close();
  });

  it("returns prepare command details when action prepare fails", async () => {
    const db = openDatabase({ databaseUrl: ":memory:" });
    const { app, cookie, agentId, agentToken, serviceId } = await setupRegisteredService(db);
    const preparePromise = app.inject({
      method: "GET",
      url: `/api/admin/capsule-services/${serviceId}/actions/echo`,
      cookies: { opstage_session: cookie.value }
    });
    let queuedCommand: { id: string } | undefined;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      queuedCommand = db.prepare("select id from commands where type = 'ACTION_PREPARE' and actionName = 'echo' order by createdAt desc limit 1").get() as { id: string } | undefined;
      if (queuedCommand) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(queuedCommand).toBeDefined();

    const poll = await app.inject({
      method: "GET",
      url: `/api/agents/${agentId}/commands?limit=1`,
      headers: { authorization: `Bearer ${agentToken}` }
    });
    expect(poll.statusCode).toBe(200);
    const commandId = poll.json().data[0].id as string;
    expect(commandId).toBe(queuedCommand!.id);

    const result = await app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/commands/${commandId}/result`,
      headers: { authorization: `Bearer ${agentToken}` },
      payload: { success: false, message: "prepare failed", error: { code: "PREPARE_FAILED" } }
    });
    expect(result.statusCode).toBe(200);

    const prepare = await preparePromise;
    expect(prepare.statusCode).toBe(424);
    // The endpoint now surfaces the agent-reported error.code on the
    // command row directly (PREPARE_FAILED here) rather than always
    // falling back to a generic ACTION_PREPARE_FAILED. The fallback only
    // applies when the agent reported no error.code at all.
    expect(prepare.json().error).toMatchObject({
      code: "PREPARE_FAILED",
      message: "prepare failed",
      details: {
        commandId,
        commandStatus: "FAILED",
        actionName: "echo",
        agentId,
        serviceId
      }
    });
    await app.close();
    db.close();
  });


  it("cancels pending command from admin API", async () => {
    const { app, cookie, csrfToken, serviceId } = await setupRegisteredService();
    const create = await app.inject({
      method: "POST",
      url: `/api/admin/capsule-services/${serviceId}/actions/echo`,
      cookies: { opstage_session: cookie.value },
      headers: { "x-csrf-token": csrfToken },
      payload: { payload: { message: "cancel-me" } }
    });
    expect(create.statusCode).toBe(200);
    const commandId = create.json().data.id as string;
    const cancel = await app.inject({
      method: "POST",
      url: `/api/admin/commands/${commandId}/cancel`,
      cookies: { opstage_session: cookie.value },
      headers: { "x-csrf-token": csrfToken }
    });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().data.status).toBe("CANCELLED");
    const duplicateCancel = await app.inject({
      method: "POST",
      url: `/api/admin/commands/${commandId}/cancel`,
      cookies: { opstage_session: cookie.value },
      headers: { "x-csrf-token": csrfToken }
    });
    expect(duplicateCancel.statusCode).toBe(409);

    const retry = await app.inject({
      method: "POST",
      url: `/api/admin/commands/${commandId}/retry`,
      cookies: { opstage_session: cookie.value },
      headers: { "x-csrf-token": csrfToken }
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().data).toMatchObject({ status: "PENDING", actionName: "echo" });
    expect(retry.json().data.id).not.toBe(commandId);
    await app.close();
  });



  it("rejects oversized command results", async () => {
    const { app, cookie, csrfToken, agentId, agentToken, serviceId } = await setupRegisteredService(undefined, { OPSTAGE_COMMAND_RESULT_MAX_BYTES: 120 });
    const create = await app.inject({
      method: "POST",
      url: `/api/admin/capsule-services/${serviceId}/actions/echo`,
      cookies: { opstage_session: cookie.value },
      headers: { "x-csrf-token": csrfToken },
      payload: { payload: { message: "large-result" } }
    });
    expect(create.statusCode).toBe(200);
    const commandId = create.json().data.id as string;
    await app.inject({ method: "GET", url: `/api/agents/${agentId}/commands`, headers: { authorization: `Bearer ${agentToken}` } });
    const oversized = await app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/commands/${commandId}/result`,
      headers: { authorization: `Bearer ${agentToken}` },
      payload: { success: true, data: { text: "x".repeat(200) } }
    });
    expect(oversized.statusCode).toBe(413);
    expect(oversized.json().error.code).toBe("COMMAND_RESULT_TOO_LARGE");
    const metrics = await app.inject({ method: "GET", url: "/api/admin/metrics", cookies: { opstage_session: cookie.value } });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.json().data.operational.oversizedCommandResultsRejected).toBe(1);
    await app.close();
  });

  it("requires confirmation for dangerous action and rejects duplicate result", async () => {
    const { app, cookie, csrfToken, agentId, agentToken, serviceId } = await setupRegisteredService();
    const denied = await app.inject({
      method: "POST",
      url: `/api/admin/capsule-services/${serviceId}/actions/danger`,
      cookies: { opstage_session: cookie.value },
      headers: { "x-csrf-token": csrfToken },
      payload: { payload: {} }
    });
    expect(denied.statusCode).toBe(409);

    const create = await app.inject({
      method: "POST",
      url: `/api/admin/capsule-services/${serviceId}/actions/danger`,
      cookies: { opstage_session: cookie.value },
      headers: { "x-csrf-token": csrfToken },
      payload: { confirmation: true, payload: { ok: true } }
    });
    expect(create.statusCode).toBe(200);
    const commandId = create.json().data.id as string;
    await app.inject({ method: "GET", url: `/api/agents/${agentId}/commands`, headers: { authorization: `Bearer ${agentToken}` } });
    const first = await app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/commands/${commandId}/result`,
      headers: { authorization: `Bearer ${agentToken}` },
      payload: { success: false, message: "failed", error: { code: "DEMO_FAILURE" } }
    });
    expect(first.statusCode).toBe(200);
    const duplicate = await app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/commands/${commandId}/result`,
      headers: { authorization: `Bearer ${agentToken}` },
      payload: { success: true }
    });
    expect(duplicate.statusCode).toBe(409);
    await app.close();
  });
});


describe("Phase 10 security and permissions", () => {
  async function loginAs(app: Awaited<ReturnType<typeof buildApp>>, username: string, password: string) {
    const login = await app.inject({ method: "POST", url: "/api/admin/auth/login", payload: { username, password } });
    expect(login.statusCode).toBe(200);
    return { cookie: login.cookies.find(item => item.name === "opstage_session")!, csrfToken: login.json().data.csrfToken as string };
  }

  it("allows owner to manage users and blocks viewer mutations", async () => {
    const app = await buildApp({ logger: false, config });
    const owner = await loginAs(app, config.OPSTAGE_ADMIN_USERNAME, config.OPSTAGE_ADMIN_PASSWORD);
    const created = await app.inject({
      method: "POST",
      url: "/api/admin/users",
      cookies: { opstage_session: owner.cookie.value },
      headers: { "x-csrf-token": owner.csrfToken },
      payload: { username: "viewer@example.local", password: "viewer-password-123", role: "viewer", displayName: "Viewer" }
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().data).toMatchObject({ username: "viewer@example.local", role: "viewer", status: "ACTIVE" });
    expect(created.body).not.toContain("viewer-password-123");

    const users = await app.inject({ method: "GET", url: "/api/admin/users", cookies: { opstage_session: owner.cookie.value } });
    expect(users.statusCode).toBe(200);
    expect(users.json().pagination.total).toBe(2);

    const viewer = await loginAs(app, "viewer@example.local", "viewer-password-123");
    const forbidden = await app.inject({
      method: "POST",
      url: "/api/admin/registration-tokens",
      cookies: { opstage_session: viewer.cookie.value },
      headers: { "x-csrf-token": viewer.csrfToken },
      payload: { name: "viewer token" }
    });
    expect(forbidden.statusCode).toBe(403);

    const reset = await app.inject({
      method: "POST",
      url: `/api/admin/users/${created.json().data.id}/reset-password`,
      cookies: { opstage_session: owner.cookie.value },
      headers: { "x-csrf-token": owner.csrfToken },
      payload: { password: "viewer-password-456" }
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.body).not.toContain("viewer-password-456");
    await app.close();
  });

  it("revokes agent and invalidates active agent token", async () => {
    const app = await buildApp({ logger: false, config });
    const owner = await loginAs(app, config.OPSTAGE_ADMIN_USERNAME, config.OPSTAGE_ADMIN_PASSWORD);
    const tokenRes = await app.inject({ method: "POST", url: "/api/admin/registration-tokens", cookies: { opstage_session: owner.cookie.value }, headers: { "x-csrf-token": owner.csrfToken }, payload: { name: "agent revoke" } });
    const registerRes = await app.inject({ method: "POST", url: "/api/agents/register", payload: { registrationToken: tokenRes.json().data.token, agent: { code: "revoke-agent", mode: "embedded" } } });
    const { agentId, agentToken } = registerRes.json().data as { agentId: string; agentToken: string };
    const disable = await app.inject({ method: "POST", url: `/api/admin/agents/${agentId}/disable`, cookies: { opstage_session: owner.cookie.value }, headers: { "x-csrf-token": owner.csrfToken } });
    expect(disable.statusCode).toBe(200);
    expect(disable.json().data.status).toBe("DISABLED");
    const disabledHeartbeat = await app.inject({ method: "POST", url: `/api/agents/${agentId}/heartbeat`, headers: { authorization: `Bearer ${agentToken}` }, payload: {} });
    expect(disabledHeartbeat.statusCode).toBe(403);
    const enable = await app.inject({ method: "POST", url: `/api/admin/agents/${agentId}/enable`, cookies: { opstage_session: owner.cookie.value }, headers: { "x-csrf-token": owner.csrfToken } });
    expect(enable.statusCode).toBe(200);
    expect(enable.json().data.status).toBe("ONLINE");
    const enabledHeartbeat = await app.inject({ method: "POST", url: `/api/agents/${agentId}/heartbeat`, headers: { authorization: `Bearer ${agentToken}` }, payload: {} });
    expect(enabledHeartbeat.statusCode).toBe(200);
    const revoke = await app.inject({ method: "POST", url: `/api/admin/agents/${agentId}/revoke`, cookies: { opstage_session: owner.cookie.value }, headers: { "x-csrf-token": owner.csrfToken } });
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json().data.status).toBe("REVOKED");
    const heartbeat = await app.inject({ method: "POST", url: `/api/agents/${agentId}/heartbeat`, headers: { authorization: `Bearer ${agentToken}` }, payload: {} });
    expect(heartbeat.statusCode).toBe(401);
    await app.close();
  });
});


describe("Phase 11 maintenance tasks", () => {
  it("expires tokens and commands, marks stale agents offline, and prunes audit events", async () => {
    const db = openDatabase({ databaseUrl: ":memory:" });
    const app = await buildApp({ logger: false, db, config: { ...config, OPSTAGE_AGENT_OFFLINE_THRESHOLD_SECONDS: 1, OPSTAGE_AUDIT_RETENTION_DAYS: 1, OPSTAGE_MAINTENANCE_INTERVAL_SECONDS: 0 } });
    const login = await app.inject({ method: "POST", url: "/api/admin/auth/login", payload: { username: config.OPSTAGE_ADMIN_USERNAME, password: config.OPSTAGE_ADMIN_PASSWORD } });
    const cookie = login.cookies.find(item => item.name === "opstage_session")!;
    const csrfToken = login.json().data.csrfToken as string;

    const tokenRes = await app.inject({ method: "POST", url: "/api/admin/registration-tokens", cookies: { opstage_session: cookie.value }, headers: { "x-csrf-token": csrfToken }, payload: { name: "maintenance token" } });
    db.prepare("update registration_tokens set expiresAt = ? where id = ?").run("2000-01-01T00:00:00.000Z", tokenRes.json().data.id);

    const liveTokenRes = await app.inject({ method: "POST", url: "/api/admin/registration-tokens", cookies: { opstage_session: cookie.value }, headers: { "x-csrf-token": csrfToken }, payload: { name: "agent token" } });
    const registerRes = await app.inject({ method: "POST", url: "/api/agents/register", payload: {
      registrationToken: liveTokenRes.json().data.token,
      agent: { code: "stale-agent", mode: "embedded" },
      service: { code: "stale-service", name: "Stale Service", manifest: {}, health: { status: "UP" }, configs: [], actions: [{ name: "slow", label: "Slow", dangerLevel: "LOW", timeoutSeconds: 60 }] }
    } });
    const agentId = registerRes.json().data.agentId as string;
    const services = await app.inject({ method: "GET", url: "/api/admin/capsule-services", cookies: { opstage_session: cookie.value } });
    const serviceId = services.json().data[0].id as string;
    const command = await app.inject({ method: "POST", url: `/api/admin/capsule-services/${serviceId}/actions/slow`, cookies: { opstage_session: cookie.value }, headers: { "x-csrf-token": csrfToken }, payload: { payload: {} } });
    db.prepare("update commands set expiresAt = ? where id = ?").run("2000-01-01T00:00:00.000Z", command.json().data.id);
    db.prepare("update agents set lastHeartbeatAt = ? where id = ?").run("2000-01-01T00:00:00.000Z", agentId);

    db.prepare("insert into audit_events (id, workspaceId, actorType, action, result, createdAt) values (?, ?, 'SYSTEM', 'OLD_EVENT', 'SUCCESS', ?)").run("aud_old", DEFAULT_WORKSPACE.id, "2000-01-01T00:00:00.000Z");

    const run = await app.inject({ method: "POST", url: "/api/admin/maintenance/run", cookies: { opstage_session: cookie.value }, headers: { "x-csrf-token": csrfToken } });
    expect(run.statusCode).toBe(200);
    expect(run.json().data).toMatchObject({ expiredRegistrationTokens: 1, expiredCommands: 1, offlineAgents: 1, offlineServices: 1, deletedAuditEvents: 1 });

    expect((db.prepare("select status from registration_tokens where id = ?").get(tokenRes.json().data.id) as { status: string }).status).toBe("EXPIRED");
    expect((db.prepare("select status from commands where id = ?").get(command.json().data.id) as { status: string }).status).toBe("EXPIRED");
    expect((db.prepare("select status from agents where id = ?").get(agentId) as { status: string }).status).toBe("OFFLINE");
    expect((db.prepare("select status from capsule_services where id = ?").get(serviceId) as { status: string }).status).toBe("STALE");
    await app.close();
    db.close();
  });
});


describe("Phase 12 export backup and diagnostics", () => {
  it("exposes metrics, diagnostics, audit exports, and sqlite backup", async () => {
    const backupDir = await mkdtemp(path.join(os.tmpdir(), "opstage-backup-"));
    const db = openDatabase({ databaseUrl: ":memory:" });
    const app = await buildApp({ logger: false, db, config: { ...config, OPSTAGE_BACKUP_DIR: backupDir, OPSTAGE_MAINTENANCE_INTERVAL_SECONDS: 0 } });
    const login = await app.inject({ method: "POST", url: "/api/admin/auth/login", payload: { username: config.OPSTAGE_ADMIN_USERNAME, password: config.OPSTAGE_ADMIN_PASSWORD } });
    const cookie = login.cookies.find(item => item.name === "opstage_session")!;
    const csrfToken = login.json().data.csrfToken as string;

    const metrics = await app.inject({ method: "GET", url: "/api/admin/metrics", cookies: { opstage_session: cookie.value } });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.json().data.totals.users).toBe(1);
    // v0.2 metrics surface: command duration summary (sample 0 on a fresh
    // workspace), stale-online-agents indicator, and topCommandErrors array.
    expect(metrics.json().data.commandDurations).toMatchObject({
      sampleSize: 0,
      p50Ms: null,
      p95Ms: null,
      maxMs: null,
      meanMs: null,
    });
    expect(metrics.json().data.operational.staleOnlineAgents).toBe(0);
    expect(Array.isArray(metrics.json().data.topCommandErrors)).toBe(true);

    const updateSettings = await app.inject({ method: "PATCH", url: "/api/admin/settings/maintenance", cookies: { opstage_session: cookie.value }, headers: { "x-csrf-token": csrfToken }, payload: { agentOfflineThresholdSeconds: 5, auditRetentionDays: 7, maintenanceIntervalSeconds: 0 } });
    expect(updateSettings.statusCode).toBe(200);
    expect(updateSettings.json().data).toMatchObject({ agentOfflineThresholdSeconds: 5, auditRetentionDays: 7, maintenanceIntervalSeconds: 0 });

    const diagnostics = await app.inject({ method: "GET", url: "/api/admin/diagnostics/runtime", cookies: { opstage_session: cookie.value } });
    expect(diagnostics.statusCode).toBe(200);
    expect(diagnostics.json().data.node).toMatch(/^v/);
    expect(diagnostics.json().data.config.maintenance.auditRetentionDays).toBe(7);
    expect(JSON.stringify(diagnostics.json())).not.toContain(config.OPSTAGE_SESSION_SECRET);

    const csv = await app.inject({ method: "GET", url: "/api/admin/audit-events/export?format=csv", cookies: { opstage_session: cookie.value } });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body).toContain("session.login");

    const json = await app.inject({ method: "GET", url: "/api/admin/audit-events/export", cookies: { opstage_session: cookie.value } });
    expect(json.statusCode).toBe(200);
    expect(json.json().data.length).toBeGreaterThan(0);

    const backup = await app.inject({ method: "POST", url: "/api/admin/backup/sqlite", cookies: { opstage_session: cookie.value }, headers: { "x-csrf-token": csrfToken } });
    expect(backup.statusCode).toBe(200);
    expect(backup.headers["content-disposition"]).toContain("opstage-");
    expect(backup.rawPayload.length).toBeGreaterThan(0);

    await app.close();
    db.close();
    await rm(backupDir, { recursive: true, force: true });
  });
});
