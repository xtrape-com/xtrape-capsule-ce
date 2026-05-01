import { z } from "zod";

export const AgentStatus = z.enum(["PENDING", "ONLINE", "OFFLINE", "DISABLED", "REVOKED"]);
export type AgentStatus = z.infer<typeof AgentStatus>;

export const CapsuleServiceStatus = z.enum(["UNKNOWN", "HEALTHY", "UNHEALTHY", "STALE", "OFFLINE"]);
export type CapsuleServiceStatus = z.infer<typeof CapsuleServiceStatus>;

export const HealthStatus = z.enum(["UP", "DEGRADED", "DOWN", "UNKNOWN"]);
export type HealthStatus = z.infer<typeof HealthStatus>;

export const DangerLevel = z.enum(["LOW", "MEDIUM", "HIGH"]);
export type DangerLevel = z.infer<typeof DangerLevel>;

export const CommandStatus = z.enum(["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "EXPIRED", "CANCELLED"]);
export type CommandStatus = z.infer<typeof CommandStatus>;


export const UserRole = z.enum(["owner", "operator", "viewer"]);
export type UserRole = z.infer<typeof UserRole>;

export const createUserRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(12),
  displayName: z.string().optional(),
  role: UserRole.default("viewer")
});
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

export const updateUserRequestSchema = z.object({
  displayName: z.string().optional(),
  role: UserRole.optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional()
});
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;

export const resetUserPasswordRequestSchema = z.object({
  password: z.string().min(12)
});
export type ResetUserPasswordRequest = z.infer<typeof resetUserPasswordRequestSchema>;

export const adminLoginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});
export type AdminLoginRequest = z.infer<typeof adminLoginRequestSchema>;

export const createRegistrationTokenRequestSchema = z.object({
  name: z.string().min(1).default("Default registration token"),
  expiresInSeconds: z.number().int().min(60).optional()
});
export type CreateRegistrationTokenRequest = z.infer<typeof createRegistrationTokenRequestSchema>;

export const healthReportInputSchema = z.object({
  status: HealthStatus,
  message: z.string().optional(),
  details: z.record(z.unknown()).optional()
});
export type HealthReportInput = z.infer<typeof healthReportInputSchema>;

export const configItemInputSchema = z.object({
  key: z.string().min(1),
  label: z.string().optional(),
  type: z.string().min(1),
  source: z.string().optional(),
  editable: z.boolean().default(false),
  sensitive: z.boolean().default(false),
  valuePreview: z.string().optional(),
  defaultValue: z.string().optional(),
  secretRef: z.string().optional()
});
export type ConfigItemInput = z.infer<typeof configItemInputSchema>;

export const actionDefinitionInputSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  dangerLevel: DangerLevel.default("LOW"),
  requiresConfirmation: z.boolean().default(false),
  inputSchema: z.record(z.unknown()).optional(),
  timeoutSeconds: z.number().int().positive().optional()
});
export type ActionDefinitionInput = z.infer<typeof actionDefinitionInputSchema>;

export const reportedServiceSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().optional(),
  runtime: z.string().optional(),
  manifest: z.record(z.unknown()),
  health: healthReportInputSchema.optional(),
  configs: z.array(configItemInputSchema).default([]),
  actions: z.array(actionDefinitionInputSchema).default([])
});
export type ReportedService = z.infer<typeof reportedServiceSchema>;

export const registerAgentRequestSchema = z.object({
  registrationToken: z.string().startsWith("opstage_reg_"),
  agent: z.object({
    code: z.string().min(1),
    name: z.string().optional(),
    mode: z.literal("embedded"),
    runtime: z.string().optional()
  }),
  service: reportedServiceSchema.optional()
});
export type RegisterAgentRequest = z.infer<typeof registerAgentRequestSchema>;

export const agentHeartbeatRequestSchema = z.object({
  serviceId: z.string().startsWith("svc_").optional(),
  health: healthReportInputSchema.optional()
});
export type AgentHeartbeatRequest = z.infer<typeof agentHeartbeatRequestSchema>;

export const serviceReportRequestSchema = z.object({
  services: z.array(reportedServiceSchema).min(1)
});
export type ServiceReportRequest = z.infer<typeof serviceReportRequestSchema>;

export const createActionCommandRequestSchema = z.object({
  payload: z.record(z.unknown()).optional(),
  confirmation: z.boolean().optional()
});
export type CreateActionCommandRequest = z.infer<typeof createActionCommandRequestSchema>;

export const reportCommandResultRequestSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  data: z.record(z.unknown()).optional(),
  error: z.record(z.unknown()).optional()
});
export type ReportCommandResultRequest = z.infer<typeof reportCommandResultRequestSchema>;
