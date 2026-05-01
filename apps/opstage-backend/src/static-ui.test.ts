import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveStaticFile, staticContentType } from "./static-ui.js";

describe("static UI helpers", () => {
  it("resolves assets and falls back to SPA index", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "opstage-static-"));
    await writeFile(path.join(dir, "index.html"), "index");
    await writeFile(path.join(dir, "asset.txt"), "asset");

    expect(await resolveStaticFile(dir, "/asset.txt")).toBe(path.join(dir, "asset.txt"));
    expect(await resolveStaticFile(dir, "/commands/123")).toBe(path.join(dir, "index.html"));
    expect(await resolveStaticFile(dir, "/../secret.txt")).toBeNull();
    expect(staticContentType("asset.css")).toContain("text/css");
    expect(staticContentType("asset.unknown")).toBe("application/octet-stream");

    await rm(dir, { recursive: true, force: true });
  });
});
