import { describe, expect, it } from "vitest";
import { createActionCommandRequestSchema, createUserRequestSchema, registerAgentRequestSchema, resetUserPasswordRequestSchema } from "./index.js";

describe("contract schemas", () => {
  it("validates user management password policy", () => {
    expect(() => createUserRequestSchema.parse({ username: "a", password: "short" })).toThrow();
    expect(createUserRequestSchema.parse({ username: "a", password: "long-enough-123" }).role).toBe("viewer");
    expect(() => resetUserPasswordRequestSchema.parse({ password: "short" })).toThrow();
  });

  it("validates agent registration token prefix", () => {
    expect(() => registerAgentRequestSchema.parse({ registrationToken: "bad", agent: { code: "a", mode: "embedded" } })).toThrow();
  });

  it("accepts action command payloads", () => {
    expect(createActionCommandRequestSchema.parse({ payload: { message: "hello" }, confirmation: true }).payload?.message).toBe("hello");
  });
});
