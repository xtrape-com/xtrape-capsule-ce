import { Button, Card, Collapse, Form, InputNumber, Space, Statistic, Table, Tag, Tooltip, Typography, message } from "antd";
import React from "react";
import { apiFetch } from "../api.js";
import { JsonBlock } from "../components.js";
import { useI18n } from "../i18n.js";
import { downloadBlob, useQueryData } from "../lib/list-helpers.js";
import { diagnosticRows, hasMetricWarning, metricRows } from "../lib/metrics.js";
import type { MaintenanceResult, MaintenanceSettings, Metrics } from "../lib/types.js";

/**
 * Small wrapper around `Statistic` that paints the value red when the
 * accompanying tooltip warns the operator. Extracted only because two
 * places render it.
 */
function MetricStatCard({ title, tooltip, value, warning }: { title: string; tooltip: string; value: number; warning?: boolean }) {
  return (
    <Card size="small">
      <Tooltip title={tooltip}>
        <Statistic title={title} value={value} valueStyle={warning ? { color: "#cf1322" } : undefined} />
      </Tooltip>
    </Card>
  );
}

/**
 * Owner-only settings + diagnostics page. Lets the operator tune
 * maintenance thresholds, trigger a maintenance sweep on demand,
 * download a SQLite backup, and inspect live operational metrics +
 * runtime diagnostics.
 */
export function SettingsPage() {
  const { t } = useI18n();
  const [form] = Form.useForm<MaintenanceSettings>();
  const { data, loading, reload } = useQueryData<MaintenanceSettings>(() => apiFetch("/api/admin/settings/maintenance"));
  const metrics = useQueryData<Metrics>(() => apiFetch("/api/admin/metrics"), [], 5000);
  const diagnostics = useQueryData<Record<string, unknown>>(() => apiFetch("/api/admin/diagnostics/runtime"));
  const [result, setResult] = React.useState<MaintenanceResult | null>(null);
  const [running, setRunning] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    if (data) form.setFieldsValue(data);
  }, [data, form]);

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card title={t("settings.maintenanceSettings")} loading={loading} extra={<Button onClick={reload}>{t("action.refresh")}</Button>}>
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            setSaving(true);
            try {
              await apiFetch<MaintenanceSettings>("/api/admin/settings/maintenance", {
                method: "PATCH",
                body: JSON.stringify(values),
              });
              message.success(t("settings.saveSuccess"));
              void reload();
            } catch (err) {
              message.error(err instanceof Error ? err.message : t("settings.maintenanceFailed"));
            } finally {
              setSaving(false);
            }
          }}
        >
          <Form.Item name="agentOfflineThresholdSeconds" label={t("settings.agentOfflineThresholdSeconds")} rules={[{ required: true }]}>
            <InputNumber min={1} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="auditRetentionDays" label={t("settings.auditRetentionDays")} rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="maintenanceIntervalSeconds" label={t("settings.maintenanceIntervalSeconds")} rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={saving}>
              {t("action.edit")}
            </Button>
            <Button
              loading={running}
              onClick={async () => {
                setRunning(true);
                try {
                  const output = await apiFetch<MaintenanceResult>("/api/admin/maintenance/run", { method: "POST" });
                  setResult(output);
                  message.success(t("settings.maintenanceSuccess"));
                } catch (err) {
                  message.error(err instanceof Error ? err.message : t("settings.maintenanceFailed"));
                } finally {
                  setRunning(false);
                }
              }}
            >
              {t("action.runMaintenanceNow")}
            </Button>
            <Button onClick={() => void downloadBlob("/api/admin/backup/sqlite", "opstage-backup.db", { method: "POST" })}>
              {t("action.downloadSqliteBackup")}
            </Button>
          </Space>
        </Form>
      </Card>
      {result && (
        <Card title={t("settings.lastMaintenanceResult")}>
          <JsonBlock value={result} />
        </Card>
      )}
      <Card title={t("settings.metrics")} loading={metrics.loading}>
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Space wrap>
            <MetricStatCard
              title={t("metrics.agentCommandPolls")}
              tooltip={t("metrics.agentCommandPollsHelp")}
              value={metrics.data?.operational?.agentCommandPolls ?? 0}
            />
            <MetricStatCard
              title={t("metrics.commandsDispatched")}
              tooltip={t("metrics.commandsDispatchedHelp")}
              value={metrics.data?.operational?.commandsDispatched ?? 0}
            />
            <MetricStatCard
              title={t("metrics.commandsCompleted")}
              tooltip={t("metrics.commandsCompletedHelp")}
              value={metrics.data?.operational?.commandsCompleted ?? 0}
            />
            <MetricStatCard
              title={t("metrics.commandsFailed")}
              tooltip={t("metrics.commandsFailedHelp")}
              value={metrics.data?.operational?.commandsFailed ?? 0}
              warning={hasMetricWarning("commandsFailed", metrics.data?.operational?.commandsFailed ?? 0)}
            />
            <MetricStatCard
              title={t("metrics.prepareFailures")}
              tooltip={t("metrics.prepareFailuresHelp")}
              value={(metrics.data?.operational?.actionPrepareTimeouts ?? 0) + (metrics.data?.operational?.actionPrepareFailures ?? 0)}
              warning={((metrics.data?.operational?.actionPrepareTimeouts ?? 0) + (metrics.data?.operational?.actionPrepareFailures ?? 0)) > 0}
            />
            <MetricStatCard
              title={t("metrics.oversizedResultsRejected")}
              tooltip={t("metrics.oversizedResultsRejectedHelp")}
              value={metrics.data?.operational?.oversizedCommandResultsRejected ?? 0}
              warning={hasMetricWarning(
                "oversizedCommandResultsRejected",
                metrics.data?.operational?.oversizedCommandResultsRejected ?? 0,
              )}
            />
          </Space>
          <Table
            size="small"
            rowKey="key"
            pagination={false}
            dataSource={metricRows(metrics.data?.operational)}
            columns={[
              { title: t("common.key"), dataIndex: "key" },
              {
                title: t("metrics.value"),
                dataIndex: "value",
                render: (value, row) => (
                  <Typography.Text type={hasMetricWarning(String(row.key), Number(value)) ? "danger" : undefined}>
                    {String(value)}
                  </Typography.Text>
                ),
              },
            ]}
          />
          <Collapse size="small" items={[{ key: "rawMetrics", label: t("metrics.rawJson"), children: <JsonBlock value={metrics.data} /> }]} />
        </Space>
      </Card>
      <Card title={t("settings.diagnostics")} loading={diagnostics.loading}>
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Table
            size="small"
            rowKey={(row) => `${row.category}:${row.key}`}
            pagination={false}
            dataSource={diagnosticRows(diagnostics.data)}
            columns={[
              { title: t("diagnostics.category"), dataIndex: "category", render: (v) => <Tag>{String(v)}</Tag> },
              { title: t("common.key"), dataIndex: "key" },
              { title: t("metrics.value"), dataIndex: "value" },
            ]}
          />
          <Collapse size="small" items={[{ key: "rawDiagnostics", label: t("diagnostics.rawJson"), children: <JsonBlock value={diagnostics.data} /> }]} />
        </Space>
      </Card>
    </Space>
  );
}
