import { formatBytes } from "./format.js";
import type { DiagnosticRow } from "./types.js";

/** Convert a `{ key: count }` record into a stable, alphabetically-sorted row list. */
export function metricRows(values: Record<string, number> | undefined): Array<{ key: string; value: number }> {
  return Object.entries(values ?? {})
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Returns true if a given metric should be highlighted as a warning.
 * Currently tied to four operational counters where >0 is meaningful.
 */
export function hasMetricWarning(key: string, value: number): boolean {
  return (
    value > 0 &&
    ["commandsFailed", "actionPrepareTimeouts", "actionPrepareFailures", "oversizedCommandResultsRejected"].includes(key)
  );
}

function diagnosticValue(value: unknown): string | number {
  if (value === undefined || value === null || value === "") return "-";
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/**
 * Flatten the `/api/admin/diagnostics/runtime` envelope into a list of
 * { category, key, value } rows the Settings page can render directly.
 * Memory fields are pre-formatted via `formatBytes` for readability.
 */
export function diagnosticRows(diagnostics: Record<string, unknown> | null | undefined): DiagnosticRow[] {
  if (!diagnostics) return [];
  const memory = diagnostics.memory && typeof diagnostics.memory === "object" ? (diagnostics.memory as Record<string, unknown>) : {};
  const config = diagnostics.config && typeof diagnostics.config === "object" ? (diagnostics.config as Record<string, unknown>) : {};
  const maintenance = config.maintenance && typeof config.maintenance === "object" ? (config.maintenance as Record<string, unknown>) : {};
  const rows: DiagnosticRow[] = [
    { category: "runtime", key: "version", value: diagnosticValue(diagnostics.version) },
    { category: "runtime", key: "edition", value: diagnosticValue(diagnostics.edition) },
    { category: "runtime", key: "node", value: diagnosticValue(diagnostics.node) },
    { category: "runtime", key: "platform", value: diagnosticValue(diagnostics.platform) },
    { category: "runtime", key: "arch", value: diagnosticValue(diagnostics.arch) },
    { category: "runtime", key: "uptimeSeconds", value: diagnosticValue(diagnostics.uptimeSeconds) },
    { category: "runtime", key: "pid", value: diagnosticValue(diagnostics.pid) },
    { category: "memory", key: "rss", value: formatBytes(memory.rss) },
    { category: "memory", key: "heapUsed", value: formatBytes(memory.heapUsed) },
    { category: "memory", key: "heapTotal", value: formatBytes(memory.heapTotal) },
    { category: "memory", key: "external", value: formatBytes(memory.external) },
    { category: "config", key: "host", value: diagnosticValue(config.host) },
    { category: "config", key: "port", value: diagnosticValue(config.port) },
    { category: "config", key: "databaseUrl", value: diagnosticValue(config.databaseUrl) },
    { category: "config", key: "staticDir", value: diagnosticValue(config.staticDir) },
    { category: "config", key: "backupDir", value: diagnosticValue(config.backupDir) },
    { category: "maintenance", key: "agentOfflineThresholdSeconds", value: diagnosticValue(maintenance.agentOfflineThresholdSeconds) },
    { category: "maintenance", key: "auditRetentionDays", value: diagnosticValue(maintenance.auditRetentionDays) },
    { category: "maintenance", key: "maintenanceIntervalSeconds", value: diagnosticValue(maintenance.maintenanceIntervalSeconds) },
  ];
  return rows.filter((row) => row.value !== "-");
}
