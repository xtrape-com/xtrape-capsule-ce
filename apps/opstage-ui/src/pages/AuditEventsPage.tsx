import { Button, Card, Input, Select, Space, Table, Typography } from "antd";
import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiList } from "../api.js";
import { StatusTag } from "../components.js";
import { useI18n } from "../i18n.js";
import { downloadBlob, queryString, sameFilters, searchFilters, useQueryData } from "../lib/list-helpers.js";
import { defaultPage, type AuditEvent, type PageState } from "../lib/types.js";

type AuditFilters = {
  actorType?: string;
  result?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  from?: string;
  to?: string;
};

/**
 * Audit event list. Mirrors filters into the URL; auto-refreshes every
 * 5s so new events (login, command lifecycle, maintenance run, etc.)
 * show up while the operator is on the page. CSV export uses the same
 * filters so the download matches what's visible.
 */
export function AuditEventsPage() {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const [filters, setFilters] = React.useState<AuditFilters>(() =>
    searchFilters<AuditFilters>(location.search, ["actorType", "result", "action", "targetType", "targetId", "from", "to"], {}),
  );
  const [actionDraft, setActionDraft] = React.useState(filters.action ?? "");
  const [targetTypeDraft, setTargetTypeDraft] = React.useState(filters.targetType ?? "");
  const [targetIdDraft, setTargetIdDraft] = React.useState(filters.targetId ?? "");
  const [draftRange, setDraftRange] = React.useState<{ from?: string; to?: string }>({ from: filters.from, to: filters.to });
  const [page, setPage] = React.useState<PageState>(defaultPage);
  const updateFilters = (next: AuditFilters) => {
    setFilters(next);
    setPage(defaultPage);
    navigate(`${location.pathname}${queryString(next)}`, { replace: true });
  };
  const auditQuery = queryString({ ...filters, ...page });
  const exportCsvQuery = queryString({ ...filters, format: "csv" });
  const { data, loading, reload } = useQueryData(
    () => apiList<AuditEvent>(`/api/admin/audit-events${auditQuery}`),
    [filters.actorType, filters.result, filters.action, filters.targetType, filters.targetId, filters.from, filters.to, page.page, page.pageSize],
    5000,
  );
  React.useEffect(() => {
    const next = searchFilters<AuditFilters>(location.search, ["actorType", "result", "action", "targetType", "targetId", "from", "to"], {});
    setFilters((current) => (sameFilters(current, next) ? current : next));
    setActionDraft(next.action ?? "");
    setTargetTypeDraft(next.targetType ?? "");
    setTargetIdDraft(next.targetId ?? "");
    setDraftRange({ from: next.from, to: next.to });
    setPage(defaultPage);
  }, [location.search]);

  return (
    <Card
      title={t("audit.title")}
      extra={
        <Space>
          <Button onClick={() => void downloadBlob(`/api/admin/audit-events/export${exportCsvQuery}`, "audit-events.csv")}>
            {t("action.exportCsv")}
          </Button>
          <Button onClick={reload}>{t("action.refresh")}</Button>
        </Space>
      }
    >
      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search
          placeholder="Action"
          allowClear
          value={actionDraft}
          onChange={(event) => setActionDraft(event.target.value)}
          onSearch={(action) => updateFilters({ ...filters, action })}
          style={{ width: 220 }}
        />
        <Select
          allowClear
          placeholder="Actor"
          style={{ width: 140 }}
          value={filters.actorType}
          onChange={(actorType) => updateFilters({ ...filters, actorType })}
          options={["USER", "AGENT", "SYSTEM"].map((value) => ({ value, label: value }))}
        />
        <Select
          allowClear
          placeholder="Result"
          style={{ width: 140 }}
          value={filters.result}
          onChange={(result) => updateFilters({ ...filters, result })}
          options={["SUCCESS", "FAILURE"].map((value) => ({ value, label: value }))}
        />
        <Input.Search
          placeholder={t("audit.targetType")}
          allowClear
          value={targetTypeDraft}
          onChange={(event) => setTargetTypeDraft(event.target.value)}
          onSearch={(targetType) => updateFilters({ ...filters, targetType })}
          style={{ width: 180 }}
        />
        <Input.Search
          placeholder={t("audit.targetId")}
          allowClear
          value={targetIdDraft}
          onChange={(event) => setTargetIdDraft(event.target.value)}
          onSearch={(targetId) => updateFilters({ ...filters, targetId })}
          style={{ width: 240 }}
        />
        <Input
          placeholder={t("audit.fromPlaceholder")}
          allowClear
          value={draftRange.from}
          onChange={(event) => setDraftRange({ ...draftRange, from: event.target.value })}
          style={{ width: 260 }}
        />
        <Input
          placeholder={t("audit.toPlaceholder")}
          allowClear
          value={draftRange.to}
          onChange={(event) => setDraftRange({ ...draftRange, to: event.target.value })}
          style={{ width: 260 }}
        />
        <Button onClick={() => updateFilters({ ...filters, from: draftRange.from, to: draftRange.to })}>
          {t("audit.applyTimeRange")}
        </Button>
        <Button
          onClick={() => {
            setActionDraft("");
            setTargetTypeDraft("");
            setTargetIdDraft("");
            setDraftRange({});
            updateFilters({});
          }}
        >
          {t("audit.resetFilters")}
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={data?.data ?? []}
        pagination={{
          current: data?.pagination?.page ?? page.page,
          pageSize: data?.pagination?.pageSize ?? page.pageSize,
          total: data?.pagination?.total,
          showSizeChanger: true,
          onChange: (nextPage, nextPageSize) => setPage({ page: nextPage, pageSize: nextPageSize }),
        }}
        columns={[
          { title: t("common.time"), dataIndex: "createdAt" },
          { title: t("common.actor"), dataIndex: "actorType" },
          { title: "Action", dataIndex: "action" },
          { title: t("audit.targetType"), dataIndex: "targetType" },
          {
            title: t("audit.targetId"),
            dataIndex: "targetId",
            render: (v) => (v ? <Typography.Text code copyable>{String(v)}</Typography.Text> : "-"),
          },
          { title: t("common.result"), dataIndex: "result", render: (v) => <StatusTag value={String(v)} /> },
          { title: t("common.message"), dataIndex: "message" },
        ]}
      />
    </Card>
  );
}
