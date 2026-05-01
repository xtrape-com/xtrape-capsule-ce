import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { JsonBlock, StatusTag } from "./components.js";

describe("shared UI components", () => {
  it("renders status text", () => {
    const html = renderToStaticMarkup(<StatusTag value="ONLINE" />);
    expect(html).toContain("ONLINE");
  });

  it("renders json values safely", () => {
    const html = renderToStaticMarkup(<JsonBlock value={{ nested: { ok: true } }} />);
    expect(html).toContain("nested");
    expect(html).toContain("ok");
  });
});
