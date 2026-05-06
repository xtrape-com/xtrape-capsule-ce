export function redact(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/opstage_(reg|agent)_[A-Za-z0-9_-]+/g, "opstage_$1_[REDACTED]");
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redact);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k,v]) => [/token|secret|password|authorization/i.test(k) ? [k,"[REDACTED]"] : [k,redact(v)]]));
}
