import { describe, expect, it } from "vitest";
import { requireOperator, requireOwner, requireRole } from "./rbac.js";

describe("RBAC helpers", () => {
  it("allows owners to perform owner and operator actions", () => {
    expect(() => requireOwner({ role: "owner" })).not.toThrow();
    expect(() => requireOperator({ role: "owner" })).not.toThrow();
  });

  it("allows operators for operator actions but not owner-only actions", () => {
    expect(() => requireOperator({ role: "operator" })).not.toThrow();
    expect(() => requireOwner({ role: "operator" })).toThrow("Insufficient permissions");
  });

  it("blocks viewers from mutation roles", () => {
    expect(() => requireRole({ role: "viewer" }, ["viewer"])).not.toThrow();
    expect(() => requireOperator({ role: "viewer" })).toThrow("Insufficient permissions");
  });
});
