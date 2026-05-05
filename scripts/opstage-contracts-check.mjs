import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const docsDir = resolve(process.env.XTRAPE_CAPSULE_DOCS_DIR ?? "../xtrape-capsule-docs");
const openapiPath = resolve(docsDir, "09-contracts/openapi/opstage-ce-v0.1.yaml");
const errorsPath = resolve(docsDir, "09-contracts/errors.json");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function assertIncludes(text, needle, label) {
  if (!text.includes(needle)) fail(`Contract check failed: missing ${label}: ${needle}`);
}

if (!existsSync(openapiPath) || !existsSync(errorsPath)) {
  fail(`Contract files not found. Set XTRAPE_CAPSULE_DOCS_DIR or place xtrape-capsule-docs next to this repo. Looked in: ${docsDir}`);
}

const openapi = readFileSync(openapiPath, "utf8");
const errors = JSON.parse(readFileSync(errorsPath, "utf8"));

assertIncludes(openapi, "operationId: prepareActionPanel", "action prepare endpoint");
assertIncludes(openapi, "ACTION_PREPARE", "ACTION_PREPARE command type");
assertIncludes(openapi, "ActionPrepareResponse:", "ActionPrepareResponse schema");
assertIncludes(openapi, "PayloadTooLarge:", "PayloadTooLarge response");
assertIncludes(openapi, "OPSTAGE_COMMAND_RESULT_MAX_BYTES", "command result max size documentation");
assertIncludes(openapi, "maximum: 10", "agent poll command limit max 10");
assertIncludes(openapi, "'413':", "413 command result response");

const requiredCodes = [
  "ACTION_PREPARE_TIMEOUT",
  "ACTION_PREPARE_FAILED",
  "COMMAND_RESULT_TOO_LARGE",
  "COMMAND_ALREADY_COMPLETED",
  "COMMAND_NOT_RETRYABLE",
  "AGENT_NOT_READY",
  "AGENT_HEARTBEAT_STALE",
  "AGENT_NOT_AVAILABLE",
  "CSRF_INVALID",
  "REGISTRATION_TOKEN_NOT_DELETABLE",
  "LAST_OWNER_REQUIRED"
];
const allCodes = new Set(errors.groups.flatMap(group => group.codes.map(code => code.code)));
for (const code of requiredCodes) {
  if (!allCodes.has(code)) fail(`Contract check failed: errors.json missing ${code}`);
}

console.log(`Opstage contract behavior check passed using ${docsDir}.`);
