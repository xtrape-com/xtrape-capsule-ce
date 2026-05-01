import { existsSync, readFileSync } from "node:fs";

const forbidden = ["packages/contracts", "packages/agent-node"];
for (const path of forbidden) {
  if (existsSync(path)) {
    console.error(`${path} must not exist in xtrape-capsule-ce; it is an external package by ADR-0008.`);
    process.exit(1);
  }
}

const backendPkg = JSON.parse(readFileSync("apps/opstage-backend/package.json", "utf8"));
const demoPkg = JSON.parse(readFileSync("apps/demo-capsule-service/package.json", "utf8"));
if (backendPkg.dependencies?.["@xtrape/capsule-contracts-node"] !== "^0.1.0") {
  console.error("Backend must consume @xtrape/capsule-contracts-node from npm semver ^0.1.0.");
  process.exit(1);
}
if (demoPkg.dependencies?.["@xtrape/capsule-agent-node"] !== "^0.1.0") {
  console.error("Demo capsule service must consume @xtrape/capsule-agent-node from npm semver ^0.1.0.");
  process.exit(1);
}

const workspace = readFileSync("pnpm-workspace.yaml", "utf8");
if (!workspace.includes("packages/*")) {
  console.error("pnpm-workspace.yaml should still include CE-owned packages/* (db/shared/test-utils).");
  process.exit(1);
}

console.log("External contract/package boundary check passed.");
