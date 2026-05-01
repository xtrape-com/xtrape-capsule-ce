import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../../apps/opstage-backend/src/app.js";
import { CapsuleAgent } from "./index.js";

const config = {
  DATABASE_URL: ":memory:",
  OPSTAGE_SESSION_SECRET: "test-session-secret-must-be-at-least-32-chars",
  OPSTAGE_ADMIN_USERNAME: "admin@example.local",
  OPSTAGE_ADMIN_PASSWORD: "change-me-before-running",
  OPSTAGE_SESSION_TTL_SECONDS: 3600,
  OPSTAGE_HOST: "127.0.0.1",
  OPSTAGE_PORT: 0
};

let cleanup: Array<() => Promise<void>> = [];

beforeEach(() => {
  cleanup = [];
});

afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

async function createBackendAndRegistrationToken() {
  const app = await buildApp({ logger: false, config });
  cleanup.push(() => app.close());
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
    payload: { name: "sdk token" }
  });
  const url = await app.listen({ port: 0, host: "127.0.0.1" });
  return { app, backendUrl: url, registrationToken: tokenRes.json().data.token as string, cookie, csrfToken };
}

describe("CapsuleAgent", () => {
  it("registers, reports service, polls command, dispatches action, and reports result", async () => {
    const { app, backendUrl, registrationToken, cookie, csrfToken } = await createBackendAndRegistrationToken();
    const dir = await mkdtemp(join(tmpdir(), "capsule-agent-test-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));

    const agent = new CapsuleAgent({
      backendUrl,
      registrationToken,
      tokenStore: { file: join(dir, "agent-token.json") },
      autoStartLoops: false,
      service: {
        code: "sdk-demo-service",
        name: "SDK Demo Service",
        version: "0.1.0",
        runtime: "nodejs"
      }
    });

    agent.health(() => ({ status: "UP", message: "ok" }));
    agent.configs(() => [{ key: "sdk.message", type: "string", editable: false, sensitive: false, valuePreview: "hello" }]);
    agent.action({
      name: "echo",
      label: "Echo",
      dangerLevel: "LOW",
      handler: async payload => ({ success: true, message: "echoed", data: { payload } })
    });

    await agent.start();
    const services = await app.inject({ method: "GET", url: "/api/admin/capsule-services", cookies: { opstage_session: cookie.value } });
    expect(services.statusCode).toBe(200);
    const serviceId = services.json().data[0].id as string;

    const createCommand = await app.inject({
      method: "POST",
      url: `/api/admin/capsule-services/${serviceId}/actions/echo`,
      cookies: { opstage_session: cookie.value },
      headers: { "x-csrf-token": csrfToken },
      payload: { payload: { message: "hello" } }
    });
    expect(createCommand.statusCode).toBe(200);
    const commandId = createCommand.json().data.id as string;

    const polled = await agent.pollOnce();
    expect(polled).toHaveLength(1);
    expect(polled[0]!.id).toBe(commandId);

    const detail = await app.inject({ method: "GET", url: `/api/admin/commands/${commandId}`, cookies: { opstage_session: cookie.value } });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.status).toBe("SUCCEEDED");
    expect(detail.json().data.result.data.payload.message).toBe("hello");
    await agent.stop();
  });

  it("reports failed command result for missing handler", async () => {
    const { app, backendUrl, registrationToken, cookie, csrfToken } = await createBackendAndRegistrationToken();
    const agent = new CapsuleAgent({
      backendUrl,
      registrationToken,
      autoStartLoops: false,
      service: { code: "sdk-missing-handler-service", name: "Missing Handler", runtime: "nodejs" }
    });
    agent.action({ name: "known", label: "Known", dangerLevel: "LOW", handler: () => ({ success: true }) });
    await agent.start();
    const services = await app.inject({ method: "GET", url: "/api/admin/capsule-services", cookies: { opstage_session: cookie.value } });
    const serviceId = services.json().data[0].id as string;
    await app.inject({
      method: "POST",
      url: `/api/admin/capsule-services/${serviceId}/actions/known`,
      cookies: { opstage_session: cookie.value },
      headers: { "x-csrf-token": csrfToken },
      payload: {}
    });
    const commands = await agent.pollOnce();
    expect(commands).toHaveLength(1);
    await agent.stop();
  });
});
