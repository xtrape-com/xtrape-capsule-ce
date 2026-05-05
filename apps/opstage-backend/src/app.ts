import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import { z } from "zod";
import { adminLoginRequestSchema, agentHeartbeatRequestSchema, createActionCommandRequestSchema, createRegistrationTokenRequestSchema, createUserRequestSchema, registerAgentRequestSchema, reportCommandResultRequestSchema, resetUserPasswordRequestSchema, serviceReportRequestSchema, updateUserRequestSchema, type ReportedService } from "@xtrape/capsule-contracts-node";
import { DEFAULT_WORKSPACE, ensureDefaultWorkspace, openDatabase, type Db } from "@xtrape/capsule-db";
import { createId, hashToken, newToken, redactSecrets, safeJsonStringify } from "@xtrape/capsule-shared";
import { type AppConfig, loadConfig } from "./config.js";
import { requireOperator, requireOwner } from "./rbac.js";
import { createCsrfToken, createSessionId, hashPassword, signSessionId, verifyPassword, verifySignedSessionId } from "./security.js";
import { resolveStaticFile, staticContentType } from "./static-ui.js";

export interface BuildAppOptions {
  logger?: boolean;
  config?: Partial<AppConfig>;
  db?: Db;
}

interface UserRow {
  id: string;
  workspaceId: string;
  username: string;
  passwordHash: string;
  displayName: string | null;
  role: string;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RegistrationTokenRow {
  id: string;
  workspaceId: string;
  name: string;
  status: string;
  agentId: string | null;
  expiresAt: string | null;
  usedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AgentRow {
  id: string;
  workspaceId: string;
  code: string;
  name: string | null;
  mode: string;
  runtime: string | null;
  status: string;
  lastHeartbeatAt: string | null;
  disabledAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CapsuleServiceRow {
  id: string;
  workspaceId: string;
  agentId: string;
  code: string;
  name: string;
  description: string | null;
  version: string | null;
  runtime: string | null;
  status: string;
  healthStatus: string;
  manifestJson: string;
  lastReportedAt: string | null;
  lastHealthAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ActionDefinitionRow {
  id: string;
  workspaceId: string;
  serviceId: string;
  name: string;
  label: string;
  description: string | null;
  dangerLevel: string;
  requiresConfirmation: number;
  inputSchemaJson: string | null;
  timeoutSeconds: number | null;
  enabled: number;
  metadataJson: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CommandRow {
  id: string;
  workspaceId: string;
  agentId: string;
  serviceId: string;
  type: string;
  actionName: string;
  status: string;
  payloadJson: string | null;
  createdByUserId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
}

interface CommandResultRow {
  id: string;
  commandId: string;
  agentId: string;
  success: number;
  message: string | null;
  dataJson: string | null;
  errorJson: string | null;
  reportedAt: string;
  createdAt: string;
}


interface AuditEventRow {
  id: string;
  workspaceId: string;
  actorType: string;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  result: string;
  message: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadataJson: string | null;
  createdAt: string;
}

interface Session {
  id: string;
  userId: string;
  csrfToken: string;
  expiresAt: string;
}

interface MaintenanceResult {
  expiredRegistrationTokens: number;
  expiredCommands: number;
  offlineAgents: number;
  offlineServices: number;
  deletedAuditEvents: number;
  ranAt: string;
}

interface MaintenanceSettings {
  agentOfflineThresholdSeconds: number;
  auditRetentionDays: number;
  maintenanceIntervalSeconds: number;
}

const maintenanceSettingsSchema = z.object({
  agentOfflineThresholdSeconds: z.number().int().positive().optional(),
  auditRetentionDays: z.number().int().min(0).optional(),
  maintenanceIntervalSeconds: z.number().int().min(0).optional()
});

const commandListQuerySchema = z.object({
  status: z.enum(["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "EXPIRED", "CANCELLED"]).optional(),
  type: z.enum(["ACTION_EXECUTE", "ACTION_PREPARE"]).optional(),
  actionName: z.string().trim().min(1).max(128).optional(),
  agentId: z.string().regex(/^agt_/, "agentId must start with agt_").optional(),
  serviceId: z.string().regex(/^svc_/, "serviceId must start with svc_").optional()
});

function optionalQueryText(value: unknown): string | undefined {
  if (Array.isArray(value)) value = value[0];
  if (value === undefined || value === null || value === "") return undefined;
  return String(value);
}

function parseCommandListQuery(query: unknown): z.infer<typeof commandListQuerySchema> {
  const input = query as Record<string, unknown> | undefined;
  const result = commandListQuerySchema.safeParse({
    status: optionalQueryText(input?.status),
    type: optionalQueryText(input?.type),
    actionName: optionalQueryText(input?.actionName),
    agentId: optionalQueryText(input?.agentId),
    serviceId: optionalQueryText(input?.serviceId)
  });
  if (!result.success) {
    throw Object.assign(new Error("Command query validation failed."), {
      statusCode: 422,
      code: "VALIDATION_FAILED",
      details: { issues: result.error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })) }
    });
  }
  return result.data;
}

const sessions = new Map<string, Session>();
const ephemeralCommandSecrets = new Map<string, { generatedKey?: string; expiresAt: number }>();

function now(): string {
  return new Date().toISOString();
}

function publicUser(user: UserRow) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function publicRegistrationToken(row: RegistrationTokenRow) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    agentId: row.agentId,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function publicAgent(row: AgentRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    mode: row.mode,
    runtime: row.runtime,
    status: row.status,
    lastHeartbeatAt: row.lastHeartbeatAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function publicCapsuleService(row: CapsuleServiceRow) {
  return {
    id: row.id,
    agentId: row.agentId,
    code: row.code,
    name: row.name,
    description: row.description,
    version: row.version,
    runtime: row.runtime,
    status: row.status,
    healthStatus: row.healthStatus,
    lastReportedAt: row.lastReportedAt,
    lastHealthAt: row.lastHealthAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function publicActionDefinition(row: ActionDefinitionRow) {
  const inputSchema = jsonParse(row.inputSchemaJson);
  const metadata = jsonParse(row.metadataJson) as { category?: string; order?: number } | null;
  return {
    id: row.id,
    serviceId: row.serviceId,
    name: row.name,
    label: row.label,
    description: row.description,
    dangerLevel: row.dangerLevel,
    requiresConfirmation: Boolean(row.requiresConfirmation),
    category: metadata?.category,
    order: metadata?.order,
    inputSchema,
    timeoutSeconds: row.timeoutSeconds,
    enabled: Boolean(row.enabled),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function initialPayloadFromSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = schema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return {};
  return Object.fromEntries(Object.entries(properties as Record<string, { default?: unknown; type?: string | string[] }>).map(([key, meta]) => {
    if (meta.default !== undefined) return [key, meta.default];
    if (meta.type === "number" || meta.type === "integer") return [key, 0];
    if (meta.type === "boolean") return [key, false];
    if (meta.type === "array") return [key, []];
    if (meta.type === "object") return [key, {}];
    return [key, ""];
  }));
}

function publicCommand(row: CommandRow, options: { redactPayload?: boolean } = {}) {
  const payload = jsonParse(row.payloadJson);
  return {
    id: row.id,
    agentId: row.agentId,
    serviceId: row.serviceId,
    type: row.type,
    actionName: row.actionName,
    status: row.status,
    payload: options.redactPayload === false ? payload : redactSecrets(payload),
    createdByUserId: row.createdByUserId,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    expiresAt: row.expiresAt
  };
}

async function waitForCommandResult(db: Db, commandId: string, timeoutMs = 30_000): Promise<{ command: CommandRow; result: CommandResultRow | undefined }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const command = db.prepare("select * from commands where id = ?").get(commandId) as CommandRow | undefined;
    const result = db.prepare("select * from command_results where commandId = ?").get(commandId) as CommandResultRow | undefined;
    if (command && ["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"].includes(command.status)) return { command, result };
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const command = db.prepare("select * from commands where id = ?").get(commandId) as CommandRow | undefined;
  if (command) {
    const ts = now();
    db.prepare("update commands set status = 'EXPIRED', errorCode = ?, errorMessage = ?, completedAt = ?, updatedAt = ? where id = ? and status in ('PENDING', 'RUNNING')")
      .run("ACTION_PREPARE_TIMEOUT", "Action prepare timed out waiting for agent.", ts, ts, commandId);
  }
  throw Object.assign(new Error("Action prepare timed out waiting for agent."), {
    statusCode: 408,
    code: "ACTION_PREPARE_TIMEOUT",
    details: {
      commandId,
      commandStatus: command?.status ?? "UNKNOWN",
      actionName: command?.actionName,
      agentId: command?.agentId,
      serviceId: command?.serviceId
    }
  });
}

function publicCommandResult(row: CommandResultRow | undefined, options: { consumeEphemeralSecrets?: boolean } = {}) {
  if (!row) return null;
  const data = jsonParse(row.dataJson);
  if (options.consumeEphemeralSecrets && data && typeof data === "object" && !Array.isArray(data)) {
    const ephemeral = ephemeralCommandSecrets.get(row.commandId);
    if (ephemeral && ephemeral.expiresAt > Date.now()) {
      if (ephemeral.generatedKey) (data as Record<string, unknown>).generatedKey = ephemeral.generatedKey;
      ephemeralCommandSecrets.delete(row.commandId);
    } else if (ephemeral) {
      ephemeralCommandSecrets.delete(row.commandId);
    }
  }
  return {
    id: row.id,
    commandId: row.commandId,
    agentId: row.agentId,
    success: Boolean(row.success),
    message: row.message,
    data,
    error: jsonParse(row.errorJson),
    reportedAt: row.reportedAt,
    createdAt: row.createdAt
  };
}


function commandResultPayloadSizeBytes(body: { message?: unknown; data?: unknown; error?: unknown }): number {
  return Buffer.byteLength(safeJsonStringify({ message: body.message ?? null, data: body.data ?? {}, error: body.error ?? {} }), "utf8");
}

function assertCommandResultPayloadSize(config: AppConfig, body: { message?: unknown; data?: unknown; error?: unknown }, onReject?: () => void): void {
  const size = commandResultPayloadSizeBytes(body);
  if (size > config.OPSTAGE_COMMAND_RESULT_MAX_BYTES) {
    onReject?.();
    throw Object.assign(new Error(`Command result payload is too large (${size} bytes); max is ${config.OPSTAGE_COMMAND_RESULT_MAX_BYTES} bytes.`), { statusCode: 413, code: "COMMAND_RESULT_TOO_LARGE" });
  }
}

function pruneExpiredEphemeralCommandSecrets(): void {
  const current = Date.now();
  for (const [commandId, secret] of ephemeralCommandSecrets.entries()) {
    if (secret.expiresAt <= current) ephemeralCommandSecrets.delete(commandId);
  }
}

function stashEphemeralCommandSecrets(commandId: string, data: unknown): void {
  pruneExpiredEphemeralCommandSecrets();
  if (!data || typeof data !== "object" || Array.isArray(data)) return;
  const generatedKey = (data as Record<string, unknown>).generatedKey;
  if (typeof generatedKey === "string" && generatedKey.length > 0) {
    ephemeralCommandSecrets.set(commandId, { generatedKey, expiresAt: Date.now() + 5 * 60_000 });
  }
}


function publicAuditEvent(row: AuditEventRow) {
  return {
    id: row.id,
    actorType: row.actorType,
    actorId: row.actorId,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    result: row.result,
    message: row.message,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    metadata: jsonParse(row.metadataJson),
    createdAt: row.createdAt
  };
}

function jsonParse(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}


function likePattern(value: string): string {
  return `%${value.replace(/[\%_]/g, "\$&")}%`;
}

function getPagination(query: unknown): { page: number; pageSize: number; offset: number } {
  const input = query as Record<string, unknown> | undefined;
  const page = Math.max(1, Number(input?.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(input?.pageSize ?? 20)));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function authenticateAgent(req: FastifyRequest, db: Db, agentId: string): AgentRow {
  const authorization = req.headers.authorization ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) {
    throw Object.assign(new Error("Agent token required."), { statusCode: 401, code: "UNAUTHORIZED" });
  }
  const tokenRow = db.prepare("select * from agent_tokens where tokenHash = ? and status = 'ACTIVE' and revokedAt is null").get(hashToken(token)) as { agentId: string } | undefined;
  if (!tokenRow || tokenRow.agentId !== agentId) {
    throw Object.assign(new Error("Invalid Agent token."), { statusCode: 401, code: "UNAUTHORIZED" });
  }
  const agent = db.prepare("select * from agents where id = ?").get(agentId) as AgentRow | undefined;
  if (!agent) {
    throw Object.assign(new Error("Agent not found."), { statusCode: 404, code: "AGENT_NOT_FOUND" });
  }
  if (agent.status === "DISABLED" || agent.status === "REVOKED") {
    throw Object.assign(new Error(`Agent is ${agent.status.toLowerCase()}.`), { statusCode: 403, code: `AGENT_${agent.status}` });
  }
  db.prepare("update agent_tokens set lastUsedAt = ?, updatedAt = ? where tokenHash = ?").run(now(), now(), hashToken(token));
  return agent;
}


function assertAgentCanHandleAction(db: Db, config: AppConfig, service: CapsuleServiceRow): AgentRow {
  const agent = db.prepare("select * from agents where id = ? and workspaceId = ?").get(service.agentId, DEFAULT_WORKSPACE.id) as AgentRow | undefined;
  if (!agent) throw Object.assign(new Error("Agent not found for Capsule Service."), { statusCode: 409, code: "AGENT_NOT_FOUND" });
  if (["OFFLINE", "DISABLED", "REVOKED"].includes(agent.status)) {
    throw Object.assign(new Error(`Agent is ${agent.status.toLowerCase()}; start or reconnect the agent before running actions.`), { statusCode: 409, code: `AGENT_${agent.status}` });
  }
  if (!agent.lastHeartbeatAt) {
    throw Object.assign(new Error("Agent has not sent a heartbeat yet; wait for it to connect before running actions."), { statusCode: 409, code: "AGENT_NOT_READY" });
  }
  const lastHeartbeatMs = Date.parse(agent.lastHeartbeatAt);
  if (!Number.isFinite(lastHeartbeatMs) || Date.now() - lastHeartbeatMs > config.OPSTAGE_AGENT_OFFLINE_THRESHOLD_SECONDS * 1000) {
    throw Object.assign(new Error("Agent heartbeat is stale; wait for the agent to reconnect before running actions."), { statusCode: 409, code: "AGENT_HEARTBEAT_STALE" });
  }
  return agent;
}

function effectiveServiceStatus(healthStatus: string): string {
  if (healthStatus === "UP") return "HEALTHY";
  if (healthStatus === "DEGRADED" || healthStatus === "DOWN") return "UNHEALTHY";
  return "UNKNOWN";
}

function upsertReportedService(db: Db, agent: AgentRow, service: ReportedService): CapsuleServiceRow {
  const ts = now();
  const existing = db.prepare("select * from capsule_services where workspaceId = ? and code = ?").get(DEFAULT_WORKSPACE.id, service.code) as CapsuleServiceRow | undefined;
  const healthStatus = service.health?.status ?? "UNKNOWN";
  const serviceStatus = effectiveServiceStatus(healthStatus);
  const serviceId = existing?.id ?? createId("svc");

  if (existing) {
    db.prepare(`
      update capsule_services set
        agentId = ?, name = ?, description = ?, version = ?, runtime = ?, status = ?, healthStatus = ?,
        manifestJson = ?, lastReportedAt = ?, lastHealthAt = ?, updatedAt = ?
      where id = ?
    `).run(
      agent.id,
      service.name,
      service.description ?? null,
      service.version ?? null,
      service.runtime ?? null,
      serviceStatus,
      healthStatus,
      safeJsonStringify(redactSecrets(service.manifest)),
      ts,
      service.health ? ts : existing.lastHealthAt,
      ts,
      serviceId
    );
  } else {
    db.prepare(`
      insert into capsule_services (
        id, workspaceId, agentId, code, name, description, version, runtime, status, healthStatus,
        manifestJson, lastReportedAt, lastHealthAt, createdAt, updatedAt
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      serviceId,
      DEFAULT_WORKSPACE.id,
      agent.id,
      service.code,
      service.name,
      service.description ?? null,
      service.version ?? null,
      service.runtime ?? null,
      serviceStatus,
      healthStatus,
      safeJsonStringify(redactSecrets(service.manifest)),
      ts,
      service.health ? ts : null,
      ts,
      ts
    );
  }

  if (service.health) {
    db.prepare(`
      insert into health_reports (id, workspaceId, serviceId, agentId, status, message, detailsJson, reportedAt, createdAt)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(createId("hlr"), DEFAULT_WORKSPACE.id, serviceId, agent.id, service.health.status, service.health.message ?? null, safeJsonStringify(redactSecrets(service.health.details ?? {})), ts, ts);
  }

  db.prepare("delete from config_items where serviceId = ?").run(serviceId);
  for (const config of service.configs ?? []) {
    db.prepare(`
      insert into config_items (
        id, workspaceId, serviceId, configKey, label, type, source, editable, sensitive,
        valuePreview, defaultValue, secretRef, metadataJson, createdAt, updatedAt
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      createId("cfg"),
      DEFAULT_WORKSPACE.id,
      serviceId,
      config.key,
      config.label ?? null,
      config.type,
      config.source ?? null,
      config.editable ? 1 : 0,
      config.sensitive ? 1 : 0,
      config.sensitive ? null : config.valuePreview ?? null,
      config.sensitive ? null : config.defaultValue ?? null,
      config.secretRef ?? null,
      safeJsonStringify({}),
      ts,
      ts
    );
  }

  db.prepare("delete from action_definitions where serviceId = ?").run(serviceId);
  for (const action of service.actions ?? []) {
    db.prepare(`
      insert into action_definitions (
        id, workspaceId, serviceId, name, label, description, dangerLevel, requiresConfirmation,
        inputSchemaJson, timeoutSeconds, enabled, metadataJson, createdAt, updatedAt
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      createId("act"),
      DEFAULT_WORKSPACE.id,
      serviceId,
      action.name,
      action.label,
      action.description ?? null,
      action.dangerLevel,
      action.requiresConfirmation ? 1 : 0,
      safeJsonStringify(action.inputSchema ?? {}),
      action.timeoutSeconds ?? null,
      1,
      safeJsonStringify({ category: action.category, order: action.order }),
      ts,
      ts
    );
  }

  return db.prepare("select * from capsule_services where id = ?").get(serviceId) as CapsuleServiceRow;
}

function writeAudit(db: Db, input: {
  actorType: "USER" | "AGENT" | "SYSTEM";
  actorId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  result?: "SUCCESS" | "FAILURE";
  message?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}): void {
  db.prepare(`
    insert into audit_events (
      id, workspaceId, actorType, actorId, action, targetType, targetId, result,
      message, ipAddress, userAgent, metadataJson, createdAt
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    createId("aud"),
    DEFAULT_WORKSPACE.id,
    input.actorType,
    input.actorId ?? null,
    input.action,
    input.targetType ?? null,
    input.targetId ?? null,
    input.result ?? "SUCCESS",
    input.message ?? null,
    input.ipAddress ?? null,
    input.userAgent ?? null,
    safeJsonStringify(redactSecrets(input.metadata ?? {})),
    now()
  );
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : typeof value === "object" ? safeJsonStringify(value) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function auditExportRows(db: Db, query: { actorType?: string; result?: string; action?: string; targetType?: string } | undefined): AuditEventRow[] {
  const clauses = ["workspaceId = ?"];
  const values: unknown[] = [DEFAULT_WORKSPACE.id];
  for (const [key, value] of Object.entries({ actorType: query?.actorType, result: query?.result, action: query?.action, targetType: query?.targetType })) {
    if (value) {
      clauses.push(`${key} = ?`);
      values.push(value);
    }
  }
  const where = clauses.join(" and ");
  return db.prepare(`select * from audit_events where ${where} order by createdAt desc limit 10000`).all(...values) as AuditEventRow[];
}

function auditRowsToCsv(rows: AuditEventRow[]): string {
  const headers = ["id", "createdAt", "actorType", "actorId", "action", "targetType", "targetId", "result", "message", "metadata"];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push([
      row.id, row.createdAt, row.actorType, row.actorId, row.action, row.targetType, row.targetId, row.result, row.message, jsonParse(row.metadataJson)
    ].map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

interface RuntimeCounters {
  agentCommandPolls: number;
  oversizedCommandResultsRejected: number;
}

function collectMetrics(db: Db, counters: RuntimeCounters) {
  const count = (table: string) => (db.prepare(`select count(*) as count from ${table} where workspaceId = ?`).get(DEFAULT_WORKSPACE.id) as { count: number }).count;
  const byStatus = (table: string) => Object.fromEntries((db.prepare(`select status, count(*) as count from ${table} where workspaceId = ? group by status`).all(DEFAULT_WORKSPACE.id) as { status: string; count: number }[]).map(row => [row.status, row.count]));
  const auditActionCount = (action: string) => (db.prepare("select count(*) as count from audit_events where workspaceId = ? and action = ?").get(DEFAULT_WORKSPACE.id, action) as { count: number }).count;
  const commandErrorCount = (errorCode: string) => (db.prepare("select count(*) as count from commands where workspaceId = ? and errorCode = ?").get(DEFAULT_WORKSPACE.id, errorCode) as { count: number }).count;
  const commandTypeStatusCount = (type: string, status: string) => (db.prepare("select count(*) as count from commands where workspaceId = ? and type = ? and status = ?").get(DEFAULT_WORKSPACE.id, type, status) as { count: number }).count;
  return {
    workspace: DEFAULT_WORKSPACE,
    totals: {
      users: count("users"),
      agents: count("agents"),
      capsuleServices: count("capsule_services"),
      registrationTokens: count("registration_tokens"),
      commands: count("commands"),
      auditEvents: count("audit_events")
    },
    byStatus: {
      agents: byStatus("agents"),
      capsuleServices: byStatus("capsule_services"),
      registrationTokens: byStatus("registration_tokens"),
      commands: byStatus("commands")
    },
    operational: {
      agentCommandPolls: counters.agentCommandPolls,
      commandsDispatched: auditActionCount("command.dispatched"),
      commandsCompleted: auditActionCount("command.completed"),
      commandsFailed: auditActionCount("command.failed"),
      actionPrepareRequested: auditActionCount("service.action.prepare_requested"),
      actionPrepareTimeouts: commandErrorCount("ACTION_PREPARE_TIMEOUT"),
      actionPrepareFailures: commandTypeStatusCount("ACTION_PREPARE", "FAILED"),
      oversizedCommandResultsRejected: counters.oversizedCommandResultsRejected
    }
  };
}

function runtimeDiagnostics(db: Db, config: AppConfig) {
  const memory = process.memoryUsage();
  return {
    version: "0.1.0",
    edition: "CE",
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    uptimeSeconds: Math.floor(process.uptime()),
    pid: process.pid,
    memory,
    config: {
      host: config.OPSTAGE_HOST,
      port: config.OPSTAGE_PORT,
      databaseUrl: config.DATABASE_URL.replace(/([^:]{3})[^/]*@/, "$1***@"),
      staticDir: config.OPSTAGE_STATIC_DIR,
      backupDir: config.OPSTAGE_BACKUP_DIR,
      maintenance: getMaintenanceSettings(db, config)
    }
  };
}

function runMaintenance(db: Db, settings: MaintenanceSettings, ts = now()): MaintenanceResult {
  const expiredRegistrationTokens = db.prepare(`
    update registration_tokens
    set status = 'EXPIRED', updatedAt = ?
    where status = 'ACTIVE' and expiresAt is not null and expiresAt < ?
  `).run(ts, ts).changes;

  const expiredCommands = db.prepare(`
    update commands
    set status = 'EXPIRED', completedAt = ?, updatedAt = ?, errorCode = coalesce(errorCode, 'COMMAND_EXPIRED'), errorMessage = coalesce(errorMessage, 'Command expired before completion.')
    where status in ('PENDING', 'RUNNING') and expiresAt is not null and expiresAt < ?
  `).run(ts, ts, ts).changes;

  const staleBefore = new Date(Date.parse(ts) - settings.agentOfflineThresholdSeconds * 1000).toISOString();
  const offlineAgents = db.prepare(`
    update agents
    set status = 'OFFLINE', updatedAt = ?
    where status = 'ONLINE' and lastHeartbeatAt is not null and lastHeartbeatAt < ?
  `).run(ts, staleBefore).changes;

  const offlineServices = db.prepare(`
    update capsule_services
    set status = 'STALE', healthStatus = 'UNKNOWN', updatedAt = ?
    where agentId in (select id from agents where status = 'OFFLINE') and status not in ('OFFLINE', 'STALE')
  `).run(ts).changes;

  let deletedAuditEvents = 0;
  if (settings.auditRetentionDays > 0) {
    const auditBefore = new Date(Date.parse(ts) - settings.auditRetentionDays * 24 * 60 * 60 * 1000).toISOString();
    deletedAuditEvents = db.prepare("delete from audit_events where workspaceId = ? and createdAt < ?").run(DEFAULT_WORKSPACE.id, auditBefore).changes;
  }

  if (offlineAgents) writeAudit(db, { actorType: "SYSTEM", action: "system.agent.offline", targetType: "Workspace", targetId: DEFAULT_WORKSPACE.id, metadata: { count: offlineAgents } });
  if (offlineServices) writeAudit(db, { actorType: "SYSTEM", action: "system.service.stale", targetType: "Workspace", targetId: DEFAULT_WORKSPACE.id, metadata: { count: offlineServices } });
  if (expiredCommands) writeAudit(db, { actorType: "SYSTEM", action: "system.command.expired", targetType: "Workspace", targetId: DEFAULT_WORKSPACE.id, metadata: { count: expiredCommands } });
  if (expiredRegistrationTokens || expiredCommands || offlineAgents || offlineServices || deletedAuditEvents) {
    writeAudit(db, {
      actorType: "SYSTEM",
      action: "maintenance.run",
      targetType: "Workspace",
      targetId: DEFAULT_WORKSPACE.id,
      metadata: { expiredRegistrationTokens, expiredCommands, offlineAgents, offlineServices, deletedAuditEvents }
    });
  }

  return { expiredRegistrationTokens, expiredCommands, offlineAgents, offlineServices, deletedAuditEvents, ranAt: ts };
}

function defaultMaintenanceSettings(config: AppConfig): MaintenanceSettings {
  return {
    agentOfflineThresholdSeconds: config.OPSTAGE_AGENT_OFFLINE_THRESHOLD_SECONDS,
    auditRetentionDays: config.OPSTAGE_AUDIT_RETENTION_DAYS,
    maintenanceIntervalSeconds: config.OPSTAGE_MAINTENANCE_INTERVAL_SECONDS
  };
}

function getMaintenanceSettings(db: Db, config: AppConfig): MaintenanceSettings {
  const defaults = defaultMaintenanceSettings(config);
  const row = db.prepare("select valueJson from system_settings where key = ? and (workspaceId = ? or workspaceId is null) order by workspaceId desc limit 1").get("maintenance", DEFAULT_WORKSPACE.id) as { valueJson: string } | undefined;
  if (!row) return defaults;
  try {
    const parsed = maintenanceSettingsSchema.parse(jsonParse(row.valueJson));
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

function saveMaintenanceSettings(db: Db, config: AppConfig, patch: Partial<MaintenanceSettings>): MaintenanceSettings {
  const next = { ...getMaintenanceSettings(db, config), ...patch };
  const ts = now();
  db.prepare(`
    insert into system_settings (id, workspaceId, key, valueJson, createdAt, updatedAt)
    values (?, ?, ?, ?, ?, ?)
    on conflict(workspaceId, key) do update set valueJson = excluded.valueJson, updatedAt = excluded.updatedAt
  `).run("set_maintenance", DEFAULT_WORKSPACE.id, "maintenance", safeJsonStringify(next), ts, ts);
  return next;
}

async function bootstrapAdmin(db: Db, config: AppConfig): Promise<void> {
  const existing = db.prepare("select count(*) as count from users").get() as { count: number };
  if (existing.count > 0) return;

  if (!config.OPSTAGE_ADMIN_USERNAME || !config.OPSTAGE_ADMIN_PASSWORD) {
    throw new Error("No admin user exists. Set OPSTAGE_ADMIN_USERNAME and OPSTAGE_ADMIN_PASSWORD for first bootstrap.");
  }

  const ts = now();
  const userId = createId("usr");
  db.prepare(`
    insert into users (id, workspaceId, username, passwordHash, displayName, role, status, createdAt, updatedAt)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    DEFAULT_WORKSPACE.id,
    config.OPSTAGE_ADMIN_USERNAME,
    await hashPassword(config.OPSTAGE_ADMIN_PASSWORD),
    "Administrator",
    "owner",
    "ACTIVE",
    ts,
    ts
  );

  writeAudit(db, {
    actorType: "SYSTEM",
    action: "system.bootstrap.completed",
    targetType: "User",
    targetId: userId,
    result: "SUCCESS"
  });
}

function getSessionUser(req: FastifyRequest, db: Db, config: AppConfig): { session: Session; user: UserRow } {
  const signedSessionId = (req.cookies as Record<string, string | undefined>).opstage_session;
  const sessionSecret = config.OPSTAGE_SESSION_SECRET;
  if (!sessionSecret) {
    throw Object.assign(new Error("Authentication required."), { statusCode: 401, code: "UNAUTHORIZED" });
  }
  const sessionId = verifySignedSessionId(signedSessionId, sessionSecret);
  if (!sessionId) {
    throw Object.assign(new Error("Authentication required."), { statusCode: 401, code: "UNAUTHORIZED" });
  }
  const session = sessions.get(sessionId);
  if (!session || session.expiresAt < now()) {
    if (session) sessions.delete(sessionId);
    throw Object.assign(new Error("Authentication required."), { statusCode: 401, code: "UNAUTHORIZED" });
  }
  const user = db.prepare("select * from users where id = ? and status = 'ACTIVE'").get(session.userId) as UserRow | undefined;
  if (!user) {
    throw Object.assign(new Error("Authentication required."), { statusCode: 401, code: "UNAUTHORIZED" });
  }
  return { session, user };
}

export async function buildApp(options: BuildAppOptions = {}) {
  const baseConfig = loadConfig();
  const config: AppConfig = { ...baseConfig, ...options.config };
  if (!config.OPSTAGE_SESSION_SECRET) {
    throw new Error("OPSTAGE_SESSION_SECRET is required.");
  }
  const sessionSecret = config.OPSTAGE_SESSION_SECRET;

  const db = options.db ?? openDatabase({ databaseUrl: config.DATABASE_URL });
  ensureDefaultWorkspace(db);
  await bootstrapAdmin(db, config);

  const app = Fastify({
    logger: options.logger ?? true
  });
  const runtimeCounters: RuntimeCounters = {
    agentCommandPolls: 0,
    oversizedCommandResultsRejected: 0
  };

  app.register(cookie);

  let maintenanceTimer: NodeJS.Timeout | undefined;
  const scheduleMaintenance = () => {
    if (maintenanceTimer) clearTimeout(maintenanceTimer);
    const settings = getMaintenanceSettings(db, config);
    if (settings.maintenanceIntervalSeconds <= 0) { maintenanceTimer = undefined; return; }
    maintenanceTimer = setTimeout(() => {
      try { runMaintenance(db, getMaintenanceSettings(db, config)); } catch (error) { app.log.error(error); }
      scheduleMaintenance();
    }, settings.maintenanceIntervalSeconds * 1000);
    maintenanceTimer.unref?.();
  };
  scheduleMaintenance();

  app.addHook("onClose", async () => {
    if (maintenanceTimer) clearTimeout(maintenanceTimer);
    if (!options.db) db.close();
  });

  app.setErrorHandler((error, _request, reply) => {
    const statusCode = typeof (error as { statusCode?: unknown }).statusCode === "number" ? (error as { statusCode: number }).statusCode : 500;
    const code = typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : statusCode === 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR";
    const details = statusCode < 500 && typeof (error as { details?: unknown }).details === "object" && (error as { details?: unknown }).details !== null
      ? redactSecrets((error as { details: Record<string, unknown> }).details)
      : undefined;
    if (statusCode >= 500) app.log.error(error);
    reply.status(statusCode).send({
      success: false,
      error: {
        code,
        message: statusCode >= 500 ? "Internal server error." : (error as Error).message,
        ...(details ? { details } : {})
      }
    });
  });

  app.addHook("preHandler", async (req) => {
    if (!req.url.startsWith("/api/admin/") || req.url === "/api/admin/auth/login" || ["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
    const { session } = getSessionUser(req, db, config);
    const csrf = req.headers["x-csrf-token"];
    if (csrf !== session.csrfToken) {
      throw Object.assign(new Error("CSRF token missing or invalid."), { statusCode: 403, code: "CSRF_INVALID" });
    }
  });

  app.get("/api/system/health", async () => ({
    success: true,
    data: {
      status: "UP",
      timestamp: now()
    }
  }));

  app.get("/api/system/version", async () => ({
    success: true,
    data: {
      version: "0.1.0",
      edition: "CE"
    }
  }));

  app.post("/api/admin/auth/login", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = adminLoginRequestSchema.parse(req.body);
    const user = db.prepare("select * from users where username = ? and status = 'ACTIVE'").get(body.username) as UserRow | undefined;
    const valid = user ? await verifyPassword(body.password, user.passwordHash) : false;
    if (!user || !valid) {
      writeAudit(db, {
        actorType: "USER",
        action: "session.login.failed",
        result: "FAILURE",
        message: "Invalid login attempt",
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"] ?? null,
        metadata: { username: body.username }
      });
      throw Object.assign(new Error("Invalid username or password."), { statusCode: 401, code: "UNAUTHORIZED" });
    }

    const sessionId = createSessionId();
    const session: Session = {
      id: sessionId,
      userId: user.id,
      csrfToken: createCsrfToken(),
      expiresAt: new Date(Date.now() + config.OPSTAGE_SESSION_TTL_SECONDS * 1000).toISOString()
    };
    sessions.set(sessionId, session);
    const ts = now();
    db.prepare("update users set lastLoginAt = ?, updatedAt = ? where id = ?").run(ts, ts, user.id);
    writeAudit(db, {
      actorType: "USER",
      actorId: user.id,
      action: "session.login.succeeded",
      result: "SUCCESS",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] ?? null
    });

    reply.setCookie("opstage_session", signSessionId(sessionId, sessionSecret), {
      httpOnly: true,
      sameSite: "lax",
      secure: config.NODE_ENV === "production",
      path: "/",
      maxAge: config.OPSTAGE_SESSION_TTL_SECONDS
    });

    return {
      success: true,
      data: {
        user: publicUser({ ...user, lastLoginAt: ts, updatedAt: ts }),
        csrfToken: session.csrfToken,
        expiresAt: session.expiresAt
      }
    };
  });

  app.post("/api/admin/auth/logout", async (req, reply) => {
    const signedSessionId = (req.cookies as Record<string, string | undefined>).opstage_session;
    const sessionId = verifySignedSessionId(signedSessionId, sessionSecret);
    let userId: string | undefined;
    if (sessionId) { userId = sessions.get(sessionId)?.userId; sessions.delete(sessionId); }
    if (userId) writeAudit(db, { actorType: "USER", actorId: userId, action: "session.logout", targetType: "User", targetId: userId });
    reply.clearCookie("opstage_session", { path: "/" });
    return { success: true };
  });

  app.get("/api/admin/auth/me", async (req) => {
    const { session, user } = getSessionUser(req, db, config);
    return {
      success: true,
      data: {
        user: publicUser(user),
        csrfToken: session.csrfToken,
        expiresAt: session.expiresAt
      }
    };
  });

  app.get("/api/admin/auth/csrf", async (req) => {
    const { session, user } = getSessionUser(req, db, config);
    session.csrfToken = createCsrfToken();
    writeAudit(db, { actorType: "USER", actorId: user.id, action: "session.csrf.refreshed", targetType: "User", targetId: user.id });
    return {
      success: true,
      data: {
        csrfToken: session.csrfToken,
        expiresAt: session.expiresAt
      }
    };
  });



  app.get("/api/admin/users", async (req) => {
    const { user } = getSessionUser(req, db, config);
    requireOwner(user);
    const { page, pageSize, offset } = getPagination(req.query);
    const rows = db.prepare("select * from users where workspaceId = ? order by createdAt desc limit ? offset ?").all(DEFAULT_WORKSPACE.id, pageSize, offset) as UserRow[];
    const total = db.prepare("select count(*) as count from users where workspaceId = ?").get(DEFAULT_WORKSPACE.id) as { count: number };
    return { success: true, data: rows.map(publicUser), pagination: { page, pageSize, total: total.count } };
  });

  app.post("/api/admin/users", async (req) => {
    const { user } = getSessionUser(req, db, config);
    requireOwner(user);
    const body = createUserRequestSchema.parse(req.body ?? {});
    const existing = db.prepare("select id from users where username = ?").get(body.username) as { id: string } | undefined;
    if (existing) throw Object.assign(new Error("Username already exists."), { statusCode: 409, code: "USER_ALREADY_EXISTS" });
    const ts = now();
    const userId = createId("usr");
    db.prepare(`
      insert into users (id, workspaceId, username, passwordHash, displayName, role, status, createdAt, updatedAt)
      values (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
    `).run(userId, DEFAULT_WORKSPACE.id, body.username, await hashPassword(body.password), body.displayName ?? null, body.role, ts, ts);
    writeAudit(db, { actorType: "USER", actorId: user.id, action: "user.created", targetType: "User", targetId: userId, metadata: { username: body.username, role: body.role } });
    const row = db.prepare("select * from users where id = ?").get(userId) as UserRow;
    return { success: true, data: publicUser(row) };
  });

  app.patch("/api/admin/users/:userId", async (req) => {
    const { user } = getSessionUser(req, db, config);
    requireOwner(user);
    const userId = (req.params as { userId: string }).userId;
    const target = db.prepare("select * from users where id = ? and workspaceId = ?").get(userId, DEFAULT_WORKSPACE.id) as UserRow | undefined;
    if (!target) throw Object.assign(new Error("User not found."), { statusCode: 404, code: "USER_NOT_FOUND" });
    const body = updateUserRequestSchema.parse(req.body ?? {});
    const ownerCount = db.prepare("select count(*) as count from users where workspaceId = ? and role = 'owner' and status = 'ACTIVE'").get(DEFAULT_WORKSPACE.id) as { count: number };
    if (target.role === "owner" && target.status === "ACTIVE" && (body.role && body.role !== "owner" || body.status === "DISABLED") && ownerCount.count <= 1) {
      throw Object.assign(new Error("Cannot remove the last active owner."), { statusCode: 409, code: "LAST_OWNER_REQUIRED" });
    }
    const next = {
      displayName: body.displayName ?? target.displayName,
      role: body.role ?? target.role,
      status: body.status ?? target.status,
      updatedAt: now(),
      id: target.id
    };
    db.prepare("update users set displayName = @displayName, role = @role, status = @status, updatedAt = @updatedAt where id = @id").run(next);
    writeAudit(db, { actorType: "USER", actorId: user.id, action: "user.updated", targetType: "User", targetId: target.id, metadata: { role: next.role, status: next.status } });
    const row = db.prepare("select * from users where id = ?").get(target.id) as UserRow;
    return { success: true, data: publicUser(row) };
  });

  app.post("/api/admin/users/:userId/reset-password", async (req) => {
    const { user } = getSessionUser(req, db, config);
    requireOwner(user);
    const userId = (req.params as { userId: string }).userId;
    const target = db.prepare("select * from users where id = ? and workspaceId = ?").get(userId, DEFAULT_WORKSPACE.id) as UserRow | undefined;
    if (!target) throw Object.assign(new Error("User not found."), { statusCode: 404, code: "USER_NOT_FOUND" });
    const body = resetUserPasswordRequestSchema.parse(req.body ?? {});
    db.prepare("update users set passwordHash = ?, updatedAt = ? where id = ?").run(await hashPassword(body.password), now(), target.id);
    writeAudit(db, { actorType: "USER", actorId: user.id, action: "user.password.reset", targetType: "User", targetId: target.id });
    return { success: true, data: publicUser({ ...target, updatedAt: now() }) };
  });



  app.get("/api/admin/settings/maintenance", async (req) => {
    getSessionUser(req, db, config);
    return { success: true, data: getMaintenanceSettings(db, config) };
  });

  app.patch("/api/admin/settings/maintenance", async (req) => {
    const { user } = getSessionUser(req, db, config);
    requireOwner(user);
    const body = maintenanceSettingsSchema.parse(req.body ?? {});
    const settings = saveMaintenanceSettings(db, config, body);
    scheduleMaintenance();
    writeAudit(db, { actorType: "USER", actorId: user.id, action: "settings.maintenance.updated", targetType: "Workspace", targetId: DEFAULT_WORKSPACE.id, metadata: { ...settings } });
    return { success: true, data: settings };
  });

  app.post("/api/admin/maintenance/run", async (req) => {
    const { user } = getSessionUser(req, db, config);
    requireOperator(user);
    const result = runMaintenance(db, getMaintenanceSettings(db, config));
    writeAudit(db, { actorType: "USER", actorId: user.id, action: "maintenance.triggered", targetType: "Workspace", targetId: DEFAULT_WORKSPACE.id, metadata: { ...result } });
    return { success: true, data: result };
  });

  app.get("/api/admin/dashboard/summary", async (req) => {
    getSessionUser(req, db, config);
    const auditCount = db.prepare("select count(*) as count from audit_events where workspaceId = ?").get(DEFAULT_WORKSPACE.id) as { count: number };
    const agentCounts = Object.fromEntries((db.prepare("select status, count(*) as count from agents where workspaceId = ? group by status").all(DEFAULT_WORKSPACE.id) as { status: string; count: number }[]).map(row => [row.status, row.count]));
    const serviceCounts = Object.fromEntries((db.prepare("select status, count(*) as count from capsule_services where workspaceId = ? group by status").all(DEFAULT_WORKSPACE.id) as { status: string; count: number }[]).map(row => [row.status, row.count]));
    const commandCounts = Object.fromEntries((db.prepare("select status, count(*) as count from commands where workspaceId = ? group by status").all(DEFAULT_WORKSPACE.id) as { status: string; count: number }[]).map(row => [row.status, row.count]));
    const recentCommands = db.prepare("select * from commands where workspaceId = ? order by createdAt desc limit 10").all(DEFAULT_WORKSPACE.id) as CommandRow[];
    const recentAuditEvents = db.prepare("select * from audit_events where workspaceId = ? order by createdAt desc limit 10").all(DEFAULT_WORKSPACE.id) as AuditEventRow[];
    return {
      success: true,
      data: {
        workspace: DEFAULT_WORKSPACE,
        agentCounts,
        serviceCounts,
        commandCounts,
        auditEventCount: auditCount.count,
        recentCommands: recentCommands.map((command) => publicCommand(command)),
        recentAuditEvents: recentAuditEvents.map(publicAuditEvent)
      }
    };
  });


  app.post("/api/admin/registration-tokens", async (req) => {
    const { user } = getSessionUser(req, db, config);
    requireOperator(user);
    const body = createRegistrationTokenRequestSchema.parse(req.body ?? {});
    const token = newToken("opstage_reg_");
    const ts = now();
    const tokenId = createId("tok");
    const expiresAt = body.expiresInSeconds ? new Date(Date.now() + body.expiresInSeconds * 1000).toISOString() : null;
    db.prepare(`
      insert into registration_tokens (id, workspaceId, name, tokenHash, status, expiresAt, createdAt, updatedAt)
      values (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tokenId, DEFAULT_WORKSPACE.id, body.name, token.hash, "ACTIVE", expiresAt, ts, ts);
    writeAudit(db, {
      actorType: "USER",
      actorId: user.id,
      action: "registration_token.created",
      targetType: "RegistrationToken",
      targetId: tokenId
    });
    const row = db.prepare("select * from registration_tokens where id = ?").get(tokenId) as RegistrationTokenRow;
    return { success: true, data: { ...publicRegistrationToken(row), token: token.raw, rawToken: token.raw } };
  });

  app.get("/api/admin/registration-tokens", async (req) => {
    getSessionUser(req, db, config);
    const { page, pageSize, offset } = getPagination(req.query);
    const rows = db.prepare("select * from registration_tokens where workspaceId = ? order by createdAt desc limit ? offset ?").all(DEFAULT_WORKSPACE.id, pageSize, offset) as RegistrationTokenRow[];
    const total = db.prepare("select count(*) as count from registration_tokens where workspaceId = ?").get(DEFAULT_WORKSPACE.id) as { count: number };
    return { success: true, data: rows.map(publicRegistrationToken), pagination: { page, pageSize, total: total.count } };
  });

  app.post("/api/admin/registration-tokens/:tokenId/revoke", async (req) => {
    const { user } = getSessionUser(req, db, config);
    requireOperator(user);
    const tokenId = (req.params as { tokenId: string }).tokenId;
    const ts = now();
    db.prepare("update registration_tokens set status = 'REVOKED', revokedAt = ?, updatedAt = ? where id = ?").run(ts, ts, tokenId);
    writeAudit(db, {
      actorType: "USER",
      actorId: user.id,
      action: "registration_token.revoked",
      targetType: "RegistrationToken",
      targetId: tokenId
    });
    const row = db.prepare("select * from registration_tokens where id = ?").get(tokenId) as RegistrationTokenRow | undefined;
    if (!row) throw Object.assign(new Error("Registration token not found."), { statusCode: 404, code: "REGISTRATION_TOKEN_NOT_FOUND" });
    return { success: true, data: publicRegistrationToken(row) };
  });

  app.delete("/api/admin/registration-tokens/:tokenId", async (req) => {
    const { user } = getSessionUser(req, db, config);
    requireOperator(user);
    const tokenId = (req.params as { tokenId: string }).tokenId;
    const row = db.prepare("select * from registration_tokens where id = ? and workspaceId = ?").get(tokenId, DEFAULT_WORKSPACE.id) as RegistrationTokenRow | undefined;
    if (!row) throw Object.assign(new Error("Registration token not found."), { statusCode: 404, code: "REGISTRATION_TOKEN_NOT_FOUND" });
    if (!["EXPIRED", "REVOKED"].includes(row.status)) {
      throw Object.assign(new Error("Only expired or revoked registration tokens can be deleted."), { statusCode: 409, code: "REGISTRATION_TOKEN_NOT_DELETABLE" });
    }
    db.prepare("delete from registration_tokens where id = ?").run(tokenId);
    writeAudit(db, { actorType: "USER", actorId: user.id, action: "registration_token.deleted", targetType: "RegistrationToken", targetId: tokenId, metadata: { name: row.name, status: row.status } });
    return { success: true, data: publicRegistrationToken(row) };
  });

  app.get("/api/admin/agents", async (req) => {
    getSessionUser(req, db, config);
    const { page, pageSize, offset } = getPagination(req.query);
    const query = req.query as { status?: string; q?: string } | undefined;
    const clauses = ["workspaceId = ?"];
    const values: unknown[] = [DEFAULT_WORKSPACE.id];
    if (query?.status) { clauses.push("status = ?"); values.push(query.status); }
    if (query?.q) { clauses.push("(code like ? escape '\\' or name like ? escape '\\')"); values.push(likePattern(query.q), likePattern(query.q)); }
    const where = clauses.join(" and ");
    const rows = db.prepare(`select * from agents where ${where} order by createdAt desc limit ? offset ?`).all(...values, pageSize, offset) as AgentRow[];
    const total = db.prepare(`select count(*) as count from agents where ${where}`).get(...values) as { count: number };
    return { success: true, data: rows.map(publicAgent), pagination: { page, pageSize, total: total.count } };
  });



  app.post("/api/admin/agents/:agentId/disable", async (req) => {
    const { user } = getSessionUser(req, db, config);
    requireOperator(user);
    const agentId = (req.params as { agentId: string }).agentId;
    const agent = db.prepare("select * from agents where id = ? and workspaceId = ?").get(agentId, DEFAULT_WORKSPACE.id) as AgentRow | undefined;
    if (!agent) throw Object.assign(new Error("Agent not found."), { statusCode: 404, code: "AGENT_NOT_FOUND" });
    if (agent.status === "REVOKED") throw Object.assign(new Error("Agent is revoked."), { statusCode: 409, code: "AGENT_REVOKED" });
    const ts = now();
    db.prepare("update agents set status = 'DISABLED', disabledAt = ?, updatedAt = ? where id = ?").run(ts, ts, agent.id);
    writeAudit(db, { actorType: "USER", actorId: user.id, action: "agent.disabled", targetType: "Agent", targetId: agent.id });
    const row = db.prepare("select * from agents where id = ?").get(agent.id) as AgentRow;
    return { success: true, data: publicAgent(row) };
  });

  app.post("/api/admin/agents/:agentId/enable", async (req) => {
    const { user } = getSessionUser(req, db, config);
    requireOperator(user);
    const agentId = (req.params as { agentId: string }).agentId;
    const agent = db.prepare("select * from agents where id = ? and workspaceId = ?").get(agentId, DEFAULT_WORKSPACE.id) as AgentRow | undefined;
    if (!agent) throw Object.assign(new Error("Agent not found."), { statusCode: 404, code: "AGENT_NOT_FOUND" });
    if (agent.status === "REVOKED") throw Object.assign(new Error("Agent is revoked."), { statusCode: 409, code: "AGENT_REVOKED" });
    const ts = now();
    db.prepare("update agents set status = 'ONLINE', disabledAt = null, updatedAt = ? where id = ?").run(ts, agent.id);
    writeAudit(db, { actorType: "USER", actorId: user.id, action: "agent.enabled", targetType: "Agent", targetId: agent.id });
    const row = db.prepare("select * from agents where id = ?").get(agent.id) as AgentRow;
    return { success: true, data: publicAgent(row) };
  });

  app.post("/api/admin/agents/:agentId/revoke", async (req) => {
    const { user } = getSessionUser(req, db, config);
    requireOperator(user);
    const agentId = (req.params as { agentId: string }).agentId;
    const agent = db.prepare("select * from agents where id = ? and workspaceId = ?").get(agentId, DEFAULT_WORKSPACE.id) as AgentRow | undefined;
    if (!agent) throw Object.assign(new Error("Agent not found."), { statusCode: 404, code: "AGENT_NOT_FOUND" });
    const ts = now();
    db.prepare("update agents set status = 'REVOKED', revokedAt = ?, updatedAt = ? where id = ?").run(ts, ts, agent.id);
    db.prepare("update agent_tokens set status = 'REVOKED', revokedAt = ?, updatedAt = ? where agentId = ? and status = 'ACTIVE'").run(ts, ts, agent.id);
    writeAudit(db, { actorType: "USER", actorId: user.id, action: "agent.revoked", targetType: "Agent", targetId: agent.id });
    const row = db.prepare("select * from agents where id = ?").get(agent.id) as AgentRow;
    return { success: true, data: publicAgent(row) };
  });

  app.get("/api/admin/agents/:agentId", async (req) => {
    getSessionUser(req, db, config);
    const agentId = (req.params as { agentId: string }).agentId;
    const row = db.prepare("select * from agents where id = ? and workspaceId = ?").get(agentId, DEFAULT_WORKSPACE.id) as AgentRow | undefined;
    if (!row) throw Object.assign(new Error("Agent not found."), { statusCode: 404, code: "AGENT_NOT_FOUND" });
    const services = db.prepare("select * from capsule_services where agentId = ? order by createdAt desc").all(agentId) as CapsuleServiceRow[];
    return { success: true, data: { ...publicAgent(row), services: services.map(publicCapsuleService) } };
  });

  app.get("/api/admin/capsule-services", async (req) => {
    getSessionUser(req, db, config);
    const { page, pageSize, offset } = getPagination(req.query);
    const query = req.query as { status?: string; healthStatus?: string; q?: string } | undefined;
    const clauses = ["workspaceId = ?"];
    const values: unknown[] = [DEFAULT_WORKSPACE.id];
    if (query?.status) { clauses.push("status = ?"); values.push(query.status); }
    if (query?.healthStatus) { clauses.push("healthStatus = ?"); values.push(query.healthStatus); }
    if (query?.q) { clauses.push("(code like ? escape '\\' or name like ? escape '\\')"); values.push(likePattern(query.q), likePattern(query.q)); }
    const where = clauses.join(" and ");
    const rows = db.prepare(`select * from capsule_services where ${where} order by createdAt desc limit ? offset ?`).all(...values, pageSize, offset) as CapsuleServiceRow[];
    const total = db.prepare(`select count(*) as count from capsule_services where ${where}`).get(...values) as { count: number };
    return { success: true, data: rows.map(publicCapsuleService), pagination: { page, pageSize, total: total.count } };
  });

  app.get("/api/admin/capsule-services/:serviceId", async (req) => {
    getSessionUser(req, db, config);
    const serviceId = (req.params as { serviceId: string }).serviceId;
    const row = db.prepare("select * from capsule_services where id = ? and workspaceId = ?").get(serviceId, DEFAULT_WORKSPACE.id) as CapsuleServiceRow | undefined;
    if (!row) throw Object.assign(new Error("Capsule Service not found."), { statusCode: 404, code: "CAPSULE_SERVICE_NOT_FOUND" });
    const configs = db.prepare("select * from config_items where serviceId = ? order by configKey asc").all(serviceId);
    const actions = db.prepare("select * from action_definitions where serviceId = ? order by name asc").all(serviceId) as ActionDefinitionRow[];
    const health = db.prepare("select * from health_reports where serviceId = ? order by reportedAt desc limit 1").get(serviceId) as { status: string; message: string | null; detailsJson: string | null; reportedAt: string } | undefined;
    return {
      success: true,
      data: {
        ...publicCapsuleService(row),
        manifest: jsonParse(row.manifestJson),
        health: health ? { ...health, details: jsonParse(health.detailsJson) } : null,
        configs,
        actions: actions.map(publicActionDefinition)
      }
    };
  });

  app.post("/api/agents/register", async (req) => {
    const body = registerAgentRequestSchema.parse(req.body);
    const tokenHash = hashToken(body.registrationToken);
    const registrationToken = db.prepare("select * from registration_tokens where tokenHash = ?").get(tokenHash) as RegistrationTokenRow | undefined;
    if (!registrationToken || registrationToken.status !== "ACTIVE" || registrationToken.revokedAt || (registrationToken.expiresAt && registrationToken.expiresAt < now())) {
      throw Object.assign(new Error("Invalid registration token."), { statusCode: 401, code: "REGISTRATION_TOKEN_INVALID" });
    }

    const ts = now();
    const existing = db.prepare("select * from agents where workspaceId = ? and code = ?").get(DEFAULT_WORKSPACE.id, body.agent.code) as AgentRow | undefined;
    const agentId = existing?.id ?? createId("agt");
    if (existing) {
      db.prepare("update agents set name = ?, mode = ?, runtime = ?, status = 'ONLINE', lastHeartbeatAt = ?, updatedAt = ? where id = ?").run(body.agent.name ?? null, body.agent.mode, body.agent.runtime ?? null, ts, ts, agentId);
    } else {
      db.prepare(`
        insert into agents (id, workspaceId, code, name, mode, runtime, status, lastHeartbeatAt, createdAt, updatedAt)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(agentId, DEFAULT_WORKSPACE.id, body.agent.code, body.agent.name ?? null, body.agent.mode, body.agent.runtime ?? null, "ONLINE", ts, ts, ts);
    }

    const agentToken = newToken("opstage_agent_");
    db.prepare("insert into agent_tokens (id, agentId, tokenHash, status, createdAt, updatedAt) values (?, ?, ?, 'ACTIVE', ?, ?)").run(createId("tok"), agentId, agentToken.hash, ts, ts);
    db.prepare("update registration_tokens set status = 'USED', agentId = ?, usedAt = ?, updatedAt = ? where id = ?").run(agentId, ts, ts, registrationToken.id);
    const agent = db.prepare("select * from agents where id = ?").get(agentId) as AgentRow;
    if (body.service) upsertReportedService(db, agent, body.service);
    writeAudit(db, { actorType: "AGENT", actorId: agentId, action: "registration_token.consumed", targetType: "RegistrationToken", targetId: registrationToken.id });
    writeAudit(db, { actorType: "AGENT", actorId: agentId, action: "agent.registered", targetType: "Agent", targetId: agentId });
    return { success: true, data: { agentId, agentToken: agentToken.raw, heartbeatIntervalSeconds: 30, commandPollIntervalSeconds: 5 } };
  });

  app.post("/api/agents/:agentId/heartbeat", async (req) => {
    const agentId = (req.params as { agentId: string }).agentId;
    const agent = authenticateAgent(req, db, agentId);
    const body = agentHeartbeatRequestSchema.parse(req.body ?? {});
    const ts = now();
    db.prepare("update agents set status = 'ONLINE', lastHeartbeatAt = ?, updatedAt = ? where id = ?").run(ts, ts, agent.id);
    if (body.serviceId && body.health) {
      const service = db.prepare("select * from capsule_services where id = ? and agentId = ?").get(body.serviceId, agent.id) as CapsuleServiceRow | undefined;
      if (service) {
        db.prepare("insert into health_reports (id, workspaceId, serviceId, agentId, status, message, detailsJson, reportedAt, createdAt) values (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(createId("hlr"), DEFAULT_WORKSPACE.id, service.id, agent.id, body.health.status, body.health.message ?? null, safeJsonStringify(redactSecrets(body.health.details ?? {})), ts, ts);
        db.prepare("update capsule_services set healthStatus = ?, status = ?, lastHealthAt = ?, updatedAt = ? where id = ?").run(body.health.status, effectiveServiceStatus(body.health.status), ts, ts, service.id);
      }
    }
    return { success: true, data: { heartbeatIntervalSeconds: 30, commandPollIntervalSeconds: 5 } };
  });

  app.post("/api/agents/:agentId/services/report", async (req) => {
    const agentId = (req.params as { agentId: string }).agentId;
    const agent = authenticateAgent(req, db, agentId);
    const body = serviceReportRequestSchema.parse(req.body);
    const upserted = body.services.map(service => upsertReportedService(db, agent, service));
    const services = upserted.map(publicCapsuleService);
    for (const svc of upserted) {
      writeAudit(db, { actorType: "AGENT", actorId: agentId, action: "service.reported", targetType: "CapsuleService", targetId: svc.id });
    }
    return { success: true, data: { services } };
  });

  app.get("/api/admin/capsule-services/:serviceId/actions/:actionName", async (req) => {
    const { user } = getSessionUser(req, db, config);
    const params = req.params as { serviceId: string; actionName: string };
    const service = db.prepare("select * from capsule_services where id = ? and workspaceId = ?").get(params.serviceId, DEFAULT_WORKSPACE.id) as CapsuleServiceRow | undefined;
    if (!service) throw Object.assign(new Error("Capsule Service not found."), { statusCode: 404, code: "CAPSULE_SERVICE_NOT_FOUND" });
    const action = db.prepare("select * from action_definitions where serviceId = ? and name = ? and enabled = 1").get(service.id, params.actionName) as ActionDefinitionRow | undefined;
    if (!action) throw Object.assign(new Error("Action not found."), { statusCode: 404, code: "ACTION_NOT_FOUND" });
    assertAgentCanHandleAction(db, config, service);
    const ts = now();
    const commandId = createId("cmd");
    db.prepare(`
      insert into commands (
        id, workspaceId, agentId, serviceId, type, actionName, status, payloadJson,
        createdByUserId, createdAt, updatedAt
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(commandId, DEFAULT_WORKSPACE.id, service.agentId, service.id, "ACTION_PREPARE", action.name, "PENDING", safeJsonStringify({}), user.id, ts, ts);
    writeAudit(db, { actorType: "USER", actorId: user.id, action: "service.action.prepare_requested", targetType: "CapsuleService", targetId: service.id, metadata: { actionName: action.name, commandId } });
    const { command, result } = await waitForCommandResult(db, commandId);
    if (!result || !result.success) {
      throw Object.assign(new Error(result?.message ?? command.errorMessage ?? "Action prepare failed."), {
        statusCode: 424,
        code: command.errorCode ?? "ACTION_PREPARE_FAILED",
        details: {
          commandId: command.id,
          commandStatus: command.status,
          actionName: command.actionName,
          agentId: command.agentId,
          serviceId: command.serviceId
        }
      });
    }
    const data = jsonParse(result.dataJson) as Record<string, unknown>;
    const catalogAction = publicActionDefinition(action);
    const dynamicAction = data.action && typeof data.action === "object" && !Array.isArray(data.action) ? data.action as Record<string, unknown> : {};
    const preparedAction = {
      ...catalogAction,
      ...dynamicAction,
      id: catalogAction.id,
      serviceId: catalogAction.serviceId,
      name: catalogAction.name,
      enabled: catalogAction.enabled,
      createdAt: catalogAction.createdAt,
      updatedAt: catalogAction.updatedAt
    };
    return {
      success: true,
      data: {
        action: preparedAction,
        initialPayload: data.initialPayload ?? initialPayloadFromSchema(preparedAction.inputSchema),
        currentState: data.currentState ?? {},
        prepareCommand: { ...publicCommand(command), result: publicCommandResult(result) }
      }
    };
  });


  app.post("/api/admin/capsule-services/:serviceId/actions/:actionName", async (req) => {
    const { user } = getSessionUser(req, db, config);
    requireOperator(user);
    const params = req.params as { serviceId: string; actionName: string };
    const body = createActionCommandRequestSchema.parse(req.body ?? {});
    const service = db.prepare("select * from capsule_services where id = ? and workspaceId = ?").get(params.serviceId, DEFAULT_WORKSPACE.id) as CapsuleServiceRow | undefined;
    if (!service) throw Object.assign(new Error("Capsule Service not found."), { statusCode: 404, code: "CAPSULE_SERVICE_NOT_FOUND" });
    const action = db.prepare("select * from action_definitions where serviceId = ? and name = ? and enabled = 1").get(service.id, params.actionName) as ActionDefinitionRow | undefined;
    if (!action) throw Object.assign(new Error("Action not found."), { statusCode: 404, code: "ACTION_NOT_FOUND" });
    if (action.requiresConfirmation && body.confirmation !== true) {
      throw Object.assign(new Error("Action requires confirmation."), { statusCode: 409, code: "ACTION_REQUIRES_CONFIRMATION" });
    }
    assertAgentCanHandleAction(db, config, service);
    const ts = now();
    const commandId = createId("cmd");
    const expiresAt = action.timeoutSeconds ? new Date(Date.now() + action.timeoutSeconds * 1000).toISOString() : null;
    db.prepare(`
      insert into commands (
        id, workspaceId, agentId, serviceId, type, actionName, status, payloadJson,
        createdByUserId, createdAt, updatedAt, expiresAt
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(commandId, DEFAULT_WORKSPACE.id, service.agentId, service.id, "ACTION_EXECUTE", action.name, "PENDING", safeJsonStringify(body.payload ?? {}), user.id, ts, ts, expiresAt);
    writeAudit(db, { actorType: "USER", actorId: user.id, action: "service.action.requested", targetType: "CapsuleService", targetId: service.id, metadata: { actionName: action.name } });
    writeAudit(db, { actorType: "USER", actorId: user.id, action: "command.created", targetType: "Command", targetId: commandId, metadata: { serviceId: service.id, actionName: action.name } });
    const command = db.prepare("select * from commands where id = ?").get(commandId) as CommandRow;
    return { success: true, data: publicCommand(command) };
  });

  app.get("/api/admin/commands", async (req) => {
    getSessionUser(req, db, config);
    const { page, pageSize, offset } = getPagination(req.query);
    const query = parseCommandListQuery(req.query);
    const clauses = ["workspaceId = ?"];
    const values: unknown[] = [DEFAULT_WORKSPACE.id];
    for (const [key, value] of Object.entries({ status: query?.status, type: query?.type, actionName: query?.actionName, agentId: query?.agentId, serviceId: query?.serviceId })) {
      if (value) { clauses.push(`${key} = ?`); values.push(value); }
    }
    const where = clauses.join(" and ");
    const rows = db.prepare(`select * from commands where ${where} order by createdAt desc limit ? offset ?`).all(...values, pageSize, offset) as CommandRow[];
    const total = db.prepare(`select count(*) as count from commands where ${where}`).get(...values) as { count: number };
    return { success: true, data: rows.map((row) => publicCommand(row)), pagination: { page, pageSize, total: total.count } };
  });



  app.get("/api/admin/audit-events", async (req) => {
    getSessionUser(req, db, config);
    const { page, pageSize, offset } = getPagination(req.query);
    const query = req.query as { actorType?: string; result?: string; action?: string; targetType?: string } | undefined;
    const clauses = ["workspaceId = ?"];
    const values: unknown[] = [DEFAULT_WORKSPACE.id];
    for (const [key, value] of Object.entries({ actorType: query?.actorType, result: query?.result, action: query?.action, targetType: query?.targetType })) {
      if (value) {
        clauses.push(`${key} = ?`);
        values.push(value);
      }
    }
    const where = clauses.join(" and ");
    const rows = db.prepare(`select * from audit_events where ${where} order by createdAt desc limit ? offset ?`).all(...values, pageSize, offset) as AuditEventRow[];
    const total = db.prepare(`select count(*) as count from audit_events where ${where}`).get(...values) as { count: number };
    return { success: true, data: rows.map(publicAuditEvent), pagination: { page, pageSize, total: total.count } };
  });



  app.post("/api/admin/commands/:commandId/cancel", async (req) => {
    const { user } = getSessionUser(req, db, config);
    requireOperator(user);
    const commandId = (req.params as { commandId: string }).commandId;
    const command = db.prepare("select * from commands where id = ? and workspaceId = ?").get(commandId, DEFAULT_WORKSPACE.id) as CommandRow | undefined;
    if (!command) throw Object.assign(new Error("Command not found."), { statusCode: 404, code: "COMMAND_NOT_FOUND" });
    if (["SUCCEEDED", "FAILED", "EXPIRED", "CANCELLED"].includes(command.status)) {
      throw Object.assign(new Error("Command is already completed."), { statusCode: 409, code: "COMMAND_ALREADY_COMPLETED" });
    }
    const ts = now();
    db.prepare("update commands set status = 'CANCELLED', completedAt = ?, updatedAt = ? where id = ?").run(ts, ts, command.id);
    writeAudit(db, { actorType: "USER", actorId: user.id, action: "command.cancelled", targetType: "Command", targetId: command.id });
    const row = db.prepare("select * from commands where id = ?").get(command.id) as CommandRow;
    return { success: true, data: publicCommand(row) };
  });


  app.post("/api/admin/commands/:commandId/retry", async (req) => {
    const { user } = getSessionUser(req, db, config);
    requireOperator(user);
    const commandId = (req.params as { commandId: string }).commandId;
    const command = db.prepare("select * from commands where id = ? and workspaceId = ?").get(commandId, DEFAULT_WORKSPACE.id) as CommandRow | undefined;
    if (!command) throw Object.assign(new Error("Command not found."), { statusCode: 404, code: "COMMAND_NOT_FOUND" });
    if (!["FAILED", "EXPIRED", "CANCELLED"].includes(command.status)) {
      throw Object.assign(new Error("Only failed, expired, or cancelled commands can be retried."), { statusCode: 409, code: "COMMAND_NOT_RETRYABLE" });
    }
    const agent = db.prepare("select * from agents where id = ? and workspaceId = ?").get(command.agentId, DEFAULT_WORKSPACE.id) as AgentRow | undefined;
    if (!agent || ["DISABLED", "REVOKED"].includes(agent.status)) {
      throw Object.assign(new Error("Command agent is not available."), { statusCode: 409, code: "AGENT_NOT_AVAILABLE" });
    }
    const service = db.prepare("select * from capsule_services where id = ? and workspaceId = ?").get(command.serviceId, DEFAULT_WORKSPACE.id) as CapsuleServiceRow | undefined;
    if (!service) throw Object.assign(new Error("Capsule Service not found."), { statusCode: 404, code: "CAPSULE_SERVICE_NOT_FOUND" });
    const action = db.prepare("select * from action_definitions where serviceId = ? and name = ? and enabled = 1").get(command.serviceId, command.actionName) as ActionDefinitionRow | undefined;
    if (!action) throw Object.assign(new Error("Action not found."), { statusCode: 404, code: "ACTION_NOT_FOUND" });
    const ts = now();
    const retryId = createId("cmd");
    const expiresAt = action.timeoutSeconds ? new Date(Date.now() + action.timeoutSeconds * 1000).toISOString() : null;
    db.prepare(`
      insert into commands (
        id, workspaceId, agentId, serviceId, type, actionName, status, payloadJson,
        createdByUserId, createdAt, updatedAt, expiresAt
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(retryId, DEFAULT_WORKSPACE.id, command.agentId, command.serviceId, command.type, command.actionName, "PENDING", command.payloadJson, user.id, ts, ts, expiresAt);
    writeAudit(db, { actorType: "USER", actorId: user.id, action: "command.retried", targetType: "Command", targetId: retryId, metadata: { sourceCommandId: command.id } });
    const row = db.prepare("select * from commands where id = ?").get(retryId) as CommandRow;
    return { success: true, data: publicCommand(row) };
  });

  app.get("/api/admin/audit-events/export", async (req, reply) => {
    const { user } = getSessionUser(req, db, config);
    requireOperator(user);
    const query = req.query as { actorType?: string; result?: string; action?: string; targetType?: string; format?: string } | undefined;
    const rows = auditExportRows(db, query);
    if (query?.format === "csv") {
      reply.header("content-disposition", `attachment; filename=opstage-audit-${Date.now()}.csv`);
      reply.type("text/csv; charset=utf-8");
      return auditRowsToCsv(rows);
    }
    reply.header("content-disposition", `attachment; filename=opstage-audit-${Date.now()}.json`);
    return { success: true, data: rows.map(publicAuditEvent) };
  });

  app.get("/api/admin/metrics", async (req) => {
    getSessionUser(req, db, config);
    return { success: true, data: collectMetrics(db, runtimeCounters) };
  });

  app.get("/api/admin/diagnostics/runtime", async (req) => {
    const { user } = getSessionUser(req, db, config);
    requireOperator(user);
    return { success: true, data: runtimeDiagnostics(db, config) };
  });

  app.post("/api/admin/backup/sqlite", async (req, reply) => {
    const { user } = getSessionUser(req, db, config);
    requireOwner(user);
    await mkdir(config.OPSTAGE_BACKUP_DIR, { recursive: true });
    const filename = `opstage-${new Date().toISOString().replace(/[:.]/g, "-")}.db`;
    const backupPath = path.resolve(config.OPSTAGE_BACKUP_DIR, filename);
    await db.backup(backupPath);
    writeAudit(db, { actorType: "USER", actorId: user.id, action: "backup.sqlite.created", targetType: "Backup", targetId: filename });
    reply.header("content-disposition", `attachment; filename=${filename}`);
    reply.type("application/octet-stream");
    return await readFile(backupPath);
  });

  app.get("/api/admin/commands/:commandId", async (req) => {
    getSessionUser(req, db, config);
    const commandId = (req.params as { commandId: string }).commandId;
    const command = db.prepare("select * from commands where id = ? and workspaceId = ?").get(commandId, DEFAULT_WORKSPACE.id) as CommandRow | undefined;
    if (!command) throw Object.assign(new Error("Command not found."), { statusCode: 404, code: "COMMAND_NOT_FOUND" });
    const result = db.prepare("select * from command_results where commandId = ?").get(commandId) as CommandResultRow | undefined;
    return { success: true, data: { ...publicCommand(command), result: publicCommandResult(result, { consumeEphemeralSecrets: true }) } };
  });

  app.get("/api/agents/:agentId/commands", async (req) => {
    const agentId = (req.params as { agentId: string }).agentId;
    const agent = authenticateAgent(req, db, agentId);
    runtimeCounters.agentCommandPolls += 1;
    const ts = now();
    db.prepare("update agents set status = 'ONLINE', lastHeartbeatAt = ?, updatedAt = ? where id = ?").run(ts, ts, agent.id);
    const query = req.query as { limit?: string | number } | undefined;
    const limit = Math.min(10, Math.max(1, Number(query?.limit ?? 10) || 10));
    const rows = db.prepare("select * from commands where agentId = ? and status = 'PENDING' order by createdAt asc limit ?").all(agentId, limit) as CommandRow[];
    for (const row of rows) {
      db.prepare("update commands set status = 'RUNNING', startedAt = ?, updatedAt = ? where id = ? and status = 'PENDING'").run(ts, ts, row.id);
      row.status = "RUNNING";
      row.startedAt = ts;
      row.updatedAt = ts;
      writeAudit(db, { actorType: "AGENT", actorId: agentId, action: "command.dispatched", targetType: "Command", targetId: row.id });
    }
    return { success: true, data: rows.map((row) => publicCommand(row, { redactPayload: false })) };
  });

  app.post("/api/agents/:agentId/commands/:commandId/result", async (req) => {
    const params = req.params as { agentId: string; commandId: string };
    const agent = authenticateAgent(req, db, params.agentId);
    const body = reportCommandResultRequestSchema.parse(req.body);
    assertCommandResultPayloadSize(config, body, () => { runtimeCounters.oversizedCommandResultsRejected += 1; });
    const command = db.prepare("select * from commands where id = ? and agentId = ?").get(params.commandId, agent.id) as CommandRow | undefined;
    if (!command) throw Object.assign(new Error("Command not found."), { statusCode: 404, code: "COMMAND_NOT_FOUND" });
    if (["SUCCEEDED", "FAILED", "EXPIRED", "CANCELLED"].includes(command.status)) {
      throw Object.assign(new Error("Command is already completed."), { statusCode: 409, code: "COMMAND_ALREADY_COMPLETED" });
    }
    const ts = now();
    const resultId = createId("crs");
    stashEphemeralCommandSecrets(command.id, body.data);
    db.prepare(`
      insert into command_results (id, commandId, agentId, success, message, dataJson, errorJson, reportedAt, createdAt)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(resultId, command.id, agent.id, body.success ? 1 : 0, body.message ?? null, safeJsonStringify(redactSecrets(body.data ?? {})), safeJsonStringify(redactSecrets(body.error ?? {})), ts, ts);
    db.prepare("update commands set status = ?, completedAt = ?, updatedAt = ? where id = ?").run(body.success ? "SUCCEEDED" : "FAILED", ts, ts, command.id);
    writeAudit(db, { actorType: "AGENT", actorId: agent.id, action: body.success ? "command.completed" : "command.failed", targetType: "Command", targetId: command.id, result: body.success ? "SUCCESS" : "FAILURE" });
    const result = db.prepare("select * from command_results where id = ?").get(resultId) as CommandResultRow;
    return { success: true, data: publicCommandResult(result) };
  });

  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith("/api/")) {
      reply.status(404).send({ success: false, error: { code: "NOT_FOUND", message: "Route not found." } });
      return;
    }
    if (!["GET", "HEAD"].includes(req.method)) {
      reply.status(404).send({ success: false, error: { code: "NOT_FOUND", message: "Route not found." } });
      return;
    }
    const filePath = await resolveStaticFile(config.OPSTAGE_STATIC_DIR, req.url);
    if (!filePath) {
      reply.status(404).send({ success: false, error: { code: "STATIC_NOT_FOUND", message: "Static UI build not found." } });
      return;
    }
    reply.type(staticContentType(filePath));
    reply.send(await readFile(filePath));
  });

  return app;
}
