import { describe, expect, it } from "vitest";
import { redactAuditMetadata, redactSecrets } from "./index";

describe("redactSecrets (key-based, used at trust boundaries)", () => {
  it("redacts values whose key matches the sensitive pattern", () => {
    expect(
      redactSecrets({
        upstream: "ok",
        token: "x",
        agentToken: "y",
        password: "p",
        cookie: "c",
        apiKey: "k1",
        api_key: "k2",
        nested: { secret: "s", normal: 1 },
      }),
    ).toEqual({
      upstream: "ok",
      token: "[REDACTED]",
      agentToken: "[REDACTED]",
      password: "[REDACTED]",
      cookie: "[REDACTED]",
      apiKey: "[REDACTED]",
      api_key: "[REDACTED]",
      nested: { secret: "[REDACTED]", normal: 1 },
    });
  });

  it("keeps non-sensitive structure intact", () => {
    const input = { foo: "bar", count: 5, ok: true, list: [1, 2, 3] };
    expect(redactSecrets(input)).toEqual(input);
  });
});

describe("redactAuditMetadata (value-based, used inside writeAudit)", () => {
  it("preserves audit-style field names with token-substring keys", () => {
    expect(
      redactAuditMetadata({
        revokedTokens: 1,
        tokenCount: 5,
        passwordChangedAt: "2026-05-07T12:00:00Z",
        sessionId: "ses_abc",
        cookieExpired: true,
      }),
    ).toEqual({
      revokedTokens: 1,
      tokenCount: 5,
      passwordChangedAt: "2026-05-07T12:00:00Z",
      sessionId: "ses_abc",
      cookieExpired: true,
    });
  });

  it("masks string values that embed an opstage token", () => {
    expect(
      redactAuditMetadata({
        message: "leaked opstage_agent_abcDEF inside an audit field",
        tokenSpec: "opstage_reg_zzz123",
        innocent: "agt_abc123",
      }),
    ).toEqual({
      message: "leaked opstage_agent_[REDACTED] inside an audit field",
      tokenSpec: "opstage_reg_[REDACTED]",
      innocent: "agt_abc123",
    });
  });

  it("walks arrays and nested objects", () => {
    expect(
      redactAuditMetadata({
        rotated: [
          { tokenId: "tok_1", note: "see opstage_agent_xyz" },
          { tokenId: "tok_2", note: "ok" },
        ],
        nested: { passwordPolicy: { minLength: 12 } },
      }),
    ).toEqual({
      rotated: [
        { tokenId: "tok_1", note: "see opstage_agent_[REDACTED]" },
        { tokenId: "tok_2", note: "ok" },
      ],
      nested: { passwordPolicy: { minLength: 12 } },
    });
  });

  it("leaves primitives alone", () => {
    expect(redactAuditMetadata(undefined)).toBeUndefined();
    expect(redactAuditMetadata(null)).toBeNull();
    expect(redactAuditMetadata(42)).toBe(42);
    expect(redactAuditMetadata(true)).toBe(true);
    expect(redactAuditMetadata("opstage_reg_abc")).toBe("opstage_reg_[REDACTED]");
    expect(redactAuditMetadata("plain")).toBe("plain");
  });
});
