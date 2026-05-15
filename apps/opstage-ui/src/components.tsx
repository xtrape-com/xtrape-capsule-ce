import { Tag, Typography } from "antd";
import { compactId } from "./lib/format.js";

const statusColor: Record<string, string> = {
  ONLINE: "green", ACTIVE: "green", HEALTHY: "green", UP: "green", SUCCEEDED: "green", SUCCESS: "green",
  PENDING: "blue", RUNNING: "processing", USED: "default",
  OFFLINE: "orange", UNKNOWN: "default", DEGRADED: "orange", UNHEALTHY: "orange",
  DOWN: "red", FAILED: "red", REVOKED: "red", FAILURE: "red", DISABLED: "red", EXPIRED: "orange", CANCELLED: "default"
};

export function StatusTag({ value }: { value?: string | null }) {
  return <Tag color={statusColor[value ?? ""] ?? "default"}>{value ?? "-"}</Tag>;
}

export function JsonBlock({ value }: { value: unknown }) {
  return <pre style={{ background: "#f6f8fa", padding: 12, borderRadius: 8, overflow: "auto", maxHeight: 280 }}>{JSON.stringify(value ?? {}, null, 2)}</pre>;
}

export function ShortIdText({ value }: { value?: string | null }) {
  const text = String(value ?? "");
  if (!text) return <>-</>;
  return (
    <Typography.Text code copyable={{ text }} title={text}>
      {compactId(text)}
    </Typography.Text>
  );
}
