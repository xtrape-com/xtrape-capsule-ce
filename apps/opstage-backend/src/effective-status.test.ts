import { describe, expect, test } from "vitest";
import { deriveEffectiveStatus, type AgentRow, type CapsuleServiceRow } from "./app.js";

/**
 * `deriveEffectiveStatus` is the operator-facing status of a service at query
 * time. It folds in agent state (revoked / disabled / offline / online) and
 * heartbeat freshness on top of the stored health-derived `row.status`.
 *
 * The mapping was tightened in v0.2: an agent whose stored row is OFFLINE now
 * surfaces as service `OFFLINE` (was: `STALE`). Operators read STALE as
 * "heartbeat went quiet between maintenance sweeps", OFFLINE as
 * "agent is missing / disabled / revoked / already known offline".
 */
describe("deriveEffectiveStatus", () => {
  const offlineThresholdSeconds = 60;
  const nowMs = Date.parse("2026-05-14T12:00:00Z");

  const baseAgent: AgentRow = {
    id: "agt_test",
    workspaceId: "ws_default",
    code: "test",
    name: null,
    mode: "embedded",
    runtime: "nodejs",
    status: "ONLINE",
    lastHeartbeatAt: new Date(nowMs - 5_000).toISOString(), // fresh: 5s ago
    disabledAt: null,
    revokedAt: null,
    createdAt: new Date(nowMs - 3_600_000).toISOString(),
    updatedAt: new Date(nowMs - 5_000).toISOString(),
  };

  const baseService: CapsuleServiceRow = {
    id: "svc_test",
    workspaceId: "ws_default",
    agentId: "agt_test",
    code: "svc",
    name: "Test service",
    description: null,
    version: "0.2.0",
    runtime: "nodejs",
    status: "HEALTHY",
    healthStatus: "UP",
    manifestJson: "{}",
    lastReportedAt: new Date(nowMs - 5_000).toISOString(),
    lastHealthAt: new Date(nowMs - 5_000).toISOString(),
    createdAt: new Date(nowMs - 3_600_000).toISOString(),
    updatedAt: new Date(nowMs - 5_000).toISOString(),
  };

  test("missing agent row → OFFLINE", () => {
    expect(deriveEffectiveStatus(baseService, undefined, offlineThresholdSeconds, nowMs)).toBe("OFFLINE");
  });

  test("agent REVOKED → OFFLINE", () => {
    const agent: AgentRow = { ...baseAgent, status: "REVOKED", revokedAt: new Date(nowMs - 60_000).toISOString() };
    expect(deriveEffectiveStatus(baseService, agent, offlineThresholdSeconds, nowMs)).toBe("OFFLINE");
  });

  test("agent DISABLED → OFFLINE", () => {
    const agent: AgentRow = { ...baseAgent, status: "DISABLED", disabledAt: new Date(nowMs - 60_000).toISOString() };
    expect(deriveEffectiveStatus(baseService, agent, offlineThresholdSeconds, nowMs)).toBe("OFFLINE");
  });

  test("agent stored as OFFLINE → OFFLINE (not STALE)", () => {
    // Regression: v0.1 mapped this to STALE. v0.2 maps it to OFFLINE so
    // operators don't see a "maybe coming back" indicator on agents the
    // maintenance sweep has already finalized as offline.
    const agent: AgentRow = { ...baseAgent, status: "OFFLINE" };
    expect(deriveEffectiveStatus(baseService, agent, offlineThresholdSeconds, nowMs)).toBe("OFFLINE");
  });

  test("ONLINE agent with stale heartbeat → STALE", () => {
    const agent: AgentRow = { ...baseAgent, lastHeartbeatAt: new Date(nowMs - 5 * 60_000).toISOString() };
    expect(deriveEffectiveStatus(baseService, agent, offlineThresholdSeconds, nowMs)).toBe("STALE");
  });

  test("ONLINE agent with no heartbeat at all → STALE", () => {
    const agent: AgentRow = { ...baseAgent, lastHeartbeatAt: null };
    expect(deriveEffectiveStatus(baseService, agent, offlineThresholdSeconds, nowMs)).toBe("STALE");
  });

  test("ONLINE agent + fresh heartbeat → stored service status", () => {
    expect(deriveEffectiveStatus({ ...baseService, status: "HEALTHY" }, baseAgent, offlineThresholdSeconds, nowMs)).toBe("HEALTHY");
    expect(deriveEffectiveStatus({ ...baseService, status: "UNHEALTHY" }, baseAgent, offlineThresholdSeconds, nowMs)).toBe("UNHEALTHY");
    expect(deriveEffectiveStatus({ ...baseService, status: "UNKNOWN" }, baseAgent, offlineThresholdSeconds, nowMs)).toBe("UNKNOWN");
  });

  test("PENDING agent (just registered, no heartbeat yet) → STALE", () => {
    const agent: AgentRow = { ...baseAgent, status: "PENDING", lastHeartbeatAt: null };
    expect(deriveEffectiveStatus(baseService, agent, offlineThresholdSeconds, nowMs)).toBe("STALE");
  });
});
