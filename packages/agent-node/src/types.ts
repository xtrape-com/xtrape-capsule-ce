
import type { ActionDefinitionInput, ConfigItemInput, HealthReportInput, ReportedService } from "@xtrape/capsule-contracts-node";
export type AgentMode = "embedded";
export type ActionHandler = (payload: Record<string, unknown>) => Promise<{ success?: boolean; message?: string; data?: Record<string, unknown>; error?: Record<string, unknown> } | Record<string, unknown>>;
export type ActionPrepareHandler = () => Promise<{ action?: Record<string, unknown>; initialPayload?: Record<string, unknown>; currentState?: Record<string, unknown> } | Record<string, unknown>> | { action?: Record<string, unknown>; initialPayload?: Record<string, unknown>; currentState?: Record<string, unknown> } | Record<string, unknown>;
export interface CapsuleAgentOptions { backendUrl: string; registrationToken?: string; tokenStore?: { file?: string }; agent?: { code: string; name?: string; runtime?: string }; service: { code: string; name: string; description?: string; version: string; runtime: "nodejs"|"java"|"python"|"go"|"other"; manifest?: Record<string, unknown> }; intervals?: { heartbeatMs?: number; commandPollMs?: number; serviceReportMs?: number }; heartbeatIntervalSeconds?: number; commandPollIntervalSeconds?: number; autoStartLoops?: boolean; logger?: Pick<Console,"debug"|"info"|"warn"|"error">; failOnStartError?: boolean; }
export type HealthProvider = () => Promise<HealthReportInput> | HealthReportInput;
export type ConfigProvider = () => Promise<ConfigItemInput[]> | ConfigItemInput[];
export interface RegisteredAction extends ActionDefinitionInput { handler: ActionHandler; prepare?: ActionPrepareHandler; }
export interface TokenStore { load(): Promise<string | null>; save(token: string): Promise<void>; clear(): Promise<void>; }
export type ServiceSnapshot = ReportedService;
