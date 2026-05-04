import { App as AntApp, Badge, Button, Card, Descriptions, Drawer, Form, Input, InputNumber, Layout, Menu, Modal, Popconfirm, Select, Space, Statistic, Switch, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useQuery } from "@tanstack/react-query";
import React from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ApiError, apiDownload, apiFetch, apiList, login, logout, me, type SessionData } from "./api.js";
import { JsonBlock, StatusTag } from "./components.js";
import { useI18n, type Language } from "./i18n.js";

interface Agent { id: string; code: string; name?: string | null; mode: string; runtime?: string | null; status: string; lastHeartbeatAt?: string | null; createdAt: string; updatedAt: string; services?: Service[] }
interface Service { id: string; agentId: string; code: string; name: string; description?: string | null; version?: string | null; runtime?: string | null; status: string; healthStatus: string; lastReportedAt?: string | null; lastHealthAt?: string | null; createdAt: string; updatedAt: string; actions?: Action[]; configs?: ConfigItem[]; health?: Record<string, unknown> | null; manifest?: Record<string, unknown> }
interface Action { id: string; serviceId: string; name: string; label: string; description?: string | null; dangerLevel: string; requiresConfirmation: boolean; inputSchema?: Record<string, unknown>; timeoutSeconds?: number | null; enabled: boolean }
interface ActionPrepare { action: Action; initialPayload: Record<string, unknown>; currentState?: Record<string, unknown> }
interface ConfigItem { id: string; configKey: string; label?: string | null; type: string; source?: string | null; editable: number; sensitive: number; valuePreview?: string | null; defaultValue?: string | null; secretRef?: string | null }
interface Command { id: string; agentId: string; serviceId: string; type: string; actionName: string; status: string; payload: Record<string, unknown>; errorCode?: string | null; errorMessage?: string | null; createdAt: string; updatedAt: string; startedAt?: string | null; completedAt?: string | null; result?: Record<string, unknown> | null }
interface User { id: string; username: string; displayName?: string | null; role: string; status: string; lastLoginAt?: string | null; createdAt: string; updatedAt: string }
interface AuditEvent { id: string; actorType: string; actorId?: string | null; action: string; targetType?: string | null; targetId?: string | null; result: string; message?: string | null; metadata: Record<string, unknown>; createdAt: string }
interface RegistrationToken { id: string; name: string; status: string; agentId?: string | null; expiresAt?: string | null; usedAt?: string | null; revokedAt?: string | null; createdAt: string; token?: string; rawToken?: string }
interface MaintenanceSettings { agentOfflineThresholdSeconds: number; auditRetentionDays: number; maintenanceIntervalSeconds: number }
interface Metrics { totals: Record<string, number>; byStatus: Record<string, Record<string, number>> }
interface MaintenanceResult { expiredRegistrationTokens: number; expiredCommands: number; offlineAgents: number; offlineServices: number; deletedAuditEvents: number; ranAt: string }
interface DashboardSummary { workspace: { id: string; code: string; name: string }; agentCounts: Record<string, number>; serviceCounts: Record<string, number>; commandCounts: Record<string, number>; auditEventCount: number; recentCommands: Command[]; recentAuditEvents: AuditEvent[] }
interface PageState { page: number; pageSize: number }

const defaultPage: PageState = { page: 1, pageSize: 20 };

function queryString(params: Record<string, string | number | undefined | null>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}


function useQueryData<T>(loader: () => Promise<T>, deps: React.DependencyList = [], refreshMs?: number) {
  const queryId = React.useId();
  const query = useQuery({
    queryKey: [queryId, ...deps],
    queryFn: loader,
    refetchInterval: refreshMs,
    staleTime: refreshMs ? Math.min(refreshMs, 30_000) : 30_000
  });
  return {
    data: query.data ?? null,
    loading: query.isLoading || query.isFetching,
    error: query.error instanceof Error ? query.error.message : query.error ? String(query.error) : null,
    reload: async () => { await query.refetch(); }
  };
}


async function downloadBlob(path: string, filename: string, options?: RequestInit) {
  const blob = await apiDownload(path, options);
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.URL.revokeObjectURL(url);
}

function LanguageSwitcher() {
  const { language, setLanguage, t } = useI18n();
  return <Select<Language>
    aria-label={t("language.label")}
    value={language}
    onChange={setLanguage}
    style={{ width: 132 }}
    options={[
      { value: "zh-CN", label: t("language.zhCN") },
      { value: "en-US", label: t("language.enUS") }
    ]}
  />;
}

function LoginPage({ onLogin }: { onLogin: (session: SessionData) => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = React.useState(false);
  return <Layout style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
    <Card title={t("login.title")} style={{ width: 420 }} extra={<LanguageSwitcher />}>
      <Form layout="vertical" initialValues={{ username: "admin" }} onFinish={async (values) => {
        setSubmitting(true);
        try { const session = await login(values.username, values.password); onLogin(session); message.success(t("login.success")); navigate("/"); }
        catch (err) { message.error(err instanceof Error ? err.message : t("login.failed")); }
        finally { setSubmitting(false); }
      }}>
        <Form.Item name="username" label={t("login.username")} rules={[{ required: true }]}><Input autoFocus /></Form.Item>
        <Form.Item name="password" label={t("login.password")} rules={[{ required: true }]}><Input.Password /></Form.Item>
        <Button type="primary" htmlType="submit" loading={submitting} block>{t("action.login")}</Button>
      </Form>
    </Card>
  </Layout>;
}

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
        <Route path="/" element={<Dashboard />} />
        <Route path="/users" element={<Users />} />
        <Route path="/registration-tokens" element={<RegistrationTokens />} />
        <Route path="/agents" element={<Agents />} />
        <Route path="/services" element={<Services />} />
        <Route path="/commands" element={<Commands />} />
        <Route path="/audit-events" element={<AuditEvents />} />
        <Route path="/settings" element={<Settings />} />
      </Routes></Layout.Content>
    </Layout>
  </Layout>;
}

function Dashboard() {
  const { t } = useI18n();
  const { data, loading, reload } = useQueryData<DashboardSummary>(() => apiFetch("/api/admin/dashboard/summary"), [], 5000);
  return <Space direction="vertical" size="large" style={{ width: "100%" }}>
    <Space style={{ justifyContent: "space-between", width: "100%" }}><Typography.Title>{t("dashboard.title")}</Typography.Title><Button onClick={reload}>{t("action.refresh")}</Button></Space>
    <Space wrap>
      <Card><Statistic title={t("dashboard.workspace")} value={data?.workspace.name ?? "-"} /></Card>
      <Card><Statistic title={t("dashboard.onlineAgents")} value={data?.agentCounts.ONLINE ?? 0} loading={loading} /></Card>
      <Card><Statistic title={t("dashboard.healthyServices")} value={data?.serviceCounts.HEALTHY ?? 0} loading={loading} /></Card>
      <Card><Statistic title={t("dashboard.runningCommands")} value={data?.commandCounts.RUNNING ?? 0} loading={loading} /></Card>
      <Card><Statistic title={t("dashboard.auditEvents")} value={data?.auditEventCount ?? 0} loading={loading} /></Card>
    </Space>
    <Card title={t("dashboard.recentCommands")}><Table rowKey="id" loading={loading} dataSource={data?.recentCommands ?? []} pagination={false} columns={[
      { title: t("common.time"), dataIndex: "createdAt" }, { title: "Action", dataIndex: "actionName" }, { title: t("common.status"), dataIndex: "status", render: (v) => <StatusTag value={String(v)} /> }
    ]} /></Card>
    <Card title={t("dashboard.recentAuditEvents")}><Table rowKey="id" loading={loading} dataSource={data?.recentAuditEvents ?? []} pagination={false} columns={[
      { title: t("common.time"), dataIndex: "createdAt" }, { title: t("common.actor"), dataIndex: "actorType" }, { title: "Action", dataIndex: "action" }, { title: t("common.result"), dataIndex: "result", render: (v) => <StatusTag value={String(v)} /> }
    ]} /></Card>
  </Space>;
}


function Users() {
  const { t } = useI18n();
  const [page, setPage] = React.useState<PageState>(defaultPage);
  const { data, loading, error, reload } = useQueryData(() => apiList<User>(`/api/admin/users${queryString({ ...page })}`), [page.page, page.pageSize]);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<User | null>(null);
  const [resetTarget, setResetTarget] = React.useState<User | null>(null);
  if (error) return <Card title={t("user.title")}><Typography.Text type="danger">{error}</Typography.Text></Card>;
  return <Card title={t("user.title")} extra={<Space><Button onClick={reload}>{t("action.refresh")}</Button><Button type="primary" onClick={() => setCreateOpen(true)}>{t("user.createTitle")}</Button></Space>}>
    <Modal open={createOpen} title={t("user.createTitle")} footer={null} onCancel={() => setCreateOpen(false)} destroyOnClose>
      <Form layout="vertical" initialValues={{ role: "viewer" }} onFinish={async (values) => { await apiFetch<User>("/api/admin/users", { method: "POST", body: JSON.stringify(values) }); message.success(t("user.created")); setCreateOpen(false); void reload(); }}>
        <Form.Item name="username" label={t("login.username")} rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="displayName" label={t("common.displayName")}><Input /></Form.Item>
        <Form.Item name="role" label={t("common.role")} rules={[{ required: true }]}><Select options={["owner", "operator", "viewer"].map(value => ({ value, label: value }))} /></Form.Item>
        <Form.Item name="password" label={t("user.initialPassword")} rules={[{ required: true, min: 12 }]}><Input.Password /></Form.Item>
        <Button type="primary" htmlType="submit">{t("action.create")}</Button>
      </Form>
    </Modal>
    <Modal open={!!editTarget} title={t("user.updateTitle")} footer={null} onCancel={() => setEditTarget(null)} destroyOnClose>
      {editTarget && <Form layout="vertical" initialValues={{ displayName: editTarget.displayName, role: editTarget.role, status: editTarget.status }} onFinish={async (values) => { await apiFetch(`/api/admin/users/${editTarget.id}`, { method: "PATCH", body: JSON.stringify(values) }); message.success(t("user.updated")); setEditTarget(null); void reload(); }}>
        <Form.Item name="displayName" label={t("common.displayName")}><Input /></Form.Item>
        <Form.Item name="role" label={t("common.role")} rules={[{ required: true }]}><Select options={["owner", "operator", "viewer"].map(value => ({ value, label: value }))} /></Form.Item>
        <Form.Item name="status" label={t("common.status")} rules={[{ required: true }]}><Select options={["ACTIVE", "DISABLED"].map(value => ({ value, label: value }))} /></Form.Item>
        <Button type="primary" htmlType="submit">{t("action.edit")}</Button>
      </Form>}
    </Modal>
    <Modal open={!!resetTarget} title={t("user.resetPasswordTitle")} footer={null} onCancel={() => setResetTarget(null)} destroyOnClose>
      <Form layout="vertical" onFinish={async (values) => { if (!resetTarget) return; await apiFetch(`/api/admin/users/${resetTarget.id}/reset-password`, { method: "POST", body: JSON.stringify({ password: values.password }) }); message.success(t("user.passwordReset")); setResetTarget(null); void reload(); }}>
        <Form.Item name="password" label={t("user.newPassword")} rules={[{ required: true, min: 12 }]}><Input.Password /></Form.Item>
        <Button type="primary" htmlType="submit">{t("user.resetPassword")}</Button>
      </Form>
    </Modal>
    <Table rowKey="id" loading={loading} dataSource={data?.data ?? []} pagination={{ current: data?.pagination?.page ?? page.page, pageSize: data?.pagination?.pageSize ?? page.pageSize, total: data?.pagination?.total, showSizeChanger: true, onChange: (nextPage, nextPageSize) => setPage({ page: nextPage, pageSize: nextPageSize }) }} columns={[
      { title: t("common.username"), dataIndex: "username" }, { title: t("common.displayName"), dataIndex: "displayName" }, { title: t("common.role"), dataIndex: "role", render: (v) => <Tag>{v}</Tag> }, { title: t("common.status"), dataIndex: "status", render: (v) => <StatusTag value={v} /> }, { title: t("user.lastLogin"), dataIndex: "lastLoginAt" },
      { title: t("common.operation"), render: (_, row) => <Space><Button size="small" onClick={() => setEditTarget(row)}>{t("action.edit")}</Button><Button size="small" onClick={() => setResetTarget(row)}>{t("user.resetPassword")}</Button>{row.status === "ACTIVE" ? <Popconfirm title={t("confirm.disableUser")} onConfirm={async () => { await apiFetch(`/api/admin/users/${row.id}`, { method: "PATCH", body: JSON.stringify({ status: "DISABLED" }) }); message.success(t("user.disabled")); void reload(); }}><Button danger size="small" disabled={row.role === "owner"}>{t("action.disable")}</Button></Popconfirm> : <Button size="small" onClick={async () => { await apiFetch(`/api/admin/users/${row.id}`, { method: "PATCH", body: JSON.stringify({ status: "ACTIVE" }) }); message.success(t("user.enabled")); void reload(); }}>{t("action.enable")}</Button>}</Space> }
    ] as ColumnsType<User>} />
  </Card>;
}

function RegistrationTokens() {
  const { t } = useI18n();
  const [page, setPage] = React.useState<PageState>(defaultPage);
  const { data, loading, reload } = useQueryData(() => apiList<RegistrationToken>(`/api/admin/registration-tokens${queryString({ ...page })}`), [page.page, page.pageSize]);
  const [created, setCreated] = React.useState<RegistrationToken | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const createdTokenValue = created?.token ?? created?.rawToken ?? "";
  const copyCreatedToken = async () => {
    if (!createdTokenValue) return;
    await navigator.clipboard.writeText(createdTokenValue);
    message.success(t("registration.copySuccess"));
  };
  return <Card title={t("registration.title")} extra={<Space><Button onClick={reload}>{t("action.refresh")}</Button><Button type="primary" onClick={() => setCreateOpen(true)}>{t("action.create")}</Button></Space>}>
    {created && <Card type="inner" title={t("registration.createdOnce")} style={{ marginBottom: 16 }} extra={createdTokenValue ? <Button onClick={() => void copyCreatedToken()}>{t("registration.copyToken")}</Button> : null}>{createdTokenValue ? <Input.TextArea value={createdTokenValue} autoSize readOnly /> : <Typography.Text type="danger">{t("registration.tokenUnavailable")}</Typography.Text>}</Card>}
    <Modal open={createOpen} title={t("registration.createTitle")} footer={null} onCancel={() => setCreateOpen(false)} destroyOnClose>
      <CreateTokenForm onCreated={(token) => { setCreated(token); setCreateOpen(false); void reload(); }} />
    </Modal>
    <Table rowKey="id" loading={loading} dataSource={data?.data ?? []} pagination={{ current: data?.pagination?.page ?? page.page, pageSize: data?.pagination?.pageSize ?? page.pageSize, total: data?.pagination?.total, showSizeChanger: true, onChange: (nextPage, nextPageSize) => setPage({ page: nextPage, pageSize: nextPageSize }) }} columns={[
      { title: t("common.name"), dataIndex: "name" }, { title: t("common.status"), dataIndex: "status", render: (v) => <StatusTag value={v} /> }, { title: t("registration.token"), render: (_, row) => row.id === created?.id && createdTokenValue ? <Input value={createdTokenValue} readOnly /> : <Typography.Text type="secondary">{t("registration.tokenHidden")}</Typography.Text> }, { title: "Agent", dataIndex: "agentId" }, { title: t("registration.expiresAt"), dataIndex: "expiresAt", render: (v) => v ?? "-" }, { title: t("common.createdAt"), dataIndex: "createdAt" },
      { title: t("common.operation"), render: (_, row) => <Space>{row.id === created?.id && createdTokenValue ? <Button onClick={() => void copyCreatedToken()}>{t("registration.copyToken")}</Button> : null}{row.status === "ACTIVE" ? <Popconfirm title={t("confirm.revokeToken")} onConfirm={async () => { await apiFetch(`/api/admin/registration-tokens/${row.id}/revoke`, { method: "POST" }); message.success(t("registration.revoked")); void reload(); }}><Button danger>{t("action.revoke")}</Button></Popconfirm> : null}{["EXPIRED", "REVOKED"].includes(row.status) ? <Popconfirm title={t("confirm.deleteToken")} onConfirm={async () => { await apiFetch(`/api/admin/registration-tokens/${row.id}`, { method: "DELETE" }); message.success(t("registration.deleted")); if (created?.id === row.id) setCreated(null); void reload(); }}><Button danger>{t("action.delete")}</Button></Popconfirm> : null}</Space> }
    ] as ColumnsType<RegistrationToken>} />
  </Card>;
}

function CreateTokenForm({ onCreated }: { onCreated: (token: RegistrationToken) => void }) {
  const { t } = useI18n();
  const [submitting, setSubmitting] = React.useState(false);
  return <Form id="create-token" layout="vertical" onFinish={async (values) => {
    const body = Object.fromEntries(Object.entries(values as Record<string, unknown>).filter(([, value]) => value !== undefined && value !== null && value !== ""));
    setSubmitting(true);
    try {
      const token = await apiFetch<RegistrationToken>("/api/admin/registration-tokens", { method: "POST", body: JSON.stringify(body) });
      onCreated(token);
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("login.failed"));
    } finally {
      setSubmitting(false);
    }
  }}>
    <Form.Item name="name" label={t("common.name")} rules={[{ required: true }]}><Input placeholder="demo-agent" /></Form.Item>
    <Form.Item name="expiresInSeconds" label={t("registration.expiresInSeconds")}><InputNumber min={60} style={{ width: "100%" }} placeholder={t("form.optional")} /></Form.Item>
    <Button type="primary" htmlType="submit" loading={submitting}>{t("action.create")}</Button>
  </Form>;
}

function Agents() {
  const { t } = useI18n();
  const [filters, setFilters] = React.useState<{ q?: string; status?: string }>({});
  const [page, setPage] = React.useState<PageState>(defaultPage);
  const updateFilters = (next: { q?: string; status?: string }) => { setFilters(next); setPage(defaultPage); };
  const { data, loading, reload } = useQueryData(() => apiList<Agent>(`/api/admin/agents${queryString({ ...filters, ...page })}`), [filters.q, filters.status, page.page, page.pageSize]);
  const [selected, setSelected] = React.useState<Agent | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
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
  return <Card title={t("menu.agents")} extra={<Button loading={refreshing} onClick={() => void refreshAgents()}>{t("action.refresh")}</Button>}>
    <Space style={{ marginBottom: 16 }} wrap>
      <Input.Search placeholder={t("common.searchCodeName")} allowClear onSearch={(q) => updateFilters({ ...filters, q })} style={{ width: 240 }} />
      <Select allowClear placeholder={t("common.status")} style={{ width: 160 }} onChange={(status) => updateFilters({ ...filters, status })} options={["ONLINE", "OFFLINE", "DISABLED", "REVOKED"].map(value => ({ value, label: value }))} />
    </Space>
    <Table rowKey="id" loading={loading} dataSource={data?.data ?? []} pagination={{ current: data?.pagination?.page ?? page.page, pageSize: data?.pagination?.pageSize ?? page.pageSize, total: data?.pagination?.total, showSizeChanger: true, onChange: (nextPage, nextPageSize) => setPage({ page: nextPage, pageSize: nextPageSize }) }} onRow={(row) => ({ onClick: () => void openAgent(row.id) })} columns={[
      { title: t("common.code"), dataIndex: "code" }, { title: t("common.name"), dataIndex: "name" }, { title: t("common.mode"), dataIndex: "mode" }, { title: t("common.runtime"), dataIndex: "runtime" }, { title: t("common.status"), dataIndex: "status", render: (v) => <StatusTag value={v} /> }, { title: "Heartbeat", dataIndex: "lastHeartbeatAt" },
      { title: t("common.operation"), render: (_, row) => row.status === "REVOKED" ? null : <Space>{row.status === "DISABLED" ? <Popconfirm title={t("confirm.enableAgent")} onConfirm={async (event) => { event?.stopPropagation(); await apiFetch(`/api/admin/agents/${row.id}/enable`, { method: "POST" }); message.success(t("user.enabled")); void reload(); }}><Button size="small" onClick={(event) => event.stopPropagation()}>{t("action.enable")}</Button></Popconfirm> : <Popconfirm title={t("confirm.disableAgent")} onConfirm={async (event) => { event?.stopPropagation(); await apiFetch(`/api/admin/agents/${row.id}/disable`, { method: "POST" }); message.success(t("user.disabled")); void reload(); }}><Button size="small" onClick={(event) => event.stopPropagation()}>{t("action.disable")}</Button></Popconfirm>}<Popconfirm title={t("confirm.revokeAgent")} onConfirm={async (event) => { event?.stopPropagation(); await apiFetch(`/api/admin/agents/${row.id}/revoke`, { method: "POST" }); message.success(t("registration.revoked")); void reload(); }}><Button danger size="small" onClick={(event) => event.stopPropagation()}>{t("action.revoke")}</Button></Popconfirm></Space> }
    ] as ColumnsType<Agent>} />
    <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected?.code} width={720} extra={<Button disabled={!selected} loading={refreshing} onClick={() => void refreshAgents()}>{t("action.refresh")}</Button>}>
      <Descriptions bordered column={1} items={selected ? Object.entries(selected).filter(([k]) => k !== "services").map(([key, value]) => ({ key, label: key, children: String(value ?? "-") })) : []} />
      <Typography.Title level={4} style={{ marginTop: 24 }}>{t("menu.services")}</Typography.Title>
      <Table rowKey="id" dataSource={selected?.services ?? []} pagination={false} columns={[{ title: t("common.code"), dataIndex: "code" }, { title: t("common.name"), dataIndex: "name" }, { title: t("common.health"), dataIndex: "healthStatus", render: (v) => <StatusTag value={v} /> }]} />
    </Drawer>
  </Card>;
}

function Services() {
  const { t } = useI18n();
  const [filters, setFilters] = React.useState<{ q?: string; status?: string; healthStatus?: string }>({});
  const [page, setPage] = React.useState<PageState>(defaultPage);
  const updateFilters = (next: { q?: string; status?: string; healthStatus?: string }) => { setFilters(next); setPage(defaultPage); };
  const { data, loading, reload } = useQueryData(() => apiList<Service>(`/api/admin/capsule-services${queryString({ ...filters, ...page })}`), [filters.q, filters.status, filters.healthStatus, page.page, page.pageSize]);
  const [selected, setSelected] = React.useState<Service | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
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
      <Select allowClear placeholder={t("service.serviceStatus")} style={{ width: 160 }} onChange={(status) => updateFilters({ ...filters, status })} options={["HEALTHY", "UNHEALTHY", "UNKNOWN"].map(value => ({ value, label: value }))} />
      <Select allowClear placeholder={t("service.healthStatus")} style={{ width: 160 }} onChange={(healthStatus) => updateFilters({ ...filters, healthStatus })} options={["UP", "DEGRADED", "DOWN", "UNKNOWN"].map(value => ({ value, label: value }))} />
    </Space>
    <Table rowKey="id" loading={loading} dataSource={data?.data ?? []} pagination={{ current: data?.pagination?.page ?? page.page, pageSize: data?.pagination?.pageSize ?? page.pageSize, total: data?.pagination?.total, showSizeChanger: true, onChange: (nextPage, nextPageSize) => setPage({ page: nextPage, pageSize: nextPageSize }) }} onRow={(row) => ({ onClick: () => void openService(row.id) })} columns={[
      { title: t("common.code"), dataIndex: "code" }, { title: t("common.name"), dataIndex: "name" }, { title: t("common.version"), dataIndex: "version" }, { title: t("common.status"), dataIndex: "status", render: (v) => <StatusTag value={v} /> }, { title: t("common.health"), dataIndex: "healthStatus", render: (v) => <StatusTag value={v} /> }, { title: t("service.lastReportedAt"), dataIndex: "lastReportedAt" }
    ]} />
    <ServiceDrawer service={selected} refreshing={refreshing} onClose={() => setSelected(null)} onRefresh={() => void refreshServices()} onCommandCreated={() => { message.success(t("command.createdWaitAgent")); void refreshServices(); }} />
  </Card>;
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
  default?: unknown;
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
  return <Form form={form} layout="vertical" onValuesChange={(_, values) => setPayload(JSON.stringify(values, null, 2))}>
    {Object.entries(properties).map(([name, property]) => {
      const typeLabel = Array.isArray(property.type) ? property.type.join(" | ") : property.type ?? "string";
      const label = property.title && property.title !== name ? `${property.title} (${name})` : name;
      const extra = t("service.payloadFieldMeta", { name, type: typeLabel, required: required.includes(name) ? t("form.required") : t("form.optional") });
      const rules = required.includes(name) ? [{ required: true, message: `${label} ${t("form.required")}` }] : undefined;
      if (property.enum) {
        return <Form.Item key={name} name={name} label={label} tooltip={property.description} rules={rules} extra={extra}>
          <Select options={property.enum.map(value => ({ value: String(value), label: String(value) }))} />
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
        {name.toLowerCase().includes("password") ? <Input.Password placeholder={String(property.default ?? "")} /> : <Input placeholder={String(property.default ?? "")} />}
      </Form.Item>;
    })}
  </Form>;
}

function ServiceDrawer({ service, refreshing, onClose, onRefresh, onCommandCreated }: { service: Service | null; refreshing?: boolean; onClose: () => void; onRefresh: () => void; onCommandCreated: () => void }) {
  const { t } = useI18n();
  const [action, setAction] = React.useState<Action | null>(null);
  const [payload, setPayload] = React.useState("{}");
  const [initialPayload, setInitialPayload] = React.useState<Record<string, unknown> | undefined>(undefined);
  const [commandResult, setCommandResult] = React.useState<Command | null>(null);
  const [commandRunning, setCommandRunning] = React.useState(false);
  const [prepareLoading, setPrepareLoading] = React.useState(false);
  const submitAction = async () => {
    if (!service || !action) return;
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(payload) as Record<string, unknown>; } catch { message.error(t("service.invalidPayload")); return; }
    setCommandRunning(true);
    setCommandResult(null);
    try {
      const created = await apiFetch<Command>(`/api/admin/capsule-services/${service.id}/actions/${action.name}`, { method: "POST", body: JSON.stringify({ payload: parsed, confirmation: action.requiresConfirmation }) });
      setCommandResult(created);
      onCommandCreated();
      const finished = await waitForCommandResult(created.id);
      setCommandResult(finished);
      if (finished.status === "SUCCEEDED") message.success(t("command.completed"));
      else message.error(finished.errorMessage ?? t("command.failed"));
    } finally {
      setCommandRunning(false);
    }
  };
  const openAction = async (next: Action) => {
    setAction(next);
    setPayload(JSON.stringify(defaultPayloadForAction(next), null, 2));
    setCommandResult(null);
    setCommandRunning(false);
    setInitialPayload(undefined);
    if (!service) return;
    setPrepareLoading(true);
    try {
      const prepared = await apiFetch<ActionPrepare>(`/api/admin/capsule-services/${service.id}/actions/${next.name}`);
      setAction(prepared.action);
      setInitialPayload(prepared.initialPayload ?? defaultPayloadForAction(prepared.action));
      setPayload(JSON.stringify(prepared.initialPayload ?? defaultPayloadForAction(prepared.action), null, 2));
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
      setAction(null);
      setInitialPayload(undefined);
      setPayload("{}");
    } finally {
      setPrepareLoading(false);
    }
  };
  return <Drawer open={!!service} onClose={onClose} title={service?.name} width={860} extra={<Button disabled={!service} loading={refreshing} onClick={onRefresh}>{t("action.refresh")}</Button>}>
    {service && <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Descriptions bordered column={2} items={["code", "version", "runtime", "status", "healthStatus", "lastReportedAt", "lastHealthAt"].map((key) => ({ key, label: key, children: key.toLowerCase().includes("status") ? <StatusTag value={String((service as unknown as Record<string, unknown>)[key] ?? "")} /> : String((service as unknown as Record<string, unknown>)[key] ?? "-") }))} />
      <Card type="inner" title={t("common.action")}><Space wrap>{(service.actions ?? []).map(a => <Button key={a.id} loading={prepareLoading && action?.id === a.id} danger={a.dangerLevel !== "LOW" || a.requiresConfirmation} onClick={() => void openAction(a)}>{a.label}</Button>)}</Space></Card>
      <Card type="inner" title={t("common.configs")}><Table rowKey="id" pagination={false} dataSource={service.configs ?? []} columns={[{ title: t("common.key"), dataIndex: "configKey" }, { title: t("common.type"), dataIndex: "type" }, { title: t("common.sensitive"), dataIndex: "sensitive", render: (v) => v ? <Tag color="red">{t("common.yes")}</Tag> : <Tag>{t("common.no")}</Tag> }, { title: t("common.preview"), dataIndex: "valuePreview" }, { title: t("common.secretRef"), dataIndex: "secretRef" }]} /></Card>
      <Card type="inner" title={t("common.health")}><JsonBlock value={service.health ?? {}} /></Card>
      <Card type="inner" title={t("common.manifest")}><JsonBlock value={service.manifest ?? {}} /></Card>
    </Space>}
    <Modal open={!!action} title={t("service.executeAction", { label: action?.label ?? "" })} onCancel={() => setAction(null)} onOk={() => void submitAction()} okText={action?.requiresConfirmation ? t("action.confirmRun") : t("action.run")} confirmLoading={commandRunning} okButtonProps={{ danger: action?.requiresConfirmation }}>
      <Typography.Paragraph>{action?.description}</Typography.Paragraph>
      {action?.requiresConfirmation && <Typography.Paragraph type="danger">{t("service.actionRequiresConfirmation")}</Typography.Paragraph>}
      <Typography.Text type="secondary">{t("service.autoPayloadHelp")}</Typography.Text>
      {action && <SchemaPayloadFields action={action} initialPayload={initialPayload} setPayload={setPayload} />}
      <Input.TextArea value={payload} onChange={(e) => setPayload(e.target.value)} rows={8} />
      {commandResult && <Card size="small" title={`${t("command.title")} ${commandResult.id}`} style={{ marginTop: 16 }}>
        <Descriptions size="small" bordered column={1} items={[
          { key: "status", label: t("common.status"), children: <StatusTag value={commandResult.status} /> },
          { key: "createdAt", label: t("command.createdAt"), children: commandResult.createdAt },
          { key: "completedAt", label: t("command.completedAt"), children: commandResult.completedAt ?? "-" }
        ]} />
        <Typography.Title level={5} style={{ marginTop: 16 }}>{t("common.result")}</Typography.Title>
        <JsonBlock value={commandResult.result ?? { errorCode: commandResult.errorCode, errorMessage: commandResult.errorMessage }} />
      </Card>}
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

function Commands() {
  const { t } = useI18n();
  const [filters, setFilters] = React.useState<{ status?: string; actionName?: string }>({});
  const [page, setPage] = React.useState<PageState>(defaultPage);
  const updateFilters = (next: { status?: string; actionName?: string }) => { setFilters(next); setPage(defaultPage); };
  const { data, loading, reload } = useQueryData(() => apiList<Command>(`/api/admin/commands${queryString({ ...filters, ...page })}`), [filters.status, filters.actionName, page.page, page.pageSize], 5000);
  const [selected, setSelected] = React.useState<Command | null>(null);
  const openCommand = async (id: string) => setSelected(await apiFetch<Command>(`/api/admin/commands/${id}`));
  return <Card title={t("command.title")} extra={<Button onClick={reload}>{t("action.refresh")}</Button>}>
    <Space style={{ marginBottom: 16 }} wrap>
      <Input.Search placeholder={t("command.actionName")} allowClear onSearch={(actionName) => updateFilters({ ...filters, actionName })} style={{ width: 220 }} />
      <Select allowClear placeholder={t("common.status")} style={{ width: 180 }} onChange={(status) => updateFilters({ ...filters, status })} options={["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"].map(value => ({ value, label: value }))} />
    </Space>
    <Table rowKey="id" loading={loading} dataSource={data?.data ?? []} pagination={{ current: data?.pagination?.page ?? page.page, pageSize: data?.pagination?.pageSize ?? page.pageSize, total: data?.pagination?.total, showSizeChanger: true, onChange: (nextPage, nextPageSize) => setPage({ page: nextPage, pageSize: nextPageSize }) }} onRow={(row) => ({ onClick: () => void openCommand(row.id) })} columns={[
      { title: t("common.id"), dataIndex: "id" }, { title: "Action", dataIndex: "actionName" }, { title: t("common.status"), dataIndex: "status", render: (v) => <StatusTag value={v} /> }, { title: t("common.createdAt"), dataIndex: "createdAt" }, { title: t("command.completedAt"), dataIndex: "completedAt" },
      { title: t("common.operation"), render: (_, row) => <Space>{["PENDING", "RUNNING"].includes(row.status) ? <Popconfirm title={t("confirm.cancelCommand")} onConfirm={async (event) => { event?.stopPropagation(); await apiFetch(`/api/admin/commands/${row.id}/cancel`, { method: "POST" }); message.success(t("command.cancelled")); void reload(); }}><Button danger size="small" onClick={(event) => event.stopPropagation()}>{t("action.cancel")}</Button></Popconfirm> : null}{["FAILED", "EXPIRED", "CANCELLED"].includes(row.status) ? <Popconfirm title={t("confirm.retryCommand")} onConfirm={async (event) => { event?.stopPropagation(); await apiFetch(`/api/admin/commands/${row.id}/retry`, { method: "POST" }); message.success(t("command.retried")); void reload(); }}><Button size="small" onClick={(event) => event.stopPropagation()}>{t("command.retry")}</Button></Popconfirm> : null}</Space> }
    ] as ColumnsType<Command>} />
    <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected?.id} width={720} extra={<Button disabled={!selected} onClick={() => selected && void openCommand(selected.id)}>{t("action.refresh")}</Button>}>
      <Descriptions bordered column={1} items={selected ? [
        { key: "status", label: t("common.status"), children: <StatusTag value={selected.status} /> },
        { key: "action", label: "Action", children: selected.actionName },
        { key: "createdAt", label: t("command.createdAt"), children: selected.createdAt },
        { key: "completedAt", label: t("command.completedAt"), children: selected.completedAt ?? "-" }
      ] : []} />
      <Typography.Title level={5} style={{ marginTop: 24 }}>Payload</Typography.Title><JsonBlock value={selected?.payload} />
      <Typography.Title level={5}>Result / Error</Typography.Title><JsonBlock value={selected?.result ?? { errorCode: selected?.errorCode, errorMessage: selected?.errorMessage }} />
    </Drawer>
  </Card>;
}

function AuditEvents() {
  const { t } = useI18n();
  const [filters, setFilters] = React.useState<{ actorType?: string; result?: string; action?: string; targetType?: string }>({});
  const [page, setPage] = React.useState<PageState>(defaultPage);
  const updateFilters = (next: { actorType?: string; result?: string; action?: string; targetType?: string }) => { setFilters(next); setPage(defaultPage); };
  const { data, loading, reload } = useQueryData(() => apiList<AuditEvent>(`/api/admin/audit-events${queryString({ ...filters, ...page })}`), [filters.actorType, filters.result, filters.action, filters.targetType, page.page, page.pageSize], 5000);
  return <Card title={t("audit.title")} extra={<Space><Button onClick={() => void downloadBlob(`/api/admin/audit-events/export?format=csv${filters.action ? `&action=${filters.action}` : ""}`, "audit-events.csv")}>{t("action.exportCsv")}</Button><Button onClick={reload}>{t("action.refresh")}</Button></Space>}>
    <Space style={{ marginBottom: 16 }} wrap>
      <Input.Search placeholder="Action" allowClear onSearch={(action) => updateFilters({ ...filters, action })} style={{ width: 220 }} />
      <Select allowClear placeholder="Actor" style={{ width: 140 }} onChange={(actorType) => updateFilters({ ...filters, actorType })} options={["USER", "AGENT", "SYSTEM"].map(value => ({ value, label: value }))} />
      <Select allowClear placeholder="Result" style={{ width: 140 }} onChange={(result) => updateFilters({ ...filters, result })} options={["SUCCESS", "FAILURE"].map(value => ({ value, label: value }))} />
      <Input placeholder={t("audit.targetType")} allowClear onChange={(event) => updateFilters({ ...filters, targetType: event.target.value })} style={{ width: 180 }} />
    </Space>
    <Table rowKey="id" loading={loading} dataSource={data?.data ?? []} pagination={{ current: data?.pagination?.page ?? page.page, pageSize: data?.pagination?.pageSize ?? page.pageSize, total: data?.pagination?.total, showSizeChanger: true, onChange: (nextPage, nextPageSize) => setPage({ page: nextPage, pageSize: nextPageSize }) }} columns={[{ title: t("common.time"), dataIndex: "createdAt" }, { title: t("common.actor"), dataIndex: "actorType" }, { title: "Action", dataIndex: "action" }, { title: t("audit.targetType"), dataIndex: "targetType" }, { title: t("common.result"), dataIndex: "result", render: (v) => <StatusTag value={String(v)} /> }, { title: t("common.message"), dataIndex: "message" }]} />
  </Card>;
}

function Settings() {
  const { t } = useI18n();
  const [form] = Form.useForm<MaintenanceSettings>();
  const { data, loading, reload } = useQueryData<MaintenanceSettings>(() => apiFetch("/api/admin/settings/maintenance"));
  const metrics = useQueryData<Metrics>(() => apiFetch("/api/admin/metrics"), [], 5000);
  const diagnostics = useQueryData<Record<string, unknown>>(() => apiFetch("/api/admin/diagnostics/runtime"));
  const [result, setResult] = React.useState<MaintenanceResult | null>(null);
  const [running, setRunning] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => { if (data) form.setFieldsValue(data); }, [data, form]);
  return <Space direction="vertical" size="large" style={{ width: "100%" }}>
    <Card title={t("settings.maintenanceSettings")} loading={loading} extra={<Button onClick={reload}>{t("action.refresh")}</Button>}>
      <Form form={form} layout="vertical" onFinish={async (values) => {
        setSaving(true);
        try { await apiFetch<MaintenanceSettings>("/api/admin/settings/maintenance", { method: "PATCH", body: JSON.stringify(values) }); message.success(t("settings.saveSuccess")); void reload(); }
        catch (err) { message.error(err instanceof Error ? err.message : t("settings.maintenanceFailed")); }
        finally { setSaving(false); }
      }}>
        <Form.Item name="agentOfflineThresholdSeconds" label={t("settings.agentOfflineThresholdSeconds")} rules={[{ required: true }]}><InputNumber min={1} style={{ width: "100%" }} /></Form.Item>
        <Form.Item name="auditRetentionDays" label={t("settings.auditRetentionDays")} rules={[{ required: true }]}><InputNumber min={0} style={{ width: "100%" }} /></Form.Item>
        <Form.Item name="maintenanceIntervalSeconds" label={t("settings.maintenanceIntervalSeconds")} rules={[{ required: true }]}><InputNumber min={0} style={{ width: "100%" }} /></Form.Item>
        <Space>
          <Button type="primary" htmlType="submit" loading={saving}>{t("action.edit")}</Button>
          <Button loading={running} onClick={async () => {
            setRunning(true);
            try { const output = await apiFetch<MaintenanceResult>("/api/admin/maintenance/run", { method: "POST" }); setResult(output); message.success(t("settings.maintenanceSuccess")); }
            catch (err) { message.error(err instanceof Error ? err.message : t("settings.maintenanceFailed")); }
            finally { setRunning(false); }
          }}>{t("action.runMaintenanceNow")}</Button>
          <Button onClick={() => void downloadBlob("/api/admin/backup/sqlite", "opstage-backup.db", { method: "POST" })}>{t("action.downloadSqliteBackup")}</Button>
        </Space>
      </Form>
    </Card>
    {result && <Card title={t("settings.lastMaintenanceResult")}><JsonBlock value={result} /></Card>}
    <Card title={t("settings.metrics")} loading={metrics.loading}><JsonBlock value={metrics.data} /></Card>
    <Card title={t("settings.diagnostics")} loading={diagnostics.loading}><JsonBlock value={diagnostics.data} /></Card>
  </Space>;
}

export function App() {
  const { t } = useI18n();
  const [session, setSession] = React.useState<SessionData | null>(null);
  const [booting, setBooting] = React.useState(true);
  React.useEffect(() => { me().then(setSession).catch((err) => { if (!(err instanceof ApiError && err.status === 401)) console.warn(err); }).finally(() => setBooting(false)); }, []);
  if (booting) return <Layout style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}><Typography.Text>{t("app.loading")}</Typography.Text></Layout>;
  return <AntApp>{session ? <Shell session={session} onLogout={() => setSession(null)} /> : <Routes><Route path="/login" element={<LoginPage onLogin={setSession} />} /><Route path="*" element={<Navigate to="/login" replace />} /></Routes>}</AntApp>;
}
