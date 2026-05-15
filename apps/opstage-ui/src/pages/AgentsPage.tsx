import { Button, Card, Descriptions, Drawer, Input, Popconfirm, Select, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiFetch, apiList } from "../api.js";
import { ShortIdText, StatusTag } from "../components.js";
import { useI18n } from "../i18n.js";
import { queryString, sameFilters, searchFilters, useQueryData } from "../lib/list-helpers.js";
import { defaultPage, type Agent, type PageState } from "../lib/types.js";

/**
 * Agent inventory page. Filter state mirrors into the URL so an operator
 * can share a deep link to "all OFFLINE agents matching 'capi-'".
 *
 * Disable / Enable / Revoke are guarded by Popconfirm — revoke is
 * irreversible (re-registration required) and immediately revokes all
 * ACTIVE agent tokens on the backend.
 */
export function AgentsPage() {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const [filters, setFilters] = React.useState<{ q?: string; status?: string }>(() =>
    searchFilters<{ q?: string; status?: string }>(location.search, ["q", "status"], {}),
  );
  const [qDraft, setQDraft] = React.useState(filters.q ?? "");
  const [page, setPage] = React.useState<PageState>(defaultPage);
  const updateFilters = (next: { q?: string; status?: string }) => {
    setFilters(next);
    setPage(defaultPage);
    navigate(`${location.pathname}${queryString(next)}`, { replace: true });
  };
  const { data, loading, reload } = useQueryData(
    () => apiList<Agent>(`/api/admin/agents${queryString({ ...filters, ...page })}`),
    [filters.q, filters.status, page.page, page.pageSize],
  );
  const [selected, setSelected] = React.useState<Agent | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  React.useEffect(() => {
    const next = searchFilters<{ q?: string; status?: string }>(location.search, ["q", "status"], {});
    setFilters((current) => (sameFilters(current, next) ? current : next));
    setQDraft(next.q ?? "");
    setPage(defaultPage);
  }, [location.search]);
  const openAgent = async (id: string) => setSelected(await apiFetch<Agent>(`/api/admin/agents/${id}`));
  const refreshAgents = async () => {
    setRefreshing(true);
    try {
      await reload();
      if (selected) await openAgent(selected.id);
      message.success(t("common.refreshed"));
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  };
  const openAgentServices = (agentId: string) => navigate(`/services?agentId=${encodeURIComponent(agentId)}`);
  return (
    <Card
      title={t("menu.agents")}
      extra={
        <Button loading={refreshing} onClick={() => void refreshAgents()}>
          {t("action.refresh")}
        </Button>
      }
    >
      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search
          placeholder={t("common.searchCodeName")}
          allowClear
          value={qDraft}
          onChange={(event) => setQDraft(event.target.value)}
          onSearch={(q) => updateFilters({ ...filters, q })}
          style={{ width: 240 }}
        />
        <Select
          allowClear
          placeholder={t("common.status")}
          style={{ width: 160 }}
          value={filters.status}
          onChange={(status) => updateFilters({ ...filters, status })}
          options={["PENDING", "ONLINE", "OFFLINE", "DISABLED", "REVOKED"].map((value) => ({ value, label: value }))}
        />
        <Button
          onClick={() => {
            setQDraft("");
            updateFilters({});
          }}
        >
          {t("agent.resetFilters")}
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={data?.data ?? []}
        scroll={{ x: 1200 }}
        pagination={{
          current: data?.pagination?.page ?? page.page,
          pageSize: data?.pagination?.pageSize ?? page.pageSize,
          total: data?.pagination?.total,
          showSizeChanger: true,
          onChange: (nextPage, nextPageSize) => setPage({ page: nextPage, pageSize: nextPageSize }),
        }}
        onRow={(row) => ({ onClick: () => void openAgent(row.id) })}
        columns={[
          { title: t("common.id"), dataIndex: "id", render: (v) => <ShortIdText value={String(v)} /> },
          { title: t("common.code"), dataIndex: "code" },
          { title: t("common.name"), dataIndex: "name" },
          {
            title: t("common.mode"),
            dataIndex: "mode",
            render: (value) => (
              <Space>
                <Typography.Text>{String(value)}</Typography.Text>
                {value === "node" && <Tag color="blue">experimental</Tag>}
              </Space>
            ),
          },
          { title: t("agent.serviceCount"), dataIndex: "serviceCount" },
          { title: t("common.runtime"), dataIndex: "runtime" },
          { title: t("common.status"), dataIndex: "status", render: (v) => <StatusTag value={v} /> },
          { title: "Heartbeat", dataIndex: "lastHeartbeatAt" },
          {
            title: t("common.operation"),
            render: (_, row) => (
              <Space>
                {row.status === "REVOKED" ? null : row.status === "DISABLED" ? (
                  <Popconfirm
                    title={t("confirm.enableAgent")}
                    onConfirm={async (event) => {
                      event?.stopPropagation();
                      await apiFetch(`/api/admin/agents/${row.id}/enable`, { method: "POST" });
                      message.success(t("user.enabled"));
                      void reload();
                    }}
                  >
                    <Button size="small" onClick={(event) => event.stopPropagation()}>
                      {t("action.enable")}
                    </Button>
                  </Popconfirm>
                ) : (
                  <Popconfirm
                    title={t("confirm.disableAgent")}
                    onConfirm={async (event) => {
                      event?.stopPropagation();
                      await apiFetch(`/api/admin/agents/${row.id}/disable`, { method: "POST" });
                      message.success(t("user.disabled"));
                      void reload();
                    }}
                  >
                    <Button size="small" onClick={(event) => event.stopPropagation()}>
                      {t("action.disable")}
                    </Button>
                  </Popconfirm>
                )}
                <Button
                  size="small"
                  onClick={(event) => {
                    event.stopPropagation();
                    openAgentServices(row.id);
                  }}
                >
                  {t("agent.viewServices")}
                </Button>
                {row.status === "REVOKED" ? null : (
                  <Popconfirm
                    title={t("confirm.revokeAgent")}
                    onConfirm={async (event) => {
                      event?.stopPropagation();
                      await apiFetch(`/api/admin/agents/${row.id}/revoke`, { method: "POST" });
                      message.success(t("registration.revoked"));
                      void reload();
                    }}
                  >
                    <Button danger size="small" onClick={(event) => event.stopPropagation()}>
                      {t("action.revoke")}
                    </Button>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ] as ColumnsType<Agent>}
      />
      <Drawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.code}
        width={780}
        extra={
          <Button disabled={!selected} loading={refreshing} onClick={() => void refreshAgents()}>
            {t("action.refresh")}
          </Button>
        }
      >
        <Descriptions
          bordered
          column={1}
          items={
            selected
              ? Object.entries(selected)
                  .filter(([k]) => k !== "services")
                  .map(([key, value]) => ({
                    key,
                    label: key,
                    children: key === "id" ? <ShortIdText value={String(value ?? "")} /> : String(value ?? "-"),
                  }))
              : []
          }
        />
        <Typography.Title level={4} style={{ marginTop: 24 }}>
          {t("menu.services")}
        </Typography.Title>
        <Table
          rowKey="id"
          dataSource={selected?.services ?? []}
          pagination={false}
          columns={[
            { title: t("common.code"), dataIndex: "code" },
            { title: t("common.name"), dataIndex: "name" },
            { title: t("common.status"), dataIndex: "status", render: (v) => <StatusTag value={v} /> },
            { title: t("common.health"), dataIndex: "healthStatus", render: (v) => <StatusTag value={v} /> },
          ]}
        />
      </Drawer>
    </Card>
  );
}
