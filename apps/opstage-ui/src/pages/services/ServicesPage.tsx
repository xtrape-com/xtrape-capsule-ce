import { Button, Card, Input, Select, Space, Table, Tag, Typography, message } from "antd";
import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiFetch, apiList } from "../../api.js";
import { StatusTag } from "../../components.js";
import { useI18n } from "../../i18n.js";
import { queryString, useQueryData } from "../../lib/list-helpers.js";
import type { PageState, Service } from "../../lib/types.js";
import { defaultPage } from "../../lib/types.js";
import { ServiceDrawer } from "./ServiceDrawer.js";

/**
 * `/services` page: lists Capsule services with filter/agent-scoping
 * controls. Selecting a row opens the `ServiceDrawer` for that service.
 * Filters mirror to the `?agentId=` query string for shareable links.
 */
export function ServicesPage() {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const initialAgentId = new URLSearchParams(location.search).get("agentId") ?? "";
  const [filters, setFilters] = React.useState<{ q?: string; status?: string; healthStatus?: string; agentId?: string }>(
    initialAgentId ? { agentId: initialAgentId } : {},
  );
  const [agentIdDraft, setAgentIdDraft] = React.useState(initialAgentId);
  const [page, setPage] = React.useState<PageState>(defaultPage);
  const updateFilters = (next: { q?: string; status?: string; healthStatus?: string; agentId?: string }) => {
    setFilters(next);
    setPage(defaultPage);
  };
  const { data, loading, reload } = useQueryData(
    () => apiList<Service>(`/api/admin/capsule-services${queryString({ ...filters, ...page })}`),
    [filters.q, filters.status, filters.healthStatus, filters.agentId, page.page, page.pageSize],
  );
  const [selected, setSelected] = React.useState<Service | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);

  React.useEffect(() => {
    const agentId = new URLSearchParams(location.search).get("agentId") ?? "";
    setAgentIdDraft(agentId);
    setFilters((current) => (current.agentId === (agentId || undefined) ? current : { ...current, agentId: agentId || undefined }));
    setPage(defaultPage);
  }, [location.search]);

  const applyAgentFilter = () => {
    const nextAgentId = agentIdDraft.trim();
    updateFilters({ ...filters, agentId: nextAgentId || undefined });
    navigate(nextAgentId ? `/services?agentId=${encodeURIComponent(nextAgentId)}` : "/services", { replace: true });
  };
  const resetServiceFilters = () => {
    setAgentIdDraft("");
    updateFilters({});
    navigate("/services", { replace: true });
  };
  const openService = async (id: string) => setSelected(await apiFetch<Service>(`/api/admin/capsule-services/${id}`));
  const refreshServices = async () => {
    setRefreshing(true);
    try {
      await reload();
      if (selected) await openService(selected.id);
      message.success(t("common.refreshed"));
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Card title={t("service.title")} extra={<Button loading={refreshing} onClick={() => void refreshServices()}>{t("action.refresh")}</Button>}>
      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search
          placeholder={t("common.searchCodeName")}
          allowClear
          onSearch={(q) => updateFilters({ ...filters, q })}
          style={{ width: 240 }}
        />
        <Select
          allowClear
          placeholder={t("service.serviceStatus")}
          style={{ width: 160 }}
          onChange={(status) => updateFilters({ ...filters, status })}
          options={["HEALTHY", "UNHEALTHY", "UNKNOWN", "STALE", "OFFLINE"].map((value) => ({ value, label: value }))}
        />
        <Select
          allowClear
          placeholder={t("service.healthStatus")}
          style={{ width: 160 }}
          onChange={(healthStatus) => updateFilters({ ...filters, healthStatus })}
          options={["UP", "DEGRADED", "DOWN", "UNKNOWN"].map((value) => ({ value, label: value }))}
        />
        <Input
          placeholder={t("command.agentId")}
          allowClear
          value={agentIdDraft}
          onChange={(event) => setAgentIdDraft(event.target.value)}
          style={{ width: 220 }}
        />
        <Button onClick={applyAgentFilter}>{t("service.applyAgentFilter")}</Button>
        <Button onClick={resetServiceFilters}>{t("service.resetFilters")}</Button>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={data?.data ?? []}
        scroll={{ x: 1100 }}
        pagination={{
          current: data?.pagination?.page ?? page.page,
          pageSize: data?.pagination?.pageSize ?? page.pageSize,
          total: data?.pagination?.total,
          showSizeChanger: true,
          onChange: (nextPage, nextPageSize) => setPage({ page: nextPage, pageSize: nextPageSize }),
        }}
        onRow={(row) => ({ onClick: () => void openService(row.id) })}
        columns={[
          { title: t("common.code"), dataIndex: "code" },
          { title: t("common.name"), dataIndex: "name" },
          {
            title: t("command.agentId"),
            dataIndex: "agentId",
            render: (v) => (
              <Typography.Text code copyable>
                {String(v)}
              </Typography.Text>
            ),
          },
          { title: t("common.version"), dataIndex: "version" },
          { title: t("common.status"), dataIndex: "status", render: (v) => <StatusTag value={v} /> },
          { title: t("common.health"), dataIndex: "healthStatus", render: (v) => <StatusTag value={v} /> },
          { title: t("service.lastReportedAt"), dataIndex: "lastReportedAt" },
        ]}
      />
      <ServiceDrawer
        service={selected}
        refreshing={refreshing}
        onClose={() => setSelected(null)}
        onRefresh={() => void refreshServices()}
        onCommandCreated={() => {
          message.success(t("command.createdWaitAgent"));
          void refreshServices();
        }}
      />
    </Card>
  );
}
