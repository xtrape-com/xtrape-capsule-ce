import { describe, expect, it } from "vitest";

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
  OPSTAGE_PORT: 0,
  OPSTAGE_CAPSULE_BUS_ENABLED: true,
};

async function login(app: Awaited<ReturnType<typeof buildApp>>) {
  const res = await app.inject({ method: "POST", url: "/api/admin/auth/login", payload: { username: config.OPSTAGE_ADMIN_USERNAME, password: config.OPSTAGE_ADMIN_PASSWORD } });
  return { cookie: res.cookies.find(c => c.name === "opstage_session")!.value, csrfToken: res.json().data.csrfToken as string };
}

describe("v0.4 experimental Capsule Bus", () => {
  it("stays disabled when env-style false is supplied", async () => {
    const app = await buildApp({ logger: false, config: { ...config, OPSTAGE_CAPSULE_BUS_ENABLED: false } });
    const unauthenticated = await app.inject({ method: "GET", url: "/api/admin/bus/routes" });
    expect(unauthenticated.statusCode).toBe(401);
    const admin = await login(app);
    const res = await app.inject({ method: "GET", url: "/api/admin/bus/routes", cookies: { opstage_session: admin.cookie } });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("CAPSULE_BUS_DISABLED");
    await app.close();
  });

  it("accepts a bus event and creates a routed command", async () => {
    const app = await buildApp({ logger: false, config });
    const admin = await login(app);
    const tokenRes = await app.inject({ method: "POST", url: "/api/admin/registration-tokens", cookies: { opstage_session: admin.cookie }, headers: { "x-csrf-token": admin.csrfToken }, payload: { name: "bus token" } });
    const registrationToken = tokenRes.json().data.token as string;
    const registerRes = await app.inject({
      method: "POST",
      url: "/api/agents/register",
      payload: {
        registrationToken,
        agent: { code: "bus-agent", name: "Bus Agent", mode: "embedded", runtime: "nodejs" },
        service: {
          code: "demo-worker",
          name: "Demo Worker",
          version: "0.4.0",
          runtime: "nodejs",
          manifest: { kind: "CapsuleService", code: "demo-worker" },
          health: { status: "UP" },
          actions: [{ name: "notify", label: "Notify", dangerLevel: "LOW" }],
        },
      },
    });
    const { agentId, agentToken } = registerRes.json().data as { agentId: string; agentToken: string };
    const route = await app.inject({
      method: "POST",
      url: "/api/admin/bus/routes",
      cookies: { opstage_session: admin.cookie },
      headers: { "x-csrf-token": admin.csrfToken },
      payload: { name: "item created", status: "ENABLED", match: { eventType: "demo.item.created", sourceServiceCode: "demo-worker" }, target: { serviceCode: "demo-worker", actionName: "notify" } },
    });
    expect(route.statusCode).toBe(200);
    const routeId = route.json().data.id as string;
    const routeDetail = await app.inject({ method: "GET", url: `/api/admin/bus/routes/${routeId}`, cookies: { opstage_session: admin.cookie } });
    expect(routeDetail.statusCode).toBe(200);
    expect(routeDetail.json().data.status).toBe("ENABLED");
    const updatedRoute = await app.inject({
      method: "PUT",
      url: `/api/admin/bus/routes/${routeId}`,
      cookies: { opstage_session: admin.cookie },
      headers: { "x-csrf-token": admin.csrfToken },
      payload: { name: "item created dry run", status: "DRY_RUN", match: { eventType: "demo.item.created", sourceServiceCode: "demo-worker" }, target: { serviceCode: "demo-worker", actionName: "notify" } },
    });
    expect(updatedRoute.statusCode).toBe(200);
    expect(updatedRoute.json().data.status).toBe("DRY_RUN");
    await app.inject({
      method: "PUT",
      url: `/api/admin/bus/routes/${routeId}`,
      cookies: { opstage_session: admin.cookie },
      headers: { "x-csrf-token": admin.csrfToken },
      payload: { name: "item created", status: "ENABLED", match: { eventType: "demo.item.created", sourceServiceCode: "demo-worker" }, target: { serviceCode: "demo-worker", actionName: "notify" } },
    });
    const unknownSource = await app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/bus/events`,
      headers: { authorization: `Bearer ${agentToken}` },
      payload: { eventType: "demo.item.created", sourceServiceCode: "missing-service", payload: { itemId: "item-0" } },
    });
    expect(unknownSource.statusCode).toBe(404);
    expect(unknownSource.json().error.code).toBe("BUS_SOURCE_SERVICE_NOT_FOUND");
    const published = await app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/bus/events`,
      headers: { authorization: `Bearer ${agentToken}` },
      payload: { eventType: "demo.item.created", sourceServiceCode: "demo-worker", payload: { itemId: "item-1", password: "should-redact" } },
    });
    expect(published.statusCode).toBe(200);
    expect(published.json().data.experimental).toBe("v0.4-experimental");
    expect(published.json().data.routedCommands[0]).toMatchObject({ status: "CREATED", actionName: "notify" });
    const commands = await app.inject({ method: "GET", url: "/api/admin/commands", cookies: { opstage_session: admin.cookie } });
    expect(commands.json().pagination.total).toBe(1);
    const events = await app.inject({ method: "GET", url: "/api/admin/bus/events", cookies: { opstage_session: admin.cookie } });
    expect(events.json().data[0]).toMatchObject({ eventType: "demo.item.created", routeCount: 1 });
    expect(events.json().data[0].payload.password).toBe("[REDACTED]");
    const audit = await app.inject({ method: "GET", url: "/api/admin/bus/audit", cookies: { opstage_session: admin.cookie } });
    expect(audit.statusCode).toBe(200);
    expect(audit.json().data.map((row: { action: string }) => row.action)).toContain("bus.command.created");
    await app.close();
  });

  it("rejects events exceeding the per-agent rate limit", async () => {
    const app = await buildApp({ logger: false, config: { ...config, OPSTAGE_CAPSULE_BUS_INGEST_PER_MIN: 2 } });
    const admin = await login(app);
    const tokenRes = await app.inject({ method: "POST", url: "/api/admin/registration-tokens", cookies: { opstage_session: admin.cookie }, headers: { "x-csrf-token": admin.csrfToken }, payload: { name: "rate token" } });
    const registrationToken = tokenRes.json().data.token as string;
    const registerRes = await app.inject({
      method: "POST", url: "/api/agents/register",
      payload: {
        registrationToken,
        agent: { code: "rate-agent", name: "Rate Agent", mode: "embedded", runtime: "nodejs" },
        service: { code: "rate-svc", name: "Rate Svc", version: "0.4.0", runtime: "nodejs", manifest: { kind: "CapsuleService", code: "rate-svc" }, health: { status: "UP" }, actions: [{ name: "noop", label: "Noop", dangerLevel: "LOW" }] },
      },
    });
    const { agentId, agentToken } = registerRes.json().data as { agentId: string; agentToken: string };
    for (let i = 0; i < 2; i++) {
      const res = await app.inject({ method: "POST", url: `/api/agents/${agentId}/bus/events`, headers: { authorization: `Bearer ${agentToken}` }, payload: { eventType: "rate.test", sourceServiceCode: "rate-svc", payload: {} } });
      expect(res.statusCode).toBe(200);
    }
    const limited = await app.inject({ method: "POST", url: `/api/agents/${agentId}/bus/events`, headers: { authorization: `Bearer ${agentToken}` }, payload: { eventType: "rate.test", sourceServiceCode: "rate-svc", payload: {} } });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("BUS_RATE_LIMITED");
    await app.close();
  });

  it("rejects events that would exceed max depth", async () => {
    const app = await buildApp({ logger: false, config });
    const admin = await login(app);
    const tokenRes = await app.inject({ method: "POST", url: "/api/admin/registration-tokens", cookies: { opstage_session: admin.cookie }, headers: { "x-csrf-token": admin.csrfToken }, payload: { name: "depth token" } });
    const registrationToken = tokenRes.json().data.token as string;
    const registerRes = await app.inject({
      method: "POST", url: "/api/agents/register",
      payload: {
        registrationToken,
        agent: { code: "depth-agent", name: "Depth Agent", mode: "embedded", runtime: "nodejs" },
        service: { code: "depth-svc", name: "Depth Svc", version: "0.4.0", runtime: "nodejs", manifest: { kind: "CapsuleService", code: "depth-svc" }, health: { status: "UP" }, actions: [{ name: "echo", label: "Echo", dangerLevel: "LOW" }] },
      },
    });
    const { agentId, agentToken } = registerRes.json().data as { agentId: string; agentToken: string };
    const first = await app.inject({ method: "POST", url: `/api/agents/${agentId}/bus/events`, headers: { authorization: `Bearer ${agentToken}` }, payload: { eventType: "depth.test", sourceServiceCode: "depth-svc", payload: {} } });
    expect(first.statusCode).toBe(200);
    const firstEventId = first.json().data.eventId as string;
    const second = await app.inject({ method: "POST", url: `/api/agents/${agentId}/bus/events`, headers: { authorization: `Bearer ${agentToken}` }, payload: { eventType: "depth.chain", sourceServiceCode: "depth-svc", causationId: firstEventId, payload: {} } });
    expect(second.statusCode).toBe(200);
    const secondEventId = second.json().data.eventId as string;
    const third = await app.inject({ method: "POST", url: `/api/agents/${agentId}/bus/events`, headers: { authorization: `Bearer ${agentToken}` }, payload: { eventType: "depth.chain2", sourceServiceCode: "depth-svc", causationId: secondEventId, payload: {} } });
    expect(third.statusCode).toBe(422);
    expect(third.json().error.code).toBe("BUS_DEPTH_EXCEEDED");
    await app.close();
  });
});
