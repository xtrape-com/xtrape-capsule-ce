/**
 * Render a byte count in the shortest reasonable human unit
 * (B / KB / MB / GB / TB) with one decimal place above the byte
 * boundary. Returns "-" for non-finite values. Mirrors the duration
 * helper below.
 */
export function formatBytes(value: unknown): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = Math.abs(bytes);
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  const signed = bytes < 0 ? -size : size;
  return `${signed.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

/**
 * Render a millisecond duration in the shortest reasonable human unit:
 *
 *   42ms · 1.2s · 12s · 1.2m · 12m · 1.2h · 24h
 *
 * Used by Commands list / detail and by action-result lists with
 * `format: "duration"` columns. Returns "-" when the value is not a
 * finite number, which is the safe default when the backend has not
 * filled in the field yet (e.g. RUNNING commands have no durationMs).
 */
export function formatDurationMs(value: unknown): string {
  const ms = Number(value);
  if (!Number.isFinite(ms)) return "-";
  if (Math.abs(ms) < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (Math.abs(seconds) < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = seconds / 60;
  if (Math.abs(minutes) < 60) return `${minutes.toFixed(minutes < 10 ? 1 : 0)}m`;
  const hours = minutes / 60;
  return `${hours.toFixed(hours < 10 ? 1 : 0)}h`;
}
