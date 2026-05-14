import { Tag, Typography } from "antd";
import { apiFetch } from "../../api.js";
import { StatusTag } from "../../components.js";
import { formatBytes, formatDurationMs } from "../../lib/format.js";
import type {
  AccountStatus,
  Action,
  Command,
  ResultDetailMeta,
  ResultListColumn,
  ResultListMeta,
} from "../../lib/types.js";

/**
 * Operator-facing ordering of action categories on the Service drawer.
 * Categories outside this list sort alphabetically after the listed ones.
 */
export const actionCategoryOrder = [
  "account",
  "item-management",
  "api-key",
  "session",
  "runtime-config",
  "diagnostics",
  "advanced",
  "other",
];

/**
 * Look up the operator-facing label for an action category. Falls back to
 * the raw category id when no translation exists.
 */
export function actionCategoryLabel(
  category: string,
  t: (key: never, vars?: Record<string, string | number>) => string,
): string {
  const key = `actionCategory.${category}`;
  const translated = t(key as never);
  return translated === key ? category : translated;
}

/**
 * Bucket service actions by category for the Service drawer's button grid.
 * Skips internal `page-action` / `row-action` categories — those are
 * embedded in list/detail UIs and surfaced by action-result components,
 * not by the top-level button list.
 */
export function groupActions(actions: Action[] | undefined): Array<{ category: string; actions: Action[] }> {
  const groups = new Map<string, Action[]>();
  for (const action of actions ?? []) {
    if (action.category === "page-action" || action.category === "row-action") continue;
    const category = action.category || "other";
    groups.set(category, [...(groups.get(category) ?? []), action]);
  }
  return [...groups.entries()]
    .sort(
      ([a], [b]) =>
        (actionCategoryOrder.indexOf(a) === -1 ? 999 : actionCategoryOrder.indexOf(a)) -
          (actionCategoryOrder.indexOf(b) === -1 ? 999 : actionCategoryOrder.indexOf(b)) || a.localeCompare(b),
    )
    .map(([category, items]) => ({
      category,
      actions: items.sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.label.localeCompare(b.label)),
    }));
}

/**
 * Compute an initial payload for an action from its declared JSON
 * Schema's `properties.default` entries (falling back to type-shaped
 * zero values).
 */
export function defaultPayloadForAction(action: Action): Record<string, unknown> {
  const schema = action.inputSchema;
  const properties = schema?.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return {};
  return Object.fromEntries(
    Object.entries(properties as Record<string, { default?: unknown; type?: string }>).map(([key, meta]) => {
      if (meta.default !== undefined) return [key, meta.default];
      if (meta.type === "number" || meta.type === "integer") return [key, 0];
      if (meta.type === "boolean") return [key, false];
      if (meta.type === "array") return [key, []];
      if (meta.type === "object") return [key, {}];
      return [key, ""];
    }),
  );
}

export interface SchemaProperty {
  type?: string | string[];
  title?: string;
  description?: string;
  enum?: Array<string | number | boolean>;
  enumLabels?: string[];
  default?: unknown;
  maxLength?: number;
  format?: "password" | "textarea" | string;
  placeholder?: string;
  readOnly?: boolean;
}

export function getSchemaProperties(action: Action | null): Record<string, SchemaProperty> {
  const properties = action?.inputSchema?.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return {};
  return properties as Record<string, SchemaProperty>;
}

export function actionResultData(command: Command | null): Record<string, unknown> | undefined {
  const result = command?.result;
  const data = result && typeof result === "object" && !Array.isArray(result) ? (result as Record<string, unknown>).data : undefined;
  return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : undefined;
}

export function resultListFromCommand(command: Command | null): ResultListMeta | undefined {
  const list = actionResultData(command)?.list;
  if (!list || typeof list !== "object" || Array.isArray(list)) return undefined;
  const meta = list as ResultListMeta;
  return Array.isArray(meta.data) ? meta : undefined;
}

export function resultDetailFromCommand(command: Command | null): ResultDetailMeta | undefined {
  return resultDetailFromValue(actionResultData(command)?.detail);
}

export function resultDetailFromValue(value: unknown): ResultDetailMeta | undefined {
  const detail = value;
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return undefined;
  const meta = detail as ResultDetailMeta;
  return meta.data && typeof meta.data === "object" && !Array.isArray(meta.data) ? meta : undefined;
}

export function inferListColumns(rows: Record<string, unknown>[]): ResultListColumn[] {
  const first = rows[0];
  if (!first) return [];
  return Object.keys(first).slice(0, 8).map((key) => ({ key, label: key }));
}

export function getPathValue(row: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((value, part) => (value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined), row);
}

/**
 * Resolve a row-action `payload` template against an actual row. Any
 * string value of the form `$row.path.to.field` is replaced with the
 * row's value at that path; other primitives pass through; arrays and
 * nested objects are walked recursively.
 */
export function resolveRowPayload(
  template: Record<string, unknown> | undefined,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const resolve = (value: unknown): unknown => {
    if (typeof value === "string" && value.startsWith("$row.")) return getPathValue(row, value.slice(5));
    if (Array.isArray(value)) return value.map(resolve);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, resolve(nested)]));
    }
    return value;
  };
  return resolve(template ?? {}) as Record<string, unknown>;
}

export function formatRelativeTime(value: unknown): string {
  const timestamp = typeof value === "number" ? value : Date.parse(String(value ?? ""));
  if (!Number.isFinite(timestamp)) return "-";
  const diffMs = Date.now() - timestamp;
  const suffix = diffMs >= 0 ? "ago" : "from now";
  const abs = Math.abs(diffMs);
  if (abs < 60_000) return `${Math.max(1, Math.round(abs / 1000))}s ${suffix}`;
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)}m ${suffix}`;
  if (abs < 86_400_000) return `${Math.round(abs / 3_600_000)}h ${suffix}`;
  return `${Math.round(abs / 86_400_000)}d ${suffix}`;
}

/**
 * Render a single cell of an action-result list, respecting the
 * declared column `format`. Strings shaped like "code" wrap in
 * `<Typography.Text code>`; statuses become `<StatusTag>`; booleans
 * become coloured `<Tag>`; durations and bytes get human-formatted.
 */
export function renderListCell(value: unknown, column: ResultListColumn): React.ReactNode {
  if (column.format === "status") return <StatusTag value={value === true ? "TRUE" : value === false ? "FALSE" : String(value ?? "")} />;
  if (column.format === "boolean") return <Tag color={value ? "green" : "default"}>{value ? "YES" : "NO"}</Tag>;
  if (column.format === "datetime") return value ? String(value) : "-";
  const text =
    value === undefined || value === null || value === ""
      ? "-"
      : column.format === "duration"
      ? formatDurationMs(value)
      : column.format === "relativeTime"
      ? formatRelativeTime(value)
      : column.format === "bytes"
      ? formatBytes(value)
      : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
  const node = column.format === "code"
    ? <Typography.Text code ellipsis={column.ellipsis ? { tooltip: text } : false}>{text}</Typography.Text>
    : <Typography.Text ellipsis={column.ellipsis ? { tooltip: text } : false}>{text}</Typography.Text>;
  return column.copyable && text !== "-" ? <Typography.Text copyable={{ text }}>{node}</Typography.Text> : node;
}

/**
 * Stable row key for action-result list rows. Falls back to a JSON
 * digest when no id/key/name field is present.
 */
export function resultRowKey(row: Record<string, unknown>, index?: number): string {
  return String(row.id ?? row.key ?? row.name ?? index ?? JSON.stringify(row));
}

/**
 * Poll the backend for a command's terminal state. Used immediately
 * after creating an ACTION_EXECUTE command from the Service drawer
 * to give the operator a live status update.
 */
export async function waitForCommandResult(commandId: string): Promise<Command> {
  const terminal = new Set(["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"]);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const command = await apiFetch<Command>(`/api/admin/commands/${commandId}`);
    if (terminal.has(command.status)) return command;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return await apiFetch<Command>(`/api/admin/commands/${commandId}`);
}

export function isTerminalCommandStatus(status: string): boolean {
  return ["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"].includes(status);
}

/**
 * Surface the one-time generated key delivered by the ephemeral cache
 * layer (see CE ADR-0001) — only readable on the first command-detail
 * fetch. Subsequent fetches return "[REDACTED]" and this helper hides
 * those.
 */
export function generatedKeyFromCommand(command: Command | null): string | undefined {
  const resultData = command?.result?.data;
  if (resultData && typeof resultData === "object" && !Array.isArray(resultData)) {
    const generatedKey = (resultData as Record<string, unknown>).generatedKey;
    if (typeof generatedKey === "string" && generatedKey.length > 0 && generatedKey !== "[REDACTED]") return generatedKey;
  }
  return undefined;
}

/**
 * Heuristic: actions that may take longer than a single drawer modal
 * is willing to block on get poll-after-create UX. Currently triggered
 * by long `timeoutSeconds`, `session`-category actions, or any action
 * whose name contains "rebuild".
 */
export function isLongRunningAction(action: Action): boolean {
  return Boolean(
    (action.timeoutSeconds && action.timeoutSeconds > 60) ||
      action.category === "session" ||
      action.name.toLowerCase().includes("rebuild"),
  );
}

/**
 * Extract per-account status entries from a service's reported
 * `health.details.accounts`. Used by the Account Pool drawer card.
 */
export function accountStatusesFromHealth(health: Record<string, unknown> | null | undefined): AccountStatus[] {
  const details = health?.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return [];
  const accounts = (details as { accounts?: unknown }).accounts;
  return Array.isArray(accounts)
    ? accounts.filter((item): item is AccountStatus => Boolean(item) && typeof item === "object")
    : [];
}
