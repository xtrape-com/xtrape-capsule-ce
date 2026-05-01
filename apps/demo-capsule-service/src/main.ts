import { CapsuleAgent } from "@xtrape/capsule-agent-node";

const backendUrl = process.env.OPSTAGE_BACKEND_URL ?? "http://localhost:8080";
const registrationToken = process.env.OPSTAGE_REGISTRATION_TOKEN;
const tokenFile = process.env.CAPSULE_AGENT_TOKEN_FILE ?? "./data/agent-token.json";
const autoStartLoops = process.env.CAPSULE_AGENT_AUTOSTART_LOOPS !== "false";

if (!registrationToken) {
  console.warn("[demo-capsule-service] OPSTAGE_REGISTRATION_TOKEN is not set. A stored Agent token must already exist or registration will fail.");
}

const agent = new CapsuleAgent({
  backendUrl,
  registrationToken,
  tokenStore: {
    file: tokenFile
  },
  autoStartLoops,
  service: {
    code: process.env.DEMO_SERVICE_CODE ?? "demo-capsule-service",
    name: process.env.DEMO_SERVICE_NAME ?? "Demo Capsule Service",
    description: "A demo Capsule Service for Opstage CE.",
    version: "0.1.0",
    runtime: "nodejs",
    manifest: {
      kind: "CapsuleService",
      code: process.env.DEMO_SERVICE_CODE ?? "demo-capsule-service",
      name: process.env.DEMO_SERVICE_NAME ?? "Demo Capsule Service",
      description: "A demo Capsule Service for Opstage CE.",
      version: "0.1.0",
      runtime: "nodejs"
    }
  }
});

agent.health(async () => ({
  status: "UP",
  message: "Demo service is healthy.",
  details: {
    uptimeSeconds: Math.floor(process.uptime())
  }
}));

agent.configs(() => [
  {
    key: "demo.message",
    label: "Demo Message",
    type: "string",
    source: "env",
    editable: false,
    sensitive: false,
    valuePreview: process.env.DEMO_MESSAGE ?? "hello capsule"
  },
  {
    key: "demo.secretRef",
    label: "Demo Secret Reference",
    type: "string",
    source: "env",
    editable: false,
    sensitive: true,
    secretRef: "env:DEMO_SECRET"
  }
]);

agent.action({
  name: "echo",
  label: "Echo",
  description: "Returns the submitted payload.",
  dangerLevel: "LOW",
  requiresConfirmation: false,
  handler: async payload => ({
    success: true,
    message: "Echo completed.",
    data: payload ?? {}
  })
});

agent.action({
  name: "runHealthCheck",
  label: "Run Health Check",
  description: "Runs the registered health provider immediately.",
  dangerLevel: "LOW",
  requiresConfirmation: false,
  handler: async () => ({
    success: true,
    message: "Health check completed.",
    data: await agent.runHealth()
  })
});

await agent.start();
console.log(`[demo-capsule-service] started. backendUrl=${backendUrl} tokenFile=${tokenFile} autoStartLoops=${autoStartLoops}`);

const shutdown = async () => {
  console.log("[demo-capsule-service] stopping...");
  await agent.stop();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
