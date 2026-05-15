import { Button, Card, Space, Statistic, Table, Typography } from "antd";
import { apiFetch } from "../api.js";
import { StatusTag } from "../components.js";
import { useI18n } from "../i18n.js";
import { formatTimestampSeconds } from "../lib/format.js";
import { useQueryData } from "../lib/list-helpers.js";
import type { DashboardSummary } from "../lib/types.js";

/**
 * Operator landing page: workspace summary, four KPI tiles, recent
 * commands, recent audit events. Auto-refreshes every 5 seconds because
 * the most common reason to look here is "is anything moving right now".
 */
export function DashboardPage() {
  const { t } = useI18n();
  const { data, loading, reload } = useQueryData<DashboardSummary>(
    () => apiFetch("/api/admin/dashboard/summary"),
    [],
    5000,
  );
  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Space style={{ justifyContent: "space-between", width: "100%" }}>
        <Typography.Title>{t("dashboard.title")}</Typography.Title>
        <Button onClick={reload}>{t("action.refresh")}</Button>
      </Space>
      <Space wrap>
        <Card>
          <Statistic title={t("dashboard.workspace")} value={data?.workspace.name ?? "-"} />
        </Card>
        <Card>
          <Statistic title={t("dashboard.onlineAgents")} value={data?.agentCounts.ONLINE ?? 0} loading={loading} />
        </Card>
        <Card>
          <Statistic title={t("dashboard.healthyServices")} value={data?.serviceCounts.HEALTHY ?? 0} loading={loading} />
        </Card>
        <Card>
          <Statistic title={t("dashboard.runningCommands")} value={data?.commandCounts.RUNNING ?? 0} loading={loading} />
        </Card>
        <Card>
          <Statistic title={t("dashboard.auditEvents")} value={data?.auditEventCount ?? 0} loading={loading} />
        </Card>
      </Space>
      <Card title={t("dashboard.recentCommands")}>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={data?.recentCommands ?? []}
          pagination={false}
          columns={[
            { title: t("common.time"), dataIndex: "createdAt", render: formatTimestampSeconds },
            { title: "Action", dataIndex: "actionName" },
            { title: t("common.status"), dataIndex: "status", render: (v) => <StatusTag value={String(v)} /> },
          ]}
        />
      </Card>
      <Card title={t("dashboard.recentAuditEvents")}>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={data?.recentAuditEvents ?? []}
          pagination={false}
          columns={[
            { title: t("common.time"), dataIndex: "createdAt" },
            { title: t("common.actor"), dataIndex: "actorType" },
            { title: "Action", dataIndex: "action" },
            { title: t("common.result"), dataIndex: "result", render: (v) => <StatusTag value={String(v)} /> },
          ]}
        />
      </Card>
    </Space>
  );
}
