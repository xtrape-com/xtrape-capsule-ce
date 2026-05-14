import { App as AntApp, Alert, Badge, Button, Card, Collapse, Descriptions, Drawer, Form, Input, InputNumber, Layout, Menu, Modal, Popconfirm, Select, Space, Spin, Statistic, Switch, Table, Tag, Tooltip, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import React from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ApiError, apiDownload, apiFetch, apiList, logout, me, type SessionData } from "./api.js";
import { JsonBlock, StatusTag } from "./components.js";
import { useI18n } from "./i18n.js";
import { LanguageSwitcher } from "./pages/LanguageSwitcher.js";
import { LoginPage } from "./pages/LoginPage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { UsersPage } from "./pages/UsersPage.js";
import { RegistrationTokensPage } from "./pages/RegistrationTokensPage.js";
import { AgentsPage } from "./pages/AgentsPage.js";
import { CommandsPage } from "./pages/CommandsPage.js";
import { AuditEventsPage } from "./pages/AuditEventsPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { queryString, searchFilters, sameFilters, useQueryData, downloadBlob } from "./lib/list-helpers.js";
import type {
  AccountStatus,
  Action,
  ActionPrepare,
  Agent,
  AuditEvent,
  Command,
  ConfigItem,
  DashboardSummary,
  DiagnosticRow,
  MaintenanceResult,
  MaintenanceSettings,
  Metrics,
  PageState,
  RegistrationToken,
  ResultDetailField,
  ResultDetailMeta,
  ResultListColumn,
  ResultListMeta,
  ResultListRowAction,
  Service,
  User,
} from "./lib/types.js";
import { defaultPage } from "./lib/types.js";

function Shell({ session, onLogout }: { session: SessionData; onLogout: () => void }) {
  const { t } = useI18n();
  const location = useLocation();
  const menuEntries: Array<[string, string]> = [
    ["/", t("menu.dashboard")], ["/users", t("menu.users")], ["/registration-tokens", t("menu.registrationTokens")], ["/agents", t("menu.agents")],
    ["/services", t("menu.services")], ["/commands", t("menu.commands")], ["/audit-events", t("menu.auditEvents")], ["/settings", t("menu.settings")]
  ];
  const menuItems = menuEntries.map(([key, label]) => ({ key, label: <Link to={key}>{label}</Link> }));
  const selected = menuItems.find(item => item.key !== "/" && location.pathname.startsWith(item.key))?.key ?? "/";
  return <Layout style={{ minHeight: "100vh" }}>
    <Layout.Sider width={240}>
      <Typography.Title level={4} style={{ color: "white", padding: 16, margin: 0 }}>Opstage CE</Typography.Title>
      <Menu theme="dark" mode="inline" selectedKeys={[selected]} items={menuItems} />
    </Layout.Sider>
    <Layout>
      <Layout.Header style={{ background: "white", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 24px" }}>
        <Space><Badge status="processing" /><span>{session.user.displayName ?? session.user.username}</span><Tag>{session.user.role}</Tag></Space>
        <Space><LanguageSwitcher /><Button onClick={async () => { await logout(); onLogout(); }}>{t("action.logout")}</Button></Space>
      </Layout.Header>
      <Layout.Content style={{ padding: 24 }}><Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/registration-tokens" element={<RegistrationTokensPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/services" element={<Services />} />
        <Route path="/commands" element={<CommandsPage />} />
        <Route path="/audit-events" element={<AuditEventsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes></Layout.Content>
    </Layout>
  </Layout>;
}

function Services() {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const initialAgentId = new URLSearchParams(location.search).get("agentId") ?? "";
  const [filters, setFilters] = React.useState<{ q?: string; status?: string; healthStatus?: string; agentId?: string }>(initialAgentId ? { agentId: initialAgentId } : {});
  const [agentIdDraft, setAgentIdDraft] = React.useState(initialAgentId);
  const [page, setPage] = React.useState<PageState>(defaultPage);
  const updateFilters = (next: { q?: string; status?: string; healthStatus?: string; agentId?: string }) => { setFilters(next); setPage(defaultPage); };
  const { data, loading, reload } = useQueryData(() => apiList<Service>(`/api/admin/capsule-services${queryString({ ...filters, ...page })}`), [filters.q, filters.status, filters.healthStatus, filters.agentId, page.page, page.pageSize]);
  const [selected, setSelected] = React.useState<Service | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  React.useEffect(() => {
    const agentId = new URLSearchParams(location.search).get("agentId") ?? "";
    setAgentIdDraft(agentId);
    setFilters((current) => current.agentId === (agentId || undefined) ? current : { ...current, agentId: agentId || undefined });
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
  return <Card title={t("service.title")} extra={<Button loading={refreshing} onClick={() => void refreshServices()}>{t("action.refresh")}</Button>}>
    <Space style={{ marginBottom: 16 }} wrap>
      <Input.Search placeholder={t("common.searchCodeName")} allowClear onSearch={(q) => updateFilters({ ...filters, q })} style={{ width: 240 }} />
      <Select allowClear placeholder={t("service.serviceStatus")} style={{ width: 160 }} onChange={(status) => updateFilters({ ...filters, status })} options={["HEALTHY", "UNHEALTHY", "UNKNOWN", "STALE", "OFFLINE"].map(value => ({ value, label: value }))} />
      <Select allowClear placeholder={t("service.healthStatus")} style={{ width: 160 }} onChange={(healthStatus) => updateFilters({ ...filters, healthStatus })} options={["UP", "DEGRADED", "DOWN", "UNKNOWN"].map(value => ({ value, label: value }))} />
      <Input placeholder={t("command.agentId")} allowClear value={agentIdDraft} onChange={(event) => setAgentIdDraft(event.target.value)} style={{ width: 220 }} />
      <Button onClick={applyAgentFilter}>{t("service.applyAgentFilter")}</Button>
      <Button onClick={resetServiceFilters}>{t("service.resetFilters")}</Button>
    </Space>
    <Table rowKey="id" loading={loading} dataSource={data?.data ?? []} scroll={{ x: 1100 }} pagination={{ current: data?.pagination?.page ?? page.page, pageSize: data?.pagination?.pageSize ?? page.pageSize, total: data?.pagination?.total, showSizeChanger: true, onChange: (nextPage, nextPageSize) => setPage({ page: nextPage, pageSize: nextPageSize }) }} onRow={(row) => ({ onClick: () => void openService(row.id) })} columns={[
      { title: t("common.code"), dataIndex: "code" }, { title: t("common.name"), dataIndex: "name" }, { title: t("command.agentId"), dataIndex: "agentId", render: (v) => <Typography.Text code copyable>{String(v)}</Typography.Text> }, { title: t("common.version"), dataIndex: "version" }, { title: t("common.status"), dataIndex: "status", render: (v) => <StatusTag value={v} /> }, { title: t("common.health"), dataIndex: "healthStatus", render: (v) => <StatusTag value={v} /> }, { title: t("service.lastReportedAt"), dataIndex: "lastReportedAt" }
    ]} />
    <ServiceDrawer service={selected} refreshing={refreshing} onClose={() => setSelected(null)} onRefresh={() => void refreshServices()} onCommandCreated={() => { message.success(t("command.createdWaitAgent")); void refreshServices(); }} />
  </Card>;
}


const actionCategoryOrder = ["account", "item-management", "api-key", "session", "runtime-config", "diagnostics", "advanced", "other"];

function actionCategoryLabel(category: string, t: (key: never, vars?: Record<string, string | number>) => string) {
  const key = `actionCategory.${category}`;
  const translated = t(key as never);
  return translated === key ? category : translated;
}

function groupActions(actions: Action[] | undefined) {
  const groups = new Map<string, Action[]>();
  for (const action of actions ?? []) {
    if (action.category === "page-action" || action.category === "row-action") continue;
    const category = action.category || "other";
    groups.set(category, [...(groups.get(category) ?? []), action]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (actionCategoryOrder.indexOf(a) === -1 ? 999 : actionCategoryOrder.indexOf(a)) - (actionCategoryOrder.indexOf(b) === -1 ? 999 : actionCategoryOrder.indexOf(b)) || a.localeCompare(b))
    .map(([category, items]) => ({ category, actions: items.sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.label.localeCompare(b.label)) }));
}

function defaultPayloadForAction(action: Action): Record<string, unknown> {
  const schema = action.inputSchema;
  const properties = schema?.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return {};
  return Object.fromEntries(Object.entries(properties as Record<string, { default?: unknown; type?: string }>).map(([key, meta]) => {
    if (meta.default !== undefined) return [key, meta.default];
    if (meta.type === "number" || meta.type === "integer") return [key, 0];
    if (meta.type === "boolean") return [key, false];
    if (meta.type === "array") return [key, []];
    if (meta.type === "object") return [key, {}];
    return [key, ""];
  }));
}


interface SchemaProperty {
  type?: string | string[];
  title?: string;
  description?: string;
  enum?: Array<string | number | boolean>;
  enumLabels?: string[];
  default?: unknown;
  maxLength?: number;
  format?: "password" | "textarea" | string;
  placeholder?: string;
  readOnly?: boolean;
}

function getSchemaProperties(action: Action | null): Record<string, SchemaProperty> {
  const properties = action?.inputSchema?.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return {};
  return properties as Record<string, SchemaProperty>;
}

function SchemaPayloadFields({ action, initialPayload, setPayload }: { action: Action; initialPayload?: Record<string, unknown>; setPayload: (payload: string) => void }) {
  const { t } = useI18n();
  const [form] = Form.useForm<Record<string, string | number | boolean | undefined>>();
  const properties = getSchemaProperties(action);
  const required = Array.isArray(action.inputSchema?.required) ? action.inputSchema.required as string[] : [];
  React.useEffect(() => {
    const defaults = initialPayload ?? defaultPayloadForAction(action);
    form.setFieldsValue(defaults as Record<string, string | number | boolean | undefined>);
    setPayload(JSON.stringify(defaults, null, 2));
  }, [action, form, initialPayload, setPayload]);
  if (Object.keys(properties).length === 0) return null;
  return <Form
    form={form}
    layout="horizontal"
    labelCol={{ flex: "220px" }}
    wrapperCol={{ flex: 1 }}
    labelAlign="left"
    colon={false}
    onValuesChange={(_, values) => setPayload(JSON.stringify(values, null, 2))}
  >
    {Object.entries(properties).map(([name, property]) => {
      const typeLabel = Array.isArray(property.type) ? property.type.join(" | ") : property.type ?? "string";
      const label = property.title && property.title !== name ? `${property.title} (${name})` : name;
      const extra = t("service.payloadFieldMeta", { name, type: typeLabel, required: required.includes(name) ? t("form.required") : t("form.optional") });
      const rules = required.includes(name) ? [{ required: true, message: `${label} ${t("form.required")}` }] : undefined;
      if (property.enum) {
        return <Form.Item key={name} name={name} label={label} tooltip={property.description} rules={rules} extra={extra}>
          <Select options={property.enum.map((value, index) => ({ value: String(value), label: property.enumLabels?.[index] ?? String(value) }))} />
        </Form.Item>;
      }
      if (property.type === "boolean") {
        return <Form.Item key={name} name={name} label={label} tooltip={property.description} valuePropName="checked" rules={rules} extra={extra}>
          <Switch />
        </Form.Item>;
      }
      if (property.type === "number" || property.type === "integer") {
        return <Form.Item key={name} name={name} label={label} tooltip={property.description} rules={rules} extra={extra}>
          <InputNumber style={{ width: "100%" }} />
        </Form.Item>;
      }
      return <Form.Item key={name} name={name} label={label} tooltip={property.description} rules={rules} extra={extra}>
        {property.format === "textarea"
          ? <Input.TextArea placeholder={property.placeholder ?? String(property.default ?? "")} maxLength={property.maxLength} readOnly={property.readOnly} autoSize={{ minRows: 3, maxRows: 8 }} />
          : property.format === "password" || name.toLowerCase().includes("password")
            ? <Input.Password placeholder={property.placeholder ?? String(property.default ?? "")} maxLength={property.maxLength ?? 4096} readOnly={property.readOnly} />
            : <Input placeholder={property.placeholder ?? String(property.default ?? "")} maxLength={property.maxLength} readOnly={property.readOnly} />}
      </Form.Item>;
    })}
  </Form>;
}

function actionResultData(command: Command | null): Record<string, unknown> | undefined {
  const result = command?.result;
  const data = result && typeof result === "object" && !Array.isArray(result) ? (result as Record<string, unknown>).data : undefined;
  return data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : undefined;
}

function resultListFromCommand(command: Command | null): ResultListMeta | undefined {
  const list = actionResultData(command)?.list;
  if (!list || typeof list !== "object" || Array.isArray(list)) return undefined;
  const meta = list as ResultListMeta;
  return Array.isArray(meta.data) ? meta : undefined;
}

function resultDetailFromCommand(command: Command | null): ResultDetailMeta | undefined {
  return resultDetailFromValue(actionResultData(command)?.detail);
}

function resultDetailFromValue(value: unknown): ResultDetailMeta | undefined {
  const detail = value;
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return undefined;
  const meta = detail as ResultDetailMeta;
  return meta.data && typeof meta.data === "object" && !Array.isArray(meta.data) ? meta : undefined;
}

function inferListColumns(rows: Record<string, unknown>[]): ResultListColumn[] {
  const first = rows[0];
  if (!first) return [];
  return Object.keys(first).slice(0, 8).map((key) => ({ key, label: key }));
}

function getPathValue(row: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, part) => value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined, row);
}

export function resolveRowPayload(template: Record<string, unknown> | undefined, row: Record<string, unknown>): Record<string, unknown> {
  const resolve = (value: unknown): unknown => {
    if (typeof value === "string" && value.startsWith("$row.")) return getPathValue(row, value.slice(5));
    if (Array.isArray(value)) return value.map(resolve);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, resolve(nested)]));
    return value;
  };
  return resolve(template ?? {}) as Record<string, unknown>;
}

// Re-exports preserved so existing tests / external callers that
// imported these helpers from "./App.js" keep working. They now live in
// ./lib/format and ./lib/metrics.
import { formatBytes, formatDurationMs } from "./lib/format.js";
import { diagnosticRows, hasMetricWarning, metricRows } from "./lib/metrics.js";
export { formatBytes, formatDurationMs };
export { diagnosticRows, hasMetricWarning, metricRows };

export function formatRelativeTime(value: unknown): string {
  const timestamp = typeof value === "number" ? value : Date.parse(String(value ?? ""));
  if (!Number.isFinite(timestamp)) return "-";
  const diffMs = Date.now() - timestamp;
  const suffix = diffMs >= 0 ? "ago" : "from now";
  const abs = Math.abs(diffMs);
  if (abs < 60_000) return `${Math.max(1, Math.round(abs / 1000))}s ${suffix}`;
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)}m ${suffix}`;
  if (abs < 86_400_000) return `${Math.round(abs / 3_600_000)}h ${suffix}`;
  return `${Math.round(abs / 86_400_000)}d ${suffix}`;
}

export function renderListCell(value: unknown, column: ResultListColumn) {
  if (column.format === "status") return <StatusTag value={value === true ? "TRUE" : value === false ? "FALSE" : String(value ?? "")} />;
  if (column.format === "boolean") return <Tag color={value ? "green" : "default"}>{value ? "YES" : "NO"}</Tag>;
  if (column.format === "datetime") return value ? String(value) : "-";
  const text = value === undefined || value === null || value === ""
    ? "-"
    : column.format === "duration" ? formatDurationMs(value)
      : column.format === "relativeTime" ? formatRelativeTime(value)
        : column.format === "bytes" ? formatBytes(value)
          : typeof value === "object" ? JSON.stringify(value) : String(value);
  const node = column.format === "code"
    ? <Typography.Text code ellipsis={column.ellipsis ? { tooltip: text } : false}>{text}</Typography.Text>
    : <Typography.Text ellipsis={column.ellipsis ? { tooltip: text } : false}>{text}</Typography.Text>;
  return column.copyable && text !== "-" ? <Typography.Text copyable={{ text }}>{node}</Typography.Text> : node;
}

export function resultRowKey(row: Record<string, unknown>, index?: number): string {
  return String(row.id ?? row.key ?? row.name ?? index ?? JSON.stringify(row));
}

function ResultActionButton({ rowAction, row, rowKey, service, onOpenAction }: { rowAction: ResultListRowAction; row: Record<string, unknown>; rowKey: string; service: Service | null; onOpenAction: (actionName: string, payload: Record<string, unknown>) => Promise<void> }) {
  const { t } = useI18n();
  const [runningRowActionKey, setRunningRowActionKey] = React.useState<string | null>(null);
  const actionKey = `${rowKey}:${rowAction.action}:${rowAction.label}`;
  const sameRowRunning = Boolean(runningRowActionKey?.startsWith(`${rowKey}:`));
  const isRunning = runningRowActionKey === actionKey;
  const targetAction = service?.actions?.find((item) => item.name === rowAction.action);
  const run = async () => {
    setRunningRowActionKey(actionKey);
    try {
      await onOpenAction(rowAction.action, resolveRowPayload(rowAction.payload, row));
    } finally {
      setRunningRowActionKey(null);
    }
  };
  return <Button key={actionKey} size="small" loading={isRunning} danger={rowAction.danger || targetAction?.requiresConfirmation} disabled={!targetAction || (sameRowRunning && !isRunning)} onClick={() => void run()}>{rowAction.label}</Button>;
}

function ActionResultList({ command, service, onOpenAction }: { command: Command | null; service: Service | null; onOpenAction: (actionName: string, payload: Record<string, unknown>) => Promise<void> }) {
  const { t } = useI18n();
  const list = resultListFromCommand(command);
  if (!list) return null;
  const rows = list.data ?? [];
  const columns = list.columns?.length ? list.columns : inferListColumns(rows);
  const tableColumns: ColumnsType<Record<string, unknown>> = columns.map((column) => ({
    title: column.label ?? column.key,
    dataIndex: column.key,
    width: column.width,
    ellipsis: column.ellipsis,
    render: (_value, row) => renderListCell(getPathValue(row, column.key), column),
  }));
  if (list.rowActions?.length) {
    tableColumns.push({
      title: t("common.actions"),
      render: (_value, row, index) => <Space wrap>{list.rowActions!.map((rowAction) => <ResultActionButton key={`${resultRowKey(row, index)}:${rowAction.action}:${rowAction.label}`} rowAction={rowAction} row={row} rowKey={resultRowKey(row, index)} service={service} onOpenAction={onOpenAction} />)}</Space>,
    });
  }
  const pageSize = Number.isFinite(Number(list.pageSize)) && Number(list.pageSize) > 0 ? Number(list.pageSize) : 10;
  return <Card
    size="small"
    title={<Space>{list.title ?? "List"}<Tag>{t("service.listRowCount", { count: rows.length })}</Tag></Space>}
    extra={list.pageActions?.length ? <Space wrap>{list.pageActions.map((pageAction) => <ResultActionButton key={`page:${pageAction.action}:${pageAction.label}`} rowAction={pageAction} row={{}} rowKey="page" service={service} onOpenAction={onOpenAction} />)}</Space> : null}
    style={{ marginTop: 16 }}
  >
    <Table
      size="small"
      rowKey={resultRowKey}
      locale={{ emptyText: list.emptyText ?? t("service.emptyList") }}
      pagination={rows.length > pageSize ? { pageSize, showSizeChanger: true } : false}
      dataSource={rows}
      columns={tableColumns}
    />
  </Card>;
}

function ActionResultDetail({ command, service, onOpenAction }: { command: Command | null; service: Service | null; onOpenAction: (actionName: string, payload: Record<string, unknown>) => Promise<void> }) {
  const detail = resultDetailFromCommand(command);
  if (!detail) return null;
  return <ActionDetailCard detail={detail} service={service} onOpenAction={onOpenAction} />;
}

function ActionDetailCard({ detail, service, onOpenAction }: { detail: ResultDetailMeta; service: Service | null; onOpenAction: (actionName: string, payload: Record<string, unknown>) => Promise<void> }) {
  const data = detail.data ?? {};
  const fields: ResultDetailField[] = detail.fields?.length ? detail.fields : Object.keys(data).slice(0, 12).map((key) => ({ key, label: key }));
  return <Card
    size="small"
    title={detail.title ?? "Detail"}
    extra={detail.actions?.length ? <Space wrap>{detail.actions.map((action) => <ResultActionButton key={`detail:${action.action}:${action.label}`} rowAction={action} row={data} rowKey={String(data.id ?? "detail")} service={service} onOpenAction={onOpenAction} />)}</Space> : null}
    style={{ marginTop: 16 }}
  >
    <Descriptions
      bordered
      size="small"
      column={1}
      items={fields.map((field) => ({
        key: field.key,
        label: field.label ?? field.key,
        children: renderListCell(getPathValue(data, field.key), { key: field.key, format: field.format, copyable: field.copyable }),
      }))}
    />
  </Card>;
}

function ServiceDrawer({ service, refreshing, onClose, onRefresh, onCommandCreated }: { service: Service | null; refreshing?: boolean; onClose: () => void; onRefresh: () => void; onCommandCreated: () => void }) {
  const { t } = useI18n();
  const [action, setAction] = React.useState<Action | null>(null);
  const [payload, setPayload] = React.useState("{}");
  const [initialPayload, setInitialPayload] = React.useState<Record<string, unknown> | undefined>(undefined);
  const [preparedDetail, setPreparedDetail] = React.useState<ResultDetailMeta | undefined>(undefined);
  const [commandResult, setCommandResult] = React.useState<Command | null>(null);
  const [commandRunning, setCommandRunning] = React.useState(false);
  const [prepareLoading, setPrepareLoading] = React.useState(false);
  const [prepareStartedAt, setPrepareStartedAt] = React.useState<number | null>(null);
  const [prepareElapsedMs, setPrepareElapsedMs] = React.useState(0);
  const [prepareError, setPrepareError] = React.useState<{ message: string; code?: string; status?: number; details?: Record<string, unknown> } | null>(null);
  const [autoPollCommandId, setAutoPollCommandId] = React.useState<string | null>(null);
  const [refreshAfterCommandId, setRefreshAfterCommandId] = React.useState<string | null>(null);
  const prepareRequestSeq = React.useRef(0);
  React.useEffect(() => {
    if (!prepareLoading || !prepareStartedAt) return undefined;
    const update = () => setPrepareElapsedMs(Date.now() - prepareStartedAt);
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [prepareLoading, prepareStartedAt]);

  React.useEffect(() => {
    if (!commandResult || commandResult.id !== autoPollCommandId || isTerminalCommandStatus(commandResult.status)) return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const updated = await apiFetch<Command>(`/api/admin/commands/${commandResult.id}`);
        if (cancelled) return;
        setCommandResult(updated);
        if (isTerminalCommandStatus(updated.status)) {
          if (updated.status === "SUCCEEDED") message.success(t("command.completed"));
          else message.error(updated.errorMessage ?? t("command.failed"));
          setAutoPollCommandId(null);
          void onRefresh();
          if (refreshAfterCommandId === updated.id) {
            setRefreshAfterCommandId(null);
            void refreshCurrentActionResult();
          }
        }
      } catch (err) {
        if (!cancelled) message.error(err instanceof Error ? err.message : String(err));
      }
    };
    const timer = window.setInterval(() => void poll(), 2000);
    void poll();
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [commandResult?.id, commandResult?.status, autoPollCommandId, refreshAfterCommandId]);

  async function executeNamedAction(actionName: string, nextPayload: Record<string, unknown>, confirmation?: boolean, options: { silent?: boolean } = {}): Promise<Command | undefined> {
    if (!service) return;
    const targetAction = service.actions?.find((item) => item.name === actionName);
    setCommandRunning(true);
    try {
      const created = await apiFetch<Command>(`/api/admin/capsule-services/${service.id}/actions/${actionName}`, { method: "POST", body: JSON.stringify({ payload: nextPayload, confirmation: confirmation === true }) });
      setCommandResult(created);
      onCommandCreated();
      if (targetAction && isLongRunningAction(targetAction)) {
        setAutoPollCommandId(created.id);
        message.info(t("command.startedAsync"));
        void onRefresh();
        return created;
      }
      const finished = await waitForCommandResult(created.id);
      setCommandResult(finished);
      if (!options.silent) {
        if (finished.status === "SUCCEEDED") message.success(t("command.completed"));
        else message.error(finished.errorMessage ?? t("command.failed"));
      }
      void onRefresh();
      return finished;
    } finally {
      setCommandRunning(false);
    }
  }

  async function refreshCurrentActionResult(): Promise<void> {
    if (!service || !action) return;
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(payload) as Record<string, unknown>; } catch { return; }
    await executeNamedAction(action.name, parsed, false, { silent: true });
  }

  const submitAction = async () => {
    if (!service || !action) return;
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(payload) as Record<string, unknown>; } catch { message.error(t("service.invalidPayload")); return; }
    setCommandResult(null);
    setAutoPollCommandId(null);
    setRefreshAfterCommandId(null);
    await executeNamedAction(action.name, parsed, action.requiresConfirmation);
  };
  const openAction = async (next: Action, payloadOverride?: Record<string, unknown>) => {
    const requestSeq = ++prepareRequestSeq.current;
    const { __detail, ...payloadOverrideForRequest } = payloadOverride ?? {};
    setAction(next);
    setPayload(JSON.stringify({ ...defaultPayloadForAction(next), ...payloadOverrideForRequest }, null, 2));
    setCommandResult(null);
    setCommandRunning(false);
    setAutoPollCommandId(null);
    setRefreshAfterCommandId(null);
    setInitialPayload(undefined);
    setPreparedDetail(resultDetailFromValue(__detail));
    setPrepareError(null);
    if (!service) return;
    setPrepareLoading(true);
    const startedAt = Date.now();
    setPrepareStartedAt(startedAt);
    setPrepareElapsedMs(0);
    try {
      const prepared = await apiFetch<ActionPrepare>(`/api/admin/capsule-services/${service.id}/actions/${next.name}`);
      if (requestSeq !== prepareRequestSeq.current) return;
      const nextPayload = { ...(prepared.initialPayload ?? defaultPayloadForAction(prepared.action)), ...payloadOverrideForRequest };
      setAction(prepared.action);
      setInitialPayload(nextPayload);
      setPreparedDetail(resultDetailFromValue(__detail) ?? resultDetailFromValue(prepared.currentState?.detail));
      setPayload(JSON.stringify(nextPayload, null, 2));
    } catch (err) {
      if (requestSeq !== prepareRequestSeq.current) return;
      const error = err instanceof ApiError
        ? { message: err.message, code: err.code, status: err.status, details: err.details }
        : { message: err instanceof Error ? err.message : String(err) };
      setPrepareError(error);
      message.error(error.message);
      setInitialPayload(undefined);
    } finally {
      if (requestSeq === prepareRequestSeq.current) {
        setPrepareLoading(false);
        setPrepareStartedAt(null);
      }
    }
  };
  const openContextAction = async (actionName: string, nextPayload: Record<string, unknown>) => {
    const targetAction = service?.actions?.find((item) => item.name === actionName);
    if (!targetAction) {
      message.error(`Action not found: ${actionName}`);
      return;
    }
    await openAction(targetAction, nextPayload);
  };
  return <Drawer open={!!service} onClose={onClose} title={service?.name} width={860} extra={<Button disabled={!service} loading={refreshing} onClick={onRefresh}>{t("action.refresh")}</Button>}>
    {service && <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Descriptions bordered column={2} items={["code", "version", "runtime", "status", "healthStatus", "lastReportedAt", "lastHealthAt"].map((key) => ({ key, label: key, children: key.toLowerCase().includes("status") ? <StatusTag value={String((service as unknown as Record<string, unknown>)[key] ?? "")} /> : String((service as unknown as Record<string, unknown>)[key] ?? "-") }))} />
      <Card type="inner" title={t("common.actions")}>
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          {groupActions(service.actions).map((group) => <div key={group.category}>
            <Typography.Text strong>{actionCategoryLabel(group.category, t)}</Typography.Text>
            <div style={{ marginTop: 8 }}><Space wrap>{group.actions.map(a => <Button key={a.id} loading={prepareLoading && action?.id === a.id} danger={a.dangerLevel !== "LOW" || a.requiresConfirmation} onClick={() => void openAction(a)}>{a.label}</Button>)}</Space></div>
          </div>)}
        </Space>
      </Card>
      <Card type="inner" title={t("common.configs")}><Table rowKey="id" pagination={false} dataSource={service.configs ?? []} columns={[{ title: t("common.key"), dataIndex: "configKey" }, { title: t("common.type"), dataIndex: "type" }, { title: t("common.sensitive"), dataIndex: "sensitive", render: (v) => v ? <Tag color="red">{t("common.yes")}</Tag> : <Tag>{t("common.no")}</Tag> }, { title: t("common.preview"), dataIndex: "valuePreview" }, { title: t("common.secretRef"), dataIndex: "secretRef" }]} /></Card>
      {accountStatusesFromHealth(service.health).length > 0 && <Card type="inner" title={t("service.accountStatus")}>
        <Table rowKey={(row) => row.id ?? row.label ?? Math.random().toString(36)} pagination={false} dataSource={accountStatusesFromHealth(service.health)} columns={[
          { title: t("common.id"), dataIndex: "label", render: (_v, row) => row.label ?? row.id ?? "-" },
          { title: t("common.status"), dataIndex: "healthy", render: (v) => <StatusTag value={v ? "HEALTHY" : "UNHEALTHY"} /> },
          { title: t("service.operationStatus"), dataIndex: "operationStatus", render: (v) => <StatusTag value={String(v ?? "IDLE")} /> },
          { title: t("common.message"), dataIndex: "operationMessage", render: (_v, row) => row.operationMessage ?? row.lastError ?? "-" },
          { title: t("service.failures"), dataIndex: "consecutiveFailures" },
          { title: t("service.cooldownMs"), dataIndex: "cooldownRemainingMs" }
        ]} />
      </Card>}
      <Card type="inner" title={t("common.health")}><JsonBlock value={service.health ?? {}} /></Card>
      <Card type="inner" title={t("common.manifest")}><JsonBlock value={service.manifest ?? {}} /></Card>
    </Space>}
    <Modal open={!!action} width={920} title={t("service.executeAction", { label: action?.label ?? "" })} onCancel={() => { prepareRequestSeq.current += 1; setAction(null); setPrepareError(null); setPrepareStartedAt(null); }} onOk={() => void submitAction()} okText={action?.requiresConfirmation ? t("action.confirmRun") : t("action.run")} confirmLoading={commandRunning || prepareLoading} okButtonProps={{ danger: action?.requiresConfirmation, disabled: prepareLoading || Boolean(prepareError) }}>
      <Spin spinning={prepareLoading} tip={t("service.actionPreparing")}>
        {prepareLoading && <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={t("service.actionPreparing")}
          description={t("service.actionPreparingDetail", { elapsed: Math.floor(prepareElapsedMs / 1000), status: service?.status ?? "-" })}
        />}
        {prepareError && <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message={t("service.actionPrepareFailed")}
          description={<Space direction="vertical" style={{ width: "100%" }}>
            <Typography.Text>{`${prepareError.message}${prepareError.code ? ` (${prepareError.code})` : ""}`}</Typography.Text>
            {prepareError.details && <JsonBlock value={prepareError.details} />}
          </Space>}
          action={<Button size="small" onClick={() => action && void openAction(action)}>{t("action.retry")}</Button>}
        />}
        <Typography.Paragraph>{action?.description}</Typography.Paragraph>
        {action?.requiresConfirmation && <Typography.Paragraph type="danger">{t("service.actionRequiresConfirmation")}</Typography.Paragraph>}
        <Typography.Text type="secondary">{t("service.autoPayloadHelp")}</Typography.Text>
        {action && !prepareLoading && <SchemaPayloadFields action={action} initialPayload={initialPayload} setPayload={setPayload} />}
        <Collapse
          size="small"
          style={{ marginTop: 16 }}
          items={[{
            key: "requestJson",
            label: t("service.requestJson"),
            forceRender: true,
            children: <Input.TextArea disabled={prepareLoading} value={payload} onChange={(e) => setPayload(e.target.value)} autoSize={{ minRows: 3, maxRows: 12 }} />,
          }]}
        />
        {commandResult && <Card
          size="small"
          title={<Space>{`${t("command.title")} ${commandResult.id}`}<StatusTag value={commandResult.status} /></Space>}
          style={{ marginTop: 16 }}
        >
          <Collapse
            size="small"
            items={[{
              key: "commandDetails",
              label: t("service.commandDetails"),
              children: <Descriptions size="small" bordered column={1} items={[
                { key: "status", label: t("common.status"), children: <StatusTag value={commandResult.status} /> },
                { key: "createdAt", label: t("command.createdAt"), children: commandResult.createdAt },
                { key: "completedAt", label: t("command.completedAt"), children: commandResult.completedAt ?? "-" }
              ]} />
            }]}
          />
          {generatedKeyFromCommand(commandResult) && <Alert
            type="warning"
            showIcon
            style={{ marginTop: 12, marginBottom: 12 }}
            message={t("service.generatedKeyTitle")}
            description={<Space direction="vertical" style={{ width: "100%" }}>
              <Typography.Text>{t("service.generatedKeyHelp")}</Typography.Text>
              <Typography.Text code copyable={{ text: generatedKeyFromCommand(commandResult)! }}>{generatedKeyFromCommand(commandResult)}</Typography.Text>
            </Space>}
          />}
          <ActionResultDetail command={commandResult} service={service} onOpenAction={openContextAction} />
          <ActionResultList command={commandResult} service={service} onOpenAction={openContextAction} />
          <Collapse
            size="small"
            style={{ marginTop: 16 }}
            items={[{
              key: "resultJson",
              label: t("service.resultJson"),
              children: <JsonBlock value={commandResult.result ?? { errorCode: commandResult.errorCode, errorMessage: commandResult.errorMessage }} />
            }]}
          />
        </Card>}
        {!commandResult && preparedDetail && <ActionDetailCard detail={preparedDetail} service={service} onOpenAction={openContextAction} />}
      </Spin>
    </Modal>
  </Drawer>;
}

async function waitForCommandResult(commandId: string): Promise<Command> {
  const terminal = new Set(["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"]);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const command = await apiFetch<Command>(`/api/admin/commands/${commandId}`);
    if (terminal.has(command.status)) return command;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return await apiFetch<Command>(`/api/admin/commands/${commandId}`);
}

function isTerminalCommandStatus(status: string): boolean {
  return ["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"].includes(status);
}

function generatedKeyFromCommand(command: Command | null): string | undefined {
  const resultData = command?.result?.data;
  if (resultData && typeof resultData === "object" && !Array.isArray(resultData)) {
    const generatedKey = (resultData as Record<string, unknown>).generatedKey;
    if (typeof generatedKey === "string" && generatedKey.length > 0 && generatedKey !== "[REDACTED]") return generatedKey;
  }
  return undefined;
}

function isLongRunningAction(action: Action): boolean {
  return Boolean((action.timeoutSeconds && action.timeoutSeconds > 60) || action.category === "session" || action.name.toLowerCase().includes("rebuild"));
}

function accountStatusesFromHealth(health: Record<string, unknown> | null | undefined): AccountStatus[] {
  const details = health?.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return [];
  const accounts = (details as { accounts?: unknown }).accounts;
  return Array.isArray(accounts) ? accounts.filter((item): item is AccountStatus => Boolean(item) && typeof item === "object") : [];
}

export function App() {
  const { t } = useI18n();
  const [session, setSession] = React.useState<SessionData | null>(null);
  const [booting, setBooting] = React.useState(true);
  React.useEffect(() => { me().then(setSession).catch((err) => { if (!(err instanceof ApiError && err.status === 401)) console.warn(err); }).finally(() => setBooting(false)); }, []);
  if (booting) return <Layout style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}><Typography.Text>{t("app.loading")}</Typography.Text></Layout>;
  return <AntApp>{session ? <Shell session={session} onLogout={() => setSession(null)} /> : <Routes><Route path="/login" element={<LoginPage onLogin={setSession} />} /><Route path="*" element={<Navigate to="/login" replace />} /></Routes>}</AntApp>;
}
