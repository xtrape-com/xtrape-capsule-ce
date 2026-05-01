import { readFileSync } from "node:fs";
import { parse } from "yaml";

const spec = parse(readFileSync(new URL("../openapi/opstage-ce-v0.1.yaml", import.meta.url), "utf8"));
const requiredPaths = [
  "/api/admin/auth/login",
  "/api/admin/dashboard/summary",
  "/api/admin/capsule-services",
  "/api/agents/register",
  "/api/agents/{agentId}/commands",
  "/api/system/health"
];
for (const path of requiredPaths) {
  if (!spec.paths?.[path]) {
    throw new Error(`Missing OpenAPI path: ${path}`);
  }
}
console.log("OpenAPI contract parsed successfully.");
