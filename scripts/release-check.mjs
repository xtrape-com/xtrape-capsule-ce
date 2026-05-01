import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const requiredFiles = ["VERSION", "CHANGELOG.md", "LICENSE", "NOTICE", "README.md", "deploy/README.md", ".env.example"];
const missing = requiredFiles.filter(file => !existsSync(file));
if (missing.length) {
  console.error(`Missing release files: ${missing.join(", ")}`);
  process.exit(1);
}

const version = readFileSync("VERSION", "utf8").trim();
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
if (pkg.version !== version) {
  console.error(`VERSION (${version}) does not match package.json (${pkg.version})`);
  process.exit(1);
}

const changelog = readFileSync("CHANGELOG.md", "utf8");
if (!changelog.includes(`## [${version}]`)) {
  console.error(`CHANGELOG.md does not contain an entry for ${version}`);
  process.exit(1);
}

const license = readFileSync("LICENSE", "utf8");
if (!license.includes("Apache License") || pkg.license !== "Apache-2.0") {
  console.error("Apache-2.0 license metadata or LICENSE file is missing.");
  process.exit(1);
}

const env = readFileSync(".env.example", "utf8");
const unsafe = ["OPSTAGE_SESSION_SECRET=replace-with-a-long-random-secret", "OPSTAGE_ADMIN_PASSWORD=change-me-before-running"];
for (const marker of unsafe) {
  if (!env.includes(marker)) {
    console.error(`.env.example should keep placeholder marker: ${marker}`);
    process.exit(1);
  }
}

const compose = spawnSync("docker", ["compose", "-f", "deploy/compose/docker-compose.yml", "config"], { stdio: "pipe", encoding: "utf8" });
if (compose.status !== 0) {
  console.error(compose.stderr || compose.stdout);
  process.exit(compose.status ?? 1);
}

console.log(`Release check passed for v${version}.`);
