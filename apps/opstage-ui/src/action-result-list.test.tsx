import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { formatBytes, formatDurationMs, renderListCell, resolveRowPayload, resultRowKey } from "./App.js";

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
});
