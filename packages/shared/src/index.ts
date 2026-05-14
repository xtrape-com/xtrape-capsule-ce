import { randomBytes } from "node:crypto";

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

const sensitiveKeyPattern = /token|secret|password|cookie|authorization|api[-_]?key\b|generatedKey|rawKey|plainTextKey/i;

/**
 * Redact by KEY NAME. Use this at trust-boundary writes where the data
 * shape is operator-influenced or agent-reported (service report manifest,
 * health details, command result data, error details) and we want to
 * strip values whose KEY suggests a secret.
 *
 * Do not use this on backend-constructed audit metadata: the redactor
 * matches `token`, `password`, `cookie`, etc. as substrings of keys, so a
 * legitimate audit field like `tokenCount` or `passwordChangedAt` would
 * silently lose its value. Use redactAuditMetadata() there instead.
 */
export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => redactSecrets(item)) as T;
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    result[key] = sensitiveKeyPattern.test(key) ? "[REDACTED]" : redactSecrets(nested);
  }
  return result as T;
}

const opstageTokenPattern = /opstage_[a-z]+_[A-Za-z0-9_-]+/g;

/**
 * Redact by VALUE SHAPE. Use this on backend-constructed audit metadata
 * where field NAMES carry meaning (tokenCount, passwordChangedAt,
 * sessionId, ...) and must not be clobbered. Only string values that
 * literally embed an opstage_*_ token are masked; everything else
 * (numbers, booleans, dates, identifiers) survives intact.
 *
 * Returns a deep-copied structure with the same shape.
 */
export function redactAuditMetadata<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(opstageTokenPattern, (match) => {
      const prefixEnd = match.lastIndexOf("_");
      return `${match.slice(0, prefixEnd + 1)}[REDACTED]`;
    }) as unknown as T;
  }
  if (Array.isArray(value)) return value.map(item => redactAuditMetadata(item)) as T;
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    result[key] = redactAuditMetadata(nested);
  }
  return result as T;
}
