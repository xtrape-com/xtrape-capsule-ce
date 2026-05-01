import { randomBytes } from "node:crypto";

export * from "./ids.js";
export * from "./tokens.js";

export type CompactIdPrefix = "usr" | "wks" | "agt" | "tok" | "svc" | "hlr" | "cfg" | "act" | "cmd" | "crs" | "aud" | "set";

export function createId(prefix: CompactIdPrefix): string {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}

export function safeJsonStringify(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function parseJsonObject(value: string | null | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
}

const sensitiveKeyPattern = /token|secret|password|cookie|authorization|api[-_]?key/i;

export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => redactSecrets(item)) as T;
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    result[key] = sensitiveKeyPattern.test(key) ? "[REDACTED]" : redactSecrets(nested);
  }
  return result as T;
}
