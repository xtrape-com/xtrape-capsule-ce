import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";

// Check that workspace mirrors exist for Public Review validation
const contractsExists = existsSync("packages/contracts");
const agentNodeExists = existsSync("packages/agent-node");

if (!contractsExists || !agentNodeExists) {
  console.error("packages/contracts and packages/agent-node must exist as workspace mirrors for Public Review validation.");
  process.exit(1);
}

// Check that CE root package uses workspace:* dependency
const rootPkg = JSON.parse(readFileSync("package.json", "utf8"));
if (rootPkg.devDependencies?.["@xtrape/capsule-agent-node"] !== "workspace:*") {
  console.error("Root dev dependency must use @xtrape/capsule-agent-node workspace:* during Public Review.");
  process.exit(1);
}

// Check that backend uses workspace:* dependency  
const backendPkg = JSON.parse(readFileSync("apps/opstage-backend/package.json", "utf8"));
if (backendPkg.dependencies?.["@xtrape/capsule-contracts-node"] !== "workspace:*") {
  console.error("Backend must consume @xtrape/capsule-contracts-node from the workspace during Public Review.");
  process.exit(1);
}

// Check that demo uses workspace:* dependency
const demoPkg = JSON.parse(readFileSync("apps/demo-capsule-service/package.json", "utf8"));
if (demoPkg.dependencies?.["@xtrape/capsule-agent-node"] !== "workspace:*") {
  console.error("Demo capsule service must consume @xtrape/capsule-agent-node from the workspace during Public Review.");
  process.exit(1);
}

// Verify workspace configuration includes packages/*
const workspaceContent = readFileSync("pnpm-workspace.yaml", "utf8");
if (!workspaceContent.includes("packages/*")) {
  console.error("pnpm-workspace.yaml should include packages/* to cover CE-owned packages.");
  process.exit(1);
}

console.log("Public Review workspace package boundary check passed.");