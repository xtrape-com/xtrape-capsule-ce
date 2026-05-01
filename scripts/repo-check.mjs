import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const required = [
  "ACCEPTANCE.md",
  "CHANGELOG.md",
  "LICENSE",
  "NOTICE",
  "README.md",
  "RELEASE.md",
  "VERSION",
  ".dockerignore",
  ".env.example",
  ".gitignore",
  "deploy/compose/docker-compose.yml",
  "deploy/docker/Dockerfile"
];

const missing = required.filter(file => !existsSync(file));
if (missing.length) {
  console.error(`Missing repository files: ${missing.join(", ")}`);
  process.exit(1);
}

const gitignore = readFileSync(".gitignore", "utf8");
for (const pattern of ["node_modules", "dist", ".env", "data"]) {
  if (!gitignore.split(/\r?\n/).includes(pattern)) {
    console.error(`.gitignore missing ${pattern}`);
    process.exit(1);
  }
}

if (existsSync(".env")) {
  console.error(".env exists in the repository working tree. Keep secrets outside commit-ready state.");
  process.exit(1);
}

const release = spawnSync("pnpm", ["release:check"], { stdio: "inherit" });
if (release.status !== 0) process.exit(release.status ?? 1);

console.log("Repository check passed.");
