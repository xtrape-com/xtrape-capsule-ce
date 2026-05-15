import { existsSync, readFileSync } from "node:fs";

const allowedExternalRange = /^(\^0\.1\.0-public-review\.\d+|\^0\.[123]\.0)$/;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assertExternalDependency({ file, section, name }) {
  const pkg = readJson(file);
  const value = pkg[section]?.[name];

  if (value === undefined) {
    console.error(`${file} must declare ${name} in ${section}.`);
    process.exit(1);
  }

  if (value === "workspace:*") {
    console.error(`${file} must consume ${name} from npm during Public Review, not workspace:*.`);
    process.exit(1);
  }

  if (!allowedExternalRange.test(value)) {
    console.error(`${file} must use ${name} range ^0.1.0-public-review.x, ^0.1.0, ^0.2.0, or ^0.3.0; found ${value}.`);
    process.exit(1);
  }
}

assertExternalDependency({
  file: "package.json",
  section: "devDependencies",
  name: "@xtrape/capsule-agent-node",
});
assertExternalDependency({
  file: "apps/opstage-backend/package.json",
  section: "dependencies",
  name: "@xtrape/capsule-contracts-node",
});
assertExternalDependency({
  file: "apps/demo-capsule-service/package.json",
  section: "dependencies",
  name: "@xtrape/capsule-agent-node",
});

for (const path of ["packages/contracts", "packages/agent-node"]) {
  if (existsSync(path)) {
    console.error(`${path} is a stale external package mirror and must not exist in CE.`);
    process.exit(1);
  }
}

const workspaceContent = readFileSync("pnpm-workspace.yaml", "utf8");
for (const required of ["apps/*", "packages/*"]) {
  if (!workspaceContent.includes(required)) {
    console.error(`pnpm-workspace.yaml must include ${required}.`);
    process.exit(1);
  }
}

for (const stale of ["xtrape-capsule-contracts-node", "xtrape-capsule-agent-node"]) {
  if (workspaceContent.includes(stale)) {
    console.error(`pnpm-workspace.yaml must not include nonexistent path ${stale}.`);
    process.exit(1);
  }
}

console.log("Public Review npm package dependency check passed.");
