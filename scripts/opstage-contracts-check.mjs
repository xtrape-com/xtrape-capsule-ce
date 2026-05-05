import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const docsDir = resolve(process.env.XTRAPE_CAPSULE_DOCS_DIR ?? "../xtrape-capsule-docs");
const openapiPath = resolve(docsDir, "09-contracts/openapi/opstage-ce-v0.1.yaml");
const errorsPath = resolve(docsDir, "09-contracts/errors.json");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) fail(`Contract check failed: ${message}`);
}

function assertIncludes(text, needle, label) {
  assert(text.includes(needle), `missing ${label}: ${needle}`);
}

function lineIndent(line) {
  return line.match(/^ */)?.[0].length ?? 0;
}

function extractBlock(text, header, indent) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(line => line === `${" ".repeat(indent)}${header}`);
  if (start < 0) return "";
  const block = [lines[start]];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() && lineIndent(line) <= indent) break;
    block.push(line);
  }
  return block.join("\n");
}

function extractPath(text, path) {
  return extractBlock(text, `${path}:`, 2);
}

function extractMethod(pathBlock, method) {
  return extractBlock(pathBlock, `${method}:`, 4);
}

function extractSchema(text, schemaName) {
  return extractBlock(text, `${schemaName}:`, 4);
}

function assertPathMethod(openapi, { path, method, operationId, responses = [], includes = [] }) {
  const pathBlock = extractPath(openapi, path);
  assert(pathBlock, `OpenAPI path missing: ${path}`);
  const methodBlock = extractMethod(pathBlock, method);
  assert(methodBlock, `OpenAPI method missing: ${method.toUpperCase()} ${path}`);
  assertIncludes(methodBlock, `operationId: ${operationId}`, `${method.toUpperCase()} ${path} operationId`);
  for (const response of responses) assertIncludes(methodBlock, `'${response}':`, `${method.toUpperCase()} ${path} response ${response}`);
  for (const needle of includes) assertIncludes(methodBlock, needle, `${method.toUpperCase()} ${path}`);
}

function assertSchema(openapi, schemaName, requiredProperties = []) {
  const schemaBlock = extractSchema(openapi, schemaName);
  assert(schemaBlock, `OpenAPI schema missing: ${schemaName}`);
  for (const property of requiredProperties) assertIncludes(schemaBlock, `${property}:`, `${schemaName}.${property}`);
}

if (!existsSync(openapiPath) || !existsSync(errorsPath)) {
  fail(`Contract files not found. Set XTRAPE_CAPSULE_DOCS_DIR or place xtrape-capsule-docs next to this repo. Looked in: ${docsDir}`);
}

const openapi = readFileSync(openapiPath, "utf8");
const errors = JSON.parse(readFileSync(errorsPath, "utf8"));






assertPathMethod(openapi, {
  path: "/api/admin/users",
  method: "get",
  operationId: "listUsers",
  responses: ["200", "401", "403", "422"],
  includes: ["name: role", "owner", "operator", "viewer", "name: q", "maxLength: 160"]
});

assertPathMethod(openapi, {
  path: "/api/admin/users",
  method: "post",
  operationId: "createUser",
  responses: ["200", "401", "403", "409", "422"],
  includes: ["CreateUserRequest", "CsrfToken", "operator", "viewer"]
});

assertPathMethod(openapi, {
  path: "/api/admin/users/{userId}",
  method: "patch",
  operationId: "updateUser",
  responses: ["200", "401", "403", "404", "409", "422"],
  includes: ["UpdateUserRequest", "UserId", "LAST_OWNER_REQUIRED"]
});

assertPathMethod(openapi, {
  path: "/api/admin/users/{userId}/reset-password",
  method: "post",
  operationId: "resetUserPassword",
  responses: ["200", "401", "403", "404", "422"],
  includes: ["ResetUserPasswordRequest"]
});

assertPathMethod(openapi, {
  path: "/api/admin/registration-tokens",
  method: "get",
  operationId: "listRegistrationTokens",
  responses: ["200", "401", "422"],
  includes: ["TokenStatus", "name: status"]
});

assertPathMethod(openapi, {
  path: "/api/admin/agents",
  method: "get",
  operationId: "listAgents",
  responses: ["200", "401", "422"],
  includes: ["AgentStatus", "name: q", "maxLength: 120"]
});

assertPathMethod(openapi, {
  path: "/api/admin/capsule-services",
  method: "get",
  operationId: "listCapsuleServices",
  responses: ["200", "401", "422"],
  includes: ["CapsuleServiceStatus", "HealthStatus", "name: agentId", "name: q", "maxLength: 120"]
});

assertPathMethod(openapi, {
  path: "/api/admin/audit-events",
  method: "get",
  operationId: "listAuditEvents",
  responses: ["200", "401", "422"],
  includes: ["AuditActorType", "AuditResult", "name: targetId", "name: from", "name: to", "format: date-time"]
});

assertPathMethod(openapi, {
  path: "/api/admin/commands",
  method: "get",
  operationId: "listCommands",
  responses: ["200", "401", "422"],
  includes: ["name: type", "ACTION_EXECUTE", "ACTION_PREPARE", "name: actionName", "name: serviceId", "name: agentId", "Command"]
});

assertPathMethod(openapi, {
  path: "/api/admin/capsule-services/{serviceId}/actions/{actionName}",
  method: "get",
  operationId: "prepareActionPanel",
  responses: ["200", "401", "404", "409"],
  includes: ["ActionPrepareResponse", "ACTION_PREPARE"]
});

assertPathMethod(openapi, {
  path: "/api/admin/metrics",
  method: "get",
  operationId: "getAdminMetrics",
  responses: ["200", "401"],
  includes: ["AdminMetrics"]
});

assertPathMethod(openapi, {
  path: "/api/agents/{agentId}/commands",
  method: "get",
  operationId: "pollAgentCommands",
  responses: ["200", "401", "403", "404"],
  includes: ["maximum: 10"]
});

assertPathMethod(openapi, {
  path: "/api/agents/{agentId}/commands/{commandId}/result",
  method: "post",
  operationId: "reportCommandResult",
  responses: ["200", "401", "403", "409", "413"],
  includes: ["PayloadTooLarge", "OPSTAGE_COMMAND_RESULT_MAX_BYTES"]
});

assertSchema(openapi, "ActionPrepareResponse", ["action", "initialPayload"]);
assertSchema(openapi, "CreateUserRequest", ["username", "password", "role"]);
assertSchema(openapi, "UpdateUserRequest", ["displayName", "role", "status"]);
assertSchema(openapi, "ResetUserPasswordRequest", ["password"]);
assertSchema(openapi, "AdminMetrics", ["totals", "byStatus", "operational"]);
assertSchema(openapi, "OperationalMetrics", [
  "agentCommandPolls",
  "commandsDispatched",
  "commandsCompleted",
  "commandsFailed",
  "actionPrepareRequested",
  "actionPrepareTimeouts",
  "actionPrepareFailures",
  "oversizedCommandResultsRejected"
]);
assertSchema(openapi, "PayloadTooLarge");

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
assert(Array.isArray(errors.groups), "errors.json groups must be an array");
const allCodes = new Set(errors.groups.flatMap(group => Array.isArray(group.codes) ? group.codes.map(code => code.code) : []));
for (const code of requiredCodes) {
  assert(allCodes.has(code), `errors.json missing ${code}`);
}

console.log(`Opstage structured contract check passed using ${docsDir}.`);
