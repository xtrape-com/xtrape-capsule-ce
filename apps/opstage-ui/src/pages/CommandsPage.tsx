import { Alert, Button, Card, Collapse, Descriptions, Drawer, Input, Popconfirm, Select, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiFetch, apiList } from "../api.js";
import { JsonBlock, StatusTag } from "../components.js";
import { useI18n } from "../i18n.js";
import { formatDurationMs } from "../lib/format.js";
import { queryString, sameFilters, searchFilters, useQueryData } from "../lib/list-helpers.js";
import { defaultPage, type Command, type PageState } from "../lib/types.js";

type CommandFilters = {
  status?: string;
  type?: string;
  actionName?: string;
  agentId?: string;
  serviceId?: string;
};

/**
 * Command list + detail. Auto-refreshes every 5s so PENDING / RUNNING
 * commands tick forward in the table without the operator clicking
 * Refresh.
 *
 * Default filter is `type=ACTION_EXECUTE` — internal ACTION_PREPARE
 * commands are created by the UI on every action panel open and would
 * otherwise dominate the list. Operators can opt back into "show all"
 * via the dedicated button.
 */
export function CommandsPage() {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const [filters, setFilters] = React.useState<CommandFilters>(() =>
    searchFilters<CommandFilters>(location.search, ["status", "type", "actionName", "agentId", "serviceId"], { type: "ACTION_EXECUTE" }),
  );
  const [actionNameDraft, setActionNameDraft] = React.useState(filters.actionName ?? "");
  const [idFilters, setIdFilters] = React.useState<{ agentId?: string; serviceId?: string }>({
    agentId: filters.agentId,
    serviceId: filters.serviceId,
  });
  const [page, setPage] = React.useState<PageState>(defaultPage);
  const updateFilters = (next: CommandFilters) => {
    setFilters(next);
    setPage(defaultPage);
    navigate(`${location.pathname}${queryString(next)}`, { replace: true });
  };
  const { data, loading, reload } = useQueryData(
    () => apiList<Command>(`/api/admin/commands${queryString({ ...filters, ...page })}`),
    [filters.status, filters.type, filters.actionName, filters.agentId, filters.serviceId, page.page, page.pageSize],
    5000,
  );
  const [selected, setSelected] = React.useState<Command | null>(null);
  const openCommand = async (id: string) => setSelected(await apiFetch<Command>(`/api/admin/commands/${id}`));
  const commandHint = filters.type === "ACTION_EXECUTE"
    ? t("command.defaultFilterHint")
    : filters.type
    ? t("command.filteredTypeHint", { type: filters.type })
    : t("command.allTypesHint");
  React.useEffect(() => {
    const next = searchFilters<CommandFilters>(location.search, ["status", "type", "actionName", "agentId", "serviceId"], { type: "ACTION_EXECUTE" });
    setFilters((current) => (sameFilters(current, next) ? current : next));
    setActionNameDraft(next.actionName ?? "");
    setIdFilters({ agentId: next.agentId, serviceId: next.serviceId });
    setPage(defaultPage);
  }, [location.search]);

  return (
    <Card title={t("command.title")} extra={<Button onClick={reload}>{t("action.refresh")}</Button>}>
      <Alert type="info" showIcon style={{ marginBottom: 16 }} message={commandHint} />
      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search
          placeholder={t("command.actionName")}
          allowClear
          value={actionNameDraft}
          onChange={(event) => setActionNameDraft(event.target.value)}
          onSearch={(actionName) => updateFilters({ ...filters, actionName })}
          style={{ width: 220 }}
        />
        <Select
          allowClear
          placeholder={t("command.type")}
          style={{ width: 180 }}
          value={filters.type}
          onChange={(type) => updateFilters({ ...filters, type })}
          options={["ACTION_EXECUTE", "ACTION_PREPARE"].map((value) => ({ value, label: value }))}
        />
        <Select
          allowClear
          placeholder={t("common.status")}
          style={{ width: 180 }}
          value={filters.status}
          onChange={(status) => updateFilters({ ...filters, status })}
          options={["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"].map((value) => ({ value, label: value }))}
        />
        <Input
          placeholder={t("command.agentId")}
          allowClear
          value={idFilters.agentId}
          onChange={(event) => setIdFilters({ ...idFilters, agentId: event.target.value })}
          style={{ width: 220 }}
        />
        <Input
          placeholder={t("command.serviceId")}
          allowClear
          value={idFilters.serviceId}
          onChange={(event) => setIdFilters({ ...idFilters, serviceId: event.target.value })}
          style={{ width: 220 }}
        />
        <Button onClick={() => updateFilters({ ...filters, agentId: idFilters.agentId, serviceId: idFilters.serviceId })}>
          {t("command.applyIdFilters")}
        </Button>
        <Button onClick={() => updateFilters({ ...filters, type: undefined })}>{t("command.showAllTypes")}</Button>
        <Button
          onClick={() => {
            setActionNameDraft("");
            setIdFilters({});
            updateFilters({ type: "ACTION_EXECUTE" });
          }}
        >
          {t("command.resetFilters")}
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={data?.data ?? []}
        scroll={{ x: 1400 }}
        pagination={{
          current: data?.pagination?.page ?? page.page,
          pageSize: data?.pagination?.pageSize ?? page.pageSize,
          total: data?.pagination?.total,
          showSizeChanger: true,
          onChange: (nextPage, nextPageSize) => setPage({ page: nextPage, pageSize: nextPageSize }),
        }}
        onRow={(row) => ({ onClick: () => void openCommand(row.id) })}
        columns={[
          { title: t("common.id"), dataIndex: "id", render: (v) => <Typography.Text code copyable>{String(v)}</Typography.Text> },
          { title: t("command.type"), dataIndex: "type", render: (v) => <Tag>{String(v)}</Tag> },
          { title: "Action", dataIndex: "actionName" },
          { title: t("common.status"), dataIndex: "status", render: (v) => <StatusTag value={v} /> },
          { title: t("command.agentId"), dataIndex: "agentId", render: (v) => <Typography.Text code copyable>{String(v)}</Typography.Text> },
          { title: t("command.serviceId"), dataIndex: "serviceId", render: (v) => <Typography.Text code copyable>{String(v)}</Typography.Text> },
          { title: t("common.createdAt"), dataIndex: "createdAt" },
          { title: t("command.completedAt"), dataIndex: "completedAt" },
          { title: t("command.duration"), dataIndex: "durationMs", render: (v) => (typeof v === "number" ? formatDurationMs(v) : "-") },
          {
            title: t("command.errorCode"),
            dataIndex: "errorCode",
            render: (v) => (v ? <Typography.Text type="danger" code>{String(v)}</Typography.Text> : "-"),
          },
          {
            title: t("common.operation"),
            render: (_, row) => (
              <Space>
                {["PENDING", "RUNNING"].includes(row.status) ? (
                  <Popconfirm
                    title={t("confirm.cancelCommand")}
                    onConfirm={async (event) => {
                      event?.stopPropagation();
                      await apiFetch(`/api/admin/commands/${row.id}/cancel`, { method: "POST" });
                      message.success(t("command.cancelled"));
                      void reload();
                    }}
                  >
                    <Button danger size="small" onClick={(event) => event.stopPropagation()}>
                      {t("action.cancel")}
                    </Button>
                  </Popconfirm>
                ) : null}
                {["FAILED", "EXPIRED", "CANCELLED"].includes(row.status) ? (
                  <Popconfirm
                    title={t("confirm.retryCommand")}
                    onConfirm={async (event) => {
                      event?.stopPropagation();
                      await apiFetch(`/api/admin/commands/${row.id}/retry`, { method: "POST" });
                      message.success(t("command.retried"));
                      void reload();
                    }}
                  >
                    <Button size="small" onClick={(event) => event.stopPropagation()}>
                      {t("command.retry")}
                    </Button>
                  </Popconfirm>
                ) : null}
              </Space>
            ),
          },
        ] as ColumnsType<Command>}
      />
      <Drawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.id}
        width={860}
        extra={
          <Button disabled={!selected} onClick={() => selected && void openCommand(selected.id)}>
            {t("action.refresh")}
          </Button>
        }
      >
        <Descriptions
          bordered
          column={1}
          items={
            selected
              ? [
                  { key: "status", label: t("common.status"), children: <StatusTag value={selected.status} /> },
                  { key: "type", label: t("command.type"), children: <Tag>{selected.type}</Tag> },
                  { key: "action", label: "Action", children: selected.actionName },
                  {
                    key: "agentId",
                    label: t("command.agentId"),
                    children: <Typography.Text code copyable>{selected.agentId}</Typography.Text>,
                  },
                  {
                    key: "serviceId",
                    label: t("command.serviceId"),
                    children: <Typography.Text code copyable>{selected.serviceId}</Typography.Text>,
                  },
                  { key: "errorCode", label: t("command.errorCode"), children: selected.errorCode ?? "-" },
                  { key: "errorMessage", label: t("command.errorMessage"), children: selected.errorMessage ?? "-" },
                  { key: "createdAt", label: t("command.createdAt"), children: selected.createdAt },
                  { key: "startedAt", label: t("command.startedAt"), children: selected.startedAt ?? "-" },
                  { key: "completedAt", label: t("command.completedAt"), children: selected.completedAt ?? "-" },
                  {
                    key: "duration",
                    label: t("command.duration"),
                    children: typeof selected.durationMs === "number" ? formatDurationMs(selected.durationMs) : "-",
                  },
                ]
              : []
          }
        />
        <Collapse
          style={{ marginTop: 24 }}
          items={[
            { key: "payload", label: "Payload", children: <JsonBlock value={selected?.payload} /> },
            {
              key: "result",
              label: "Result / Error",
              children: <JsonBlock value={selected?.result ?? { errorCode: selected?.errorCode, errorMessage: selected?.errorMessage }} />,
            },
          ]}
        />
      </Drawer>
    </Card>
  );
}
