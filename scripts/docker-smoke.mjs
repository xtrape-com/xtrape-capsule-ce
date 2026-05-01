#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

if (!existsSync("deploy/compose/docker-compose.yml")) {
  console.error("deploy/compose/docker-compose.yml not found");
  process.exit(1);
}

const result = spawnSync("docker", ["compose", "-f", "deploy/compose/docker-compose.yml", "config"], {
  stdio: "inherit"
});
process.exit(result.status ?? 1);
