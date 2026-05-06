
import { customAlphabet } from "nanoid";
import { z } from "zod";

export { z };

export const AgentStatus = ["PENDING","ONLINE","OFFLINE","DISABLED","REVOKED"] as const;
export const CapsuleServiceStatus = ["UNKNOWN","HEALTHY","UNHEALTHY","STALE","OFFLINE"] as const;
export const HealthStatus = ["UP","DEGRADED","DOWN","UNKNOWN"] as const;
export const CommandStatus = ["PENDING","RUNNING","SUCCEEDED","FAILED","EXPIRED","CANCELLED"] as const;
export const DangerLevel = ["LOW","MEDIUM","HIGH"] as const;
export const AuditActorType = ["USER","AGENT","SYSTEM"] as const;
export const AuditResult = ["SUCCESS","FAILURE"] as const;
export const TokenStatus = ["ACTIVE","REVOKED","EXPIRED","USED"] as const;
export type AgentStatus = typeof AgentStatus[number];
export type CapsuleServiceStatus = typeof CapsuleServiceStatus[number];
export type HealthStatus = typeof HealthStatus[number];
export type CommandStatus = typeof CommandStatus[number];
export type DangerLevel = typeof DangerLevel[number];
export type AuditActorType = typeof AuditActorType[number];
export type AuditResult = typeof AuditResult[number];
export type TokenStatus = typeof TokenStatus[number];

export const ErrorCode = {
  INTERNAL_ERROR: "INTERNAL_ERROR", VALIDATION_FAILED: "VALIDATION_FAILED", UNAUTHORIZED: "UNAUTHORIZED", FORBIDDEN: "FORBIDDEN", NOT_FOUND: "NOT_FOUND", CONFLICT: "CONFLICT", CSRF_INVALID: "CSRF_INVALID", ACTION_REQUIRES_CONFIRMATION: "ACTION_REQUIRES_CONFIRMATION", COMMAND_EXPIRED: "COMMAND_EXPIRED", TOKEN_REVOKED: "TOKEN_REVOKED", TOKEN_EXPIRED: "TOKEN_EXPIRED", AGENT_REVOKED: "AGENT_REVOKED", AGENT_DISABLED: "AGENT_DISABLED"
} as const;
export type ErrorCode = typeof ErrorCode[keyof typeof ErrorCode];

const idPrefixes = ["wks_","usr_","agt_","tok_","svc_","hlr_","cfg_","act_","cmd_","crs_","aud_"] as const;
export type IdPrefix = typeof idPrefixes[number];
const NANO = customAlphabet("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-", 21);
export function newId<P extends IdPrefix>(prefix: P): `${P}${string}` { return `${prefix}${NANO()}` as `${P}${string}`; }

export const AnyJson = z.record(z.any());
export const AgentStatusSchema = z.enum(AgentStatus);
export const CapsuleServiceStatusSchema = z.enum(CapsuleServiceStatus);
export const HealthStatusSchema = z.enum(HealthStatus);
export const CommandStatusSchema = z.enum(CommandStatus);
export const DangerLevelSchema = z.enum(DangerLevel).default("LOW");

export const UserSchema = z.object({ id: z.string().startsWith("usr_"), username: z.string(), displayName: z.string().nullable().optional(), createdAt: z.string(), updatedAt: z.string() });
export type User = z.infer<typeof UserSchema>;
export const UserRole = z.enum(["owner", "operator", "viewer"]);
export type UserRole = z.infer<typeof UserRole>;
export const createUserRequestSchema = z.object({ username: z.string().min(1), password: z.string().min(12), displayName: z.string().optional(), role: UserRole.default("viewer") });
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;
export const updateUserRequestSchema = z.object({ displayName: z.string().optional(), role: UserRole.optional(), status: z.enum(["ACTIVE", "DISABLED"]).optional() });
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;
export const resetUserPasswordRequestSchema = z.object({ password: z.string().min(12) });
export type ResetUserPasswordRequest = z.infer<typeof resetUserPasswordRequestSchema>;
export const AdminLoginRequestSchema = z.object({ username: z.string().min(1), password: z.string().min(1) });
export type AdminLoginRequest = z.infer<typeof AdminLoginRequestSchema>;
export const adminLoginRequestSchema = AdminLoginRequestSchema;
export const AdminSessionSchema = z.object({ user: UserSchema, csrfToken: z.string(), expiresAt: z.string() });
export type AdminSession = z.infer<typeof AdminSessionSchema>;

export const AgentSchema = z.object({ id: z.string().startsWith("agt_"), code: z.string(), name: z.string().nullable().optional(), mode: z.enum(["embedded","sidecar","external"]), runtime: z.string().nullable().optional(), status: AgentStatusSchema, lastHeartbeatAt: z.string().nullable().optional(), createdAt: z.string(), updatedAt: z.string() });
export type Agent = z.infer<typeof AgentSchema>;
export const RegistrationTokenSchema = z.object({ id: z.string().startsWith("tok_"), name: z.string(), status: z.enum(TokenStatus), expiresAt: z.string().nullable().optional(), usedAt: z.string().nullable().optional(), createdAt: z.string() });
export type RegistrationToken = z.infer<typeof RegistrationTokenSchema>;
export const CreateRegistrationTokenRequestSchema = z.object({ name: z.string().default("Default registration token").optional(), expiresInSeconds: z.number().int().min(60).optional() });
export type CreateRegistrationTokenRequest = z.infer<typeof CreateRegistrationTokenRequestSchema>;
export const createRegistrationTokenRequestSchema = CreateRegistrationTokenRequestSchema;
export const CreateRegistrationTokenResponseSchema = RegistrationTokenSchema.extend({ rawToken: z.string().startsWith("opstage_reg_") });
export type CreateRegistrationTokenResponse = z.infer<typeof CreateRegistrationTokenResponseSchema>;

export const CapsuleManifestSchema = z.object({ kind: z.literal("CapsuleService"), schemaVersion: z.string().default("1.0").optional(), code: z.string().min(1), name: z.string().min(1), description: z.string().optional(), version: z.string().min(1), runtime: z.enum(["nodejs","java","python","go","other"]), agentMode: z.enum(["embedded","sidecar","external"]), capabilities: z.array(z.string()).optional(), labels: z.record(z.string()).optional() }).passthrough();
export type CapsuleManifest = z.infer<typeof CapsuleManifestSchema>;
export const HealthReportInputSchema = z.object({ status: HealthStatusSchema, message: z.string().optional(), details: AnyJson.optional() });
export type HealthReportInput = z.infer<typeof HealthReportInputSchema>;
export const healthReportInputSchema = HealthReportInputSchema;
export const ConfigItemInputSchema = z.object({ key: z.string(), label: z.string().optional(), type: z.string(), source: z.string().optional(), editable: z.boolean().optional(), sensitive: z.boolean().optional(), valuePreview: z.string().optional(), defaultValue: z.string().optional(), secretRef: z.string().optional() });
export type ConfigItemInput = z.infer<typeof ConfigItemInputSchema>;
export const configItemInputSchema = ConfigItemInputSchema;
export const ActionDefinitionInputSchema = z.object({ name: z.string(), label: z.string(), description: z.string().optional(), dangerLevel: z.enum(DangerLevel).default("LOW").optional(), requiresConfirmation: z.boolean().optional(), category: z.string().optional(), order: z.number().int().optional(), inputSchema: AnyJson.optional(), outputSchema: AnyJson.optional(), timeoutSeconds: z.number().int().positive().optional() });
export type ActionDefinitionInput = z.infer<typeof ActionDefinitionInputSchema>;
export const actionDefinitionInputSchema = ActionDefinitionInputSchema;
export const ReportedServiceSchema = z.object({ code: z.string().min(1).max(80), name: z.string().min(1).max(200), description: z.string().max(2000).optional(), version: z.string().max(80).optional(), runtime: z.string().optional(), manifest: AnyJson, health: HealthReportInputSchema.optional(), configs: z.array(ConfigItemInputSchema).optional(), actions: z.array(ActionDefinitionInputSchema).optional() });
export type ReportedService = z.infer<typeof ReportedServiceSchema>;
export const reportedServiceSchema = ReportedServiceSchema;
export const ServiceReportRequestSchema = z.object({ services: z.array(ReportedServiceSchema).min(1) });
export type ServiceReportRequest = z.infer<typeof ServiceReportRequestSchema>;
export const serviceReportRequestSchema = ServiceReportRequestSchema;
export const RegisterAgentRequestSchema = z.object({ registrationToken: z.string().startsWith("opstage_reg_"), agent: z.object({ code: z.string(), name: z.string().optional(), mode: z.literal("embedded"), runtime: z.string().optional() }), service: ReportedServiceSchema.optional() });
export type RegisterAgentRequest = z.infer<typeof RegisterAgentRequestSchema>;
export const registerAgentRequestSchema = RegisterAgentRequestSchema;
export const RegisterAgentResponseSchema = z.object({ agentId: z.string().startsWith("agt_"), agentToken: z.string().startsWith("opstage_agent_"), heartbeatIntervalSeconds: z.number().int(), commandPollIntervalSeconds: z.number().int() });
export type RegisterAgentResponse = z.infer<typeof RegisterAgentResponseSchema>;
export const AgentHeartbeatResponseSchema = z.object({ heartbeatIntervalSeconds: z.number().int(), commandPollIntervalSeconds: z.number().int() });
export type AgentHeartbeatResponse = z.infer<typeof AgentHeartbeatResponseSchema>;
export const AgentHeartbeatRequestSchema = z.object({ serviceId: z.string().startsWith("svc_").optional(), health: HealthReportInputSchema.optional() });
export type AgentHeartbeatRequest = z.infer<typeof AgentHeartbeatRequestSchema>;
export const agentHeartbeatRequestSchema = AgentHeartbeatRequestSchema;

export const CapsuleServiceSchema = z.object({ id: z.string().startsWith("svc_"), agentId: z.string().startsWith("agt_").optional(), code: z.string(), name: z.string(), description: z.string().nullable().optional(), version: z.string().nullable().optional(), runtime: z.string().nullable().optional(), status: CapsuleServiceStatusSchema, healthStatus: HealthStatusSchema.optional(), lastReportedAt: z.string().nullable().optional(), lastHealthAt: z.string().nullable().optional(), createdAt: z.string(), updatedAt: z.string() });
export type CapsuleService = z.infer<typeof CapsuleServiceSchema>;
export const HealthReportSchema = z.object({ id: z.string().startsWith("hlr_"), serviceId: z.string().startsWith("svc_"), agentId: z.string().startsWith("agt_").optional(), status: HealthStatusSchema, message: z.string().nullable().optional(), details: AnyJson.optional(), reportedAt: z.string() });
export type HealthReport = z.infer<typeof HealthReportSchema>;
export const ConfigItemSchema = z.object({ id: z.string().startsWith("cfg_"), serviceId: z.string().startsWith("svc_"), key: z.string(), label: z.string().nullable().optional(), type: z.string(), source: z.string().nullable().optional(), editable: z.boolean().default(false), sensitive: z.boolean(), valuePreview: z.string().nullable().optional(), defaultValue: z.string().nullable().optional(), secretRef: z.string().nullable().optional() });
export type ConfigItem = z.infer<typeof ConfigItemSchema>;
export const ActionDefinitionSchema = z.object({ id: z.string().startsWith("act_"), serviceId: z.string().startsWith("svc_"), name: z.string(), label: z.string(), description: z.string().nullable().optional(), dangerLevel: z.enum(DangerLevel), requiresConfirmation: z.boolean(), category: z.string().optional(), order: z.number().int().optional(), inputSchema: AnyJson.optional(), outputSchema: AnyJson.optional(), timeoutSeconds: z.number().int().optional() });
export type ActionDefinition = z.infer<typeof ActionDefinitionSchema>;
export const CapsuleServiceDetailSchema = CapsuleServiceSchema.extend({ manifest: AnyJson.optional(), health: HealthReportSchema.nullable().optional(), configs: z.array(ConfigItemSchema).optional(), actions: z.array(ActionDefinitionSchema).optional() });
export type CapsuleServiceDetail = z.infer<typeof CapsuleServiceDetailSchema>;

export const CreateActionCommandRequestSchema = z.object({ payload: AnyJson.optional(), confirmation: z.boolean().optional() });
export type CreateActionCommandRequest = z.infer<typeof CreateActionCommandRequestSchema>;
export const createActionCommandRequestSchema = CreateActionCommandRequestSchema;
export const CommandSchema = z.object({ id: z.string().startsWith("cmd_"), agentId: z.string().startsWith("agt_"), serviceId: z.string().startsWith("svc_"), type: z.enum(["ACTION_PREPARE", "ACTION_EXECUTE", "ACTION"]), actionName: z.string(), status: CommandStatusSchema, payload: AnyJson.optional(), createdByUserId: z.string().startsWith("usr_").nullable().optional(), createdAt: z.string(), startedAt: z.string().nullable().optional(), completedAt: z.string().nullable().optional(), expiresAt: z.string().nullable().optional() });
export type Command = z.infer<typeof CommandSchema>;
export const ReportCommandResultRequestSchema = z.object({ success: z.boolean(), message: z.string().optional(), data: AnyJson.optional(), error: AnyJson.optional(), startedAt: z.string().optional(), finishedAt: z.string().optional() });
export type ReportCommandResultRequest = z.infer<typeof ReportCommandResultRequestSchema>;
export const reportCommandResultRequestSchema = ReportCommandResultRequestSchema;
export const CommandResultSchema = z.object({ id: z.string().startsWith("crs_"), commandId: z.string().startsWith("cmd_"), success: z.boolean(), message: z.string().nullable().optional(), data: AnyJson.optional(), error: AnyJson.optional(), reportedAt: z.string() });
export type CommandResult = z.infer<typeof CommandResultSchema>;
export const CommandDetailSchema = CommandSchema.extend({ result: CommandResultSchema.nullable().optional() });
export type CommandDetail = z.infer<typeof CommandDetailSchema>;
export const AuditEventSchema = z.object({ id: z.string().startsWith("aud_"), actorType: z.enum(AuditActorType), actorId: z.string().nullable().optional(), action: z.string(), targetType: z.string().nullable().optional(), targetId: z.string().nullable().optional(), result: z.enum(AuditResult), message: z.string().nullable().optional(), metadata: AnyJson.optional(), createdAt: z.string() });
export type AuditEvent = z.infer<typeof AuditEventSchema>;
export const DashboardSummarySchema = z.object({ agentCounts: z.record(z.number().int()), serviceCounts: z.record(z.number().int()), commandCounts: z.record(z.number().int()), recentCommands: z.array(CommandSchema).optional(), recentAuditEvents: z.array(AuditEventSchema).optional() });
export type DashboardSummary = z.infer<typeof DashboardSummarySchema>;
export const SystemHealthSchema = z.object({ status: z.enum(["UP","DEGRADED","DOWN"]), timestamp: z.string(), version: z.string(), edition: z.literal("ce"), database: z.object({ status: z.enum(["UP","DEGRADED","DOWN"]), kind: z.enum(["sqlite","postgres","mysql"]).optional(), latencyMs: z.number().int().optional() }), uptimeSeconds: z.number().int().optional() });
export type SystemHealth = z.infer<typeof SystemHealthSchema>;
export const SystemVersionSchema = z.object({ version: z.string(), edition: z.literal("ce"), commit: z.string().optional(), buildTime: z.string().optional() });
export type SystemVersion = z.infer<typeof SystemVersionSchema>;

export type Pagination = { page: number; pageSize: number; total: number };
export type SuccessEnvelope<T> = { success?: true; data: T; pagination?: Pagination } | { data: T; pagination?: Pagination };
export type ErrorEnvelope = { success: false; error: { code: string; message: string; details?: unknown } };
export const ListQueryBase = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20), sort: z.string().optional() });
export class HttpError extends Error { constructor(public readonly httpStatus: number, public readonly code: string, public readonly publicMessage: string, public readonly details?: unknown){ super(publicMessage); } }
export function parseSort(value: string | undefined, allowed: readonly string[]) { if (!value) return []; return value.split(",").filter(Boolean).map(raw=>{ const desc=raw.startsWith("-"); const field=desc?raw.slice(1):raw; if(!allowed.includes(field)) throw new HttpError(422,"VALIDATION_FAILED",`Unknown sort field: ${field}`); return { field, direction: desc ? "desc" : "asc" } as const; }); }
export function paginate<T>(items: T[], page: number, pageSize: number, total: number) { return { data: items, pagination: { page, pageSize, total } }; }
