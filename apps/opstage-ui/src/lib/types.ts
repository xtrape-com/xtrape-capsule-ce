/**
 * Domain types used across pages, hooks, and components. Extracted from
 * App.tsx so individual page files can import what they need without
 * pulling the whole App module.
 *
 * These are intentionally permissive (lots of optional fields, `string`
 * status enums) because they mirror the public-envelope JSON the backend
 * sends, and the UI is forgiving by design.
 */

export interface Service {
  id: string;
  agentId: string;
  code: string;
  name: string;
  description?: string | null;
  version?: string | null;
  runtime?: string | null;
  status: string;
  healthStatus: string;
  lastReportedAt?: string | null;
  lastHealthAt?: string | null;
  createdAt: string;
  updatedAt: string;
  actions?: Action[];
  configs?: ConfigItem[];
  health?: Record<string, unknown> | null;
  manifest?: Record<string, unknown>;
}

export interface Agent {
  id: string;
  code: string;
  name?: string | null;
  mode: string;
  runtime?: string | null;
  status: string;
  serviceCount?: number;
  lastHeartbeatAt?: string | null;
  createdAt: string;
  updatedAt: string;
  services?: Service[];
}

export interface Action {
  id: string;
  serviceId: string;
  name: string;
  label: string;
  description?: string | null;
  dangerLevel: string;
  requiresConfirmation: boolean;
  category?: string;
  order?: number;
  inputSchema?: Record<string, unknown>;
  timeoutSeconds?: number | null;
  enabled: boolean;
}

export interface ActionPrepare {
  action: Action;
  initialPayload: Record<string, unknown>;
  currentState?: Record<string, unknown>;
}

export interface ConfigItem {
  id: string;
  configKey: string;
  label?: string | null;
  type: string;
  source?: string | null;
  editable: number;
  sensitive: number;
  valuePreview?: string | null;
  defaultValue?: string | null;
  secretRef?: string | null;
}

export interface Command {
  id: string;
  agentId: string;
  serviceId: string;
  type: string;
  actionName: string;
  status: string;
  payload: Record<string, unknown>;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
  result?: Record<string, unknown> | null;
}

export interface ResultListColumn {
  key: string;
  label?: string;
  format?: "text" | "status" | "datetime" | "boolean" | "code" | "duration" | "relativeTime" | "bytes";
  copyable?: boolean;
  ellipsis?: boolean;
  width?: number | string;
}

export interface ResultListRowAction {
  label: string;
  action: string;
  payload?: Record<string, unknown>;
  danger?: boolean;
  confirm?: boolean;
}

export interface ResultListMeta {
  title?: string;
  data?: Record<string, unknown>[];
  columns?: ResultListColumn[];
  rowActions?: ResultListRowAction[];
  pageActions?: ResultListRowAction[];
  emptyText?: string;
  pageSize?: number;
}

export interface ResultDetailField {
  key: string;
  label?: string;
  format?: ResultListColumn["format"];
  copyable?: boolean;
}

export interface ResultDetailMeta {
  title?: string;
  data?: Record<string, unknown>;
  fields?: ResultDetailField[];
  actions?: ResultListRowAction[];
}

export interface AccountStatus {
  id?: string;
  label?: string;
  emailMasked?: string;
  enabled?: boolean;
  healthy?: boolean;
  operationStatus?: string;
  operationName?: string;
  operationMessage?: string;
  cooldownRemainingMs?: number;
  consecutiveFailures?: number;
  loginVerifiedAt?: number;
  lastError?: string;
}

export interface User {
  id: string;
  username: string;
  displayName?: string | null;
  role: string;
  status: string;
  lastLoginAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEvent {
  id: string;
  actorType: string;
  actorId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  result: string;
  message?: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface RegistrationToken {
  id: string;
  name: string;
  status: string;
  agentId?: string | null;
  expiresAt?: string | null;
  usedAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
  token?: string;
  rawToken?: string;
}

export interface MaintenanceSettings {
  agentOfflineThresholdSeconds: number;
  auditRetentionDays: number;
  maintenanceIntervalSeconds: number;
}

export interface Metrics {
  totals: Record<string, number>;
  byStatus: Record<string, Record<string, number>>;
  operational?: Record<string, number>;
}

export interface DiagnosticRow {
  key: string;
  value: string | number;
  category: string;
}

export interface MaintenanceResult {
  expiredRegistrationTokens: number;
  expiredCommands: number;
  offlineAgents: number;
  offlineServices: number;
  deletedAuditEvents: number;
  ranAt: string;
}

export interface DashboardSummary {
  workspace: { id: string; code: string; name: string };
  agentCounts: Record<string, number>;
  serviceCounts: Record<string, number>;
  commandCounts: Record<string, number>;
  auditEventCount: number;
  recentCommands: Command[];
  recentAuditEvents: AuditEvent[];
}

export interface PageState {
  page: number;
  pageSize: number;
}

export const defaultPage: PageState = { page: 1, pageSize: 20 };


export interface BusRoute {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  match: { eventType: string; sourceServiceCode?: string };
  target: { serviceCode: string; actionName: string };
  inputMapping?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface BusEvent {
  id: string;
  agentId: string;
  sourceServiceId?: string;
  sourceServiceCode: string;
  eventType: string;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  correlationId?: string;
  causationId?: string;
  occurredAt: string;
  acceptedAt: string;
  routeCount: number;
  experimental: string;
}
