import { readFileSync } from "node:fs";

const backendPkg = JSON.parse(readFileSync("apps/opstage-backend/package.json", "utf8"));
const demoPkg = JSON.parse(readFileSync("apps/demo-capsule-service/package.json", "utf8"));
const rootPkg = JSON.parse(readFileSync("package.json", "utf8"));

if (rootPkg.devDependencies?.["@xtrape/capsule-agent-node"] !== "workspace:*") {
  console.error("Root dev dependency must use @xtrape/capsule-agent-node workspace:* until npm publication.");
  process.exit(1);
}
if (backendPkg.dependencies?.["@xtrape/capsule-contracts-node"] !== "workspace:*") {
  console.error("Backend must consume @xtrape/capsule-contracts-node from the workspace until npm publication.");
  process.exit(1);
}
if (demoPkg.dependencies?.["@xtrape/capsule-agent-node"] !== "workspace:*") {
  console.error("Demo capsule service must consume @xtrape/capsule-agent-node from the workspace until npm publication.");
  process.exit(1);
}

const workspace = readFileSync("pnpm-workspace.yaml", "utf8");
if (!workspace.includes("packages/*")) {
  console.error("pnpm-workspace.yaml should still include CE-owned packages/* (db/shared/test-utils).");
  process.exit(1);
}

console.log("Public Review workspace package boundary check passed.");
