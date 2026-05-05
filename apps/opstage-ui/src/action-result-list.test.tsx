import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { diagnosticRows, formatBytes, formatDurationMs, hasMetricWarning, metricRows, renderListCell, resolveRowPayload, resultRowKey } from "./App.js";

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: null, isLoading: false, isFetching: false, error: null, refetch: vi.fn() }),
}));

describe("action result list helpers", () => {
  it("resolves row action payload templates", () => {
    const payload = resolveRowPayload(
      { accountId: "$row.id", nested: { email: "$row.account.email" }, keep: true },
      { id: "account-1", account: { email: "user@example.com" } },
    );
    expect(payload).toEqual({ accountId: "account-1", nested: { email: "user@example.com" }, keep: true });
  });

  it("formats duration and bytes cells", () => {
    expect(formatDurationMs(500)).toBe("500ms");
    expect(formatDurationMs(1500)).toBe("1.5s");
    expect(formatBytes(1536)).toBe("1.5 KB");
    const durationHtml = renderToStaticMarkup(<>{renderListCell(65_000, { key: "elapsed", format: "duration" })}</>);
    expect(durationHtml).toContain("1.1m");
    const bytesHtml = renderToStaticMarkup(<>{renderListCell(1024 * 1024, { key: "size", format: "bytes" })}</>);
    expect(bytesHtml).toContain("1.0 MB");
  });

  it("uses stable row keys", () => {
    expect(resultRowKey({ id: "row-id" }, 3)).toBe("row-id");
    expect(resultRowKey({ key: "row-key" }, 3)).toBe("row-key");
    expect(resultRowKey({ name: "row-name" }, 3)).toBe("row-name");
    expect(resultRowKey({}, 3)).toBe("3");
  });

  it("sorts metric rows for stable diagnostics display", () => {
    expect(metricRows({ zeta: 2, alpha: 1 })).toEqual([
      { key: "alpha", value: 1 },
      { key: "zeta", value: 2 },
    ]);
    expect(metricRows(undefined)).toEqual([]);
  });

  it("identifies warning metric values", () => {
    expect(hasMetricWarning("commandsFailed", 1)).toBe(true);
    expect(hasMetricWarning("actionPrepareTimeouts", 1)).toBe(true);
    expect(hasMetricWarning("commandsDispatched", 1)).toBe(false);
    expect(hasMetricWarning("commandsFailed", 0)).toBe(false);
  });

  it("extracts structured diagnostic rows", () => {
    const rows = diagnosticRows({
      version: "0.1.0",
      node: "v20",
      memory: { heapUsed: 1024 },
      config: { host: "127.0.0.1", maintenance: { auditRetentionDays: 30 } }
    });
    expect(rows).toContainEqual({ category: "runtime", key: "version", value: "0.1.0" });
    expect(rows).toContainEqual({ category: "memory", key: "heapUsed", value: "1.0 KB" });
    expect(rows).toContainEqual({ category: "maintenance", key: "auditRetentionDays", value: "30" });
  });
});
