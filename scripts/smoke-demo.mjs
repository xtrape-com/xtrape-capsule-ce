import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const requiredSecret = "smoke-session-secret-must-be-at-least-32-chars";
const tempDir = await mkdtemp(join(tmpdir(), "opstage-smoke-"));
const backendConfig = {
  DATABASE_URL: `file:${join(tempDir, "opstage.db")}`,
  OPSTAGE_SESSION_SECRET: requiredSecret,
  OPSTAGE_ADMIN_USERNAME: "admin@example.local",
  OPSTAGE_ADMIN_PASSWORD: "change-me-before-running",
  OPSTAGE_SESSION_TTL_SECONDS: 3600,
  OPSTAGE_HOST: "127.0.0.1",
  OPSTAGE_PORT: 0
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const { buildApp } = await import("../apps/opstage-backend/src/app.ts");
  const app = await buildApp({ logger: false, config: backendConfig });
  const backendUrl = await app.listen({ host: "127.0.0.1", port: 0 });
  try {
    const login = await app.inject({
      method: "POST",
      url: "/api/admin/auth/login",
      payload: { username: backendConfig.OPSTAGE_ADMIN_USERNAME, password: backendConfig.OPSTAGE_ADMIN_PASSWORD }
    });
    assert(login.statusCode === 200, `login failed: ${login.statusCode} ${login.body}`);
    const cookie = login.cookies.find(item => item.name === "opstage_session");
    const csrfToken = login.json().data.csrfToken;
    assert(cookie, "missing session cookie");

    const tokenRes = await app.inject({
      method: "POST",
      url: "/api/admin/registration-tokens",
      cookies: { opstage_session: cookie.value },
      headers: { "x-csrf-token": csrfToken },
      payload: { name: "smoke token" }
    });
    assert(tokenRes.statusCode === 200, `token creation failed: ${tokenRes.statusCode} ${tokenRes.body}`);
    const registrationToken = tokenRes.json().data.token;

    const tokenFile = join(tempDir, "agent-token.json");
    const { CapsuleAgent } = await import("@xtrape/capsule-agent-node");
    const agent = new CapsuleAgent({
      backendUrl,
      registrationToken,
      tokenStore: { file: tokenFile },
      autoStartLoops: false,
      service: {
        code: "demo-capsule-service",
        name: "Demo Capsule Service",
        description: "Smoke demo service",
        version: "0.1.0",
        runtime: "nodejs"
      }
    });
    agent.health(() => ({ status: "UP", message: "Smoke healthy" }));
    agent.configs(() => [
      { key: "demo.message", type: "string", editable: false, sensitive: false, valuePreview: "hello smoke" },
      { key: "demo.secretRef", type: "string", editable: false, sensitive: true, valuePreview: "do-not-store", secretRef: "env:DEMO_SECRET" }
    ]);
    agent.action({
      name: "echo",
      label: "Echo",
      dangerLevel: "LOW",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string", title: "Message", default: "hello from prepare" }
        }
      },
      handler: async payload => ({ success: true, data: payload ?? {} })
    });
    agent.action({ name: "runHealthCheck", label: "Run Health Check", dangerLevel: "LOW", handler: async () => ({ success: true, data: await agent.runHealth() }) });
    agent.action({
      name: "listThings",
      label: "List Things",
      dangerLevel: "LOW",
      category: "diagnostics",
      inputSchema: {
        type: "object",
        properties: {
          q: { type: "string", title: "Keyword", default: "" }
        }
      },
      prepare: async () => ({
        action: {
          name: "listThings",
          label: "List Things",
          dangerLevel: "LOW",
          category: "diagnostics",
          inputSchema: {
            type: "object",
            properties: {
              q: { type: "string", title: "Keyword", description: "Filter by name.", default: "" }
            }
          }
        },
        initialPayload: { q: "" },
        currentState: { totalThings: 2 }
      }),
      handler: async payload => {
        const q = String(payload?.q ?? "").toLowerCase();
        const rows = [
          { id: "thing-1", name: "Alpha", enabled: true, sizeBytes: 1536, elapsedMs: 1250 },
          { id: "thing-2", name: "Beta", enabled: false, sizeBytes: 1024 * 1024, elapsedMs: 65_000 }
        ].filter(row => !q || row.name.toLowerCase().includes(q));
        return {
          success: true,
          data: {
            things: rows,
            list: {
              title: "Things",
              emptyText: "No things",
              pageSize: 5,
              data: rows,
              columns: [
                { key: "id", label: "ID", format: "code", copyable: true },
                { key: "name", label: "Name", ellipsis: true },
                { key: "enabled", label: "Enabled", format: "boolean" },
                { key: "sizeBytes", label: "Size", format: "bytes" },
                { key: "elapsedMs", label: "Elapsed", format: "duration" }
              ],
              rowActions: [
                { label: "Echo", action: "echo", payload: { message: "$row.id" } }
              ]
            }
          }
        };
      }
    });

    await agent.start();
    const storedToken = JSON.parse(await readFile(tokenFile, "utf8"));
    assert(storedToken.agentId?.startsWith("agt_"), "agent token file missing agentId");

    const services = await app.inject({ method: "GET", url: "/api/admin/capsule-services", cookies: { opstage_session: cookie.value } });
    assert(services.statusCode === 200, `service list failed: ${services.statusCode}`);
    const service = services.json().data.find(item => item.code === "demo-capsule-service");
    assert(service, "demo service not reported");

    const prepareEchoPromise = app.inject({
      method: "GET",
      url: `/api/admin/capsule-services/${service.id}/actions/echo`,
      cookies: { opstage_session: cookie.value }
    });
    await agent.pollOnce();
    const prepareEcho = await prepareEchoPromise;
    assert(prepareEcho.statusCode === 200, `prepare echo failed: ${prepareEcho.statusCode} ${prepareEcho.body}`);
    assert(prepareEcho.json().data.action.inputSchema.properties.message.default === "hello from prepare", "prepare did not return dynamic input schema");
    assert(prepareEcho.json().data.initialPayload.message === "hello from prepare", "prepare did not return initial payload");

    const createEcho = await app.inject({
      method: "POST",
      url: `/api/admin/capsule-services/${service.id}/actions/echo`,
      cookies: { opstage_session: cookie.value },
      headers: { "x-csrf-token": csrfToken },
      payload: { payload: { message: "hello from smoke" } }
    });
    assert(createEcho.statusCode === 200, `create echo failed: ${createEcho.statusCode} ${createEcho.body}`);
    const echoCommandId = createEcho.json().data.id;
    await agent.pollOnce();
    const echoDetail = await app.inject({ method: "GET", url: `/api/admin/commands/${echoCommandId}`, cookies: { opstage_session: cookie.value } });
    assert(echoDetail.json().data.status === "SUCCEEDED", `echo did not succeed: ${echoDetail.body}`);

    const createHealth = await app.inject({
      method: "POST",
      url: `/api/admin/capsule-services/${service.id}/actions/runHealthCheck`,
      cookies: { opstage_session: cookie.value },
      headers: { "x-csrf-token": csrfToken },
      payload: {}
    });
    assert(createHealth.statusCode === 200, `create health failed: ${createHealth.statusCode} ${createHealth.body}`);
    await agent.pollOnce();
    const healthDetail = await app.inject({ method: "GET", url: `/api/admin/commands/${createHealth.json().data.id}`, cookies: { opstage_session: cookie.value } });
    assert(healthDetail.json().data.result.data.status === "UP", `health action failed: ${healthDetail.body}`);

    const prepareListPromise = app.inject({
      method: "GET",
      url: `/api/admin/capsule-services/${service.id}/actions/listThings`,
      cookies: { opstage_session: cookie.value }
    });
    await agent.pollOnce();
    const prepareList = await prepareListPromise;
    assert(prepareList.statusCode === 200, `prepare list failed: ${prepareList.statusCode} ${prepareList.body}`);
    assert(prepareList.json().data.currentState.totalThings === 2, "prepare list did not return current state");

    const createList = await app.inject({
      method: "POST",
      url: `/api/admin/capsule-services/${service.id}/actions/listThings`,
      cookies: { opstage_session: cookie.value },
      headers: { "x-csrf-token": csrfToken },
      payload: { payload: { q: "" } }
    });
    assert(createList.statusCode === 200, `create list failed: ${createList.statusCode} ${createList.body}`);
    await agent.pollOnce();
    const listDetail = await app.inject({ method: "GET", url: `/api/admin/commands/${createList.json().data.id}`, cookies: { opstage_session: cookie.value } });
    const listResult = listDetail.json().data.result.data.list;
    assert(listResult.title === "Things", `list title missing: ${listDetail.body}`);
    assert(listResult.data.length === 2, `list row count mismatch: ${listDetail.body}`);
    assert(listResult.columns.some(column => column.format === "bytes"), "list columns did not include bytes format");
    assert(listResult.rowActions[0].payload.message === "$row.id", "list row action payload template missing");

    const serviceDetail = await app.inject({ method: "GET", url: `/api/admin/capsule-services/${service.id}`, cookies: { opstage_session: cookie.value } });
    assert(!serviceDetail.body.includes("do-not-store"), "sensitive config value leaked");

    await agent.stop();
    await sleep(10);
    console.log("Smoke demo passed.");
  } finally {
    await app.close();
    await rm(tempDir, { recursive: true, force: true });
  }
}

await main();
