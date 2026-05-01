import { App as AntApp, Badge, Button, Card, Descriptions, Drawer, Form, Input, InputNumber, Layout, Menu, Modal, Select, Space, Statistic, Switch, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import React from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ApiError, apiDownload, apiFetch, apiList, login, logout, me, type SessionData } from "./api.js";
import { JsonBlock, StatusTag } from "./components.js";

interface Agent { id: string; code: string; name?: string | null; mode: string; runtime?: string | null; status: string; lastHeartbeatAt?: string | null; createdAt: string; updatedAt: string; services?: Service[] }
interface Service { id: string; agentId: string; code: string; name: string; description?: string | null; version?: string | null; runtime?: string | null; status: string; healthStatus: string; lastReportedAt?: string | null; lastHealthAt?: string | null; createdAt: string; updatedAt: string; actions?: Action[]; configs?: ConfigItem[]; health?: Record<string, unknown> | null; manifest?: Record<string, unknown> }
interface Action { id: string; serviceId: string; name: string; label: string; description?: string | null; dangerLevel: string; requiresConfirmation: boolean; inputSchema?: Record<string, unknown>; timeoutSeconds?: number | null; enabled: boolean }
interface ConfigItem { id: string; configKey: string; label?: string | null; type: string; source?: string | null; editable: number; sensitive: number; valuePreview?: string | null; defaultValue?: string | null; secretRef?: string | null }
interface Command { id: string; agentId: string; serviceId: string; type: string; actionName: string; status: string; payload: Record<string, unknown>; errorCode?: string | null; errorMessage?: string | null; createdAt: string; updatedAt: string; startedAt?: string | null; completedAt?: string | null; result?: Record<string, unknown> | null }
interface User { id: string; username: string; displayName?: string | null; role: string; status: string; lastLoginAt?: string | null; createdAt: string; updatedAt: string }
interface AuditEvent { id: string; actorType: string; actorId?: string | null; action: string; targetType?: string | null; targetId?: string | null; result: string; message?: string | null; metadata: Record<string, unknown>; createdAt: string }
interface RegistrationToken { id: string; name: string; status: string; agentId?: string | null; expiresAt?: string | null; usedAt?: string | null; revokedAt?: string | null; createdAt: string; token?: string }
interface MaintenanceSettings { agentStaleSeconds: number; auditRetentionDays: number; maintenanceIntervalSeconds: number }
interface Metrics { totals: Record<string, number>; byStatus: Record<string, Record<string, number>> }
interface MaintenanceResult { expiredRegistrationTokens: number; expiredCommands: number; offlineAgents: number; offlineServices: number; deletedAuditEvents: number; ranAt: string }
interface DashboardSummary { workspace: { id: string; code: string; name: string }; agentCounts: Record<string, number>; serviceCounts: Record<string, number>; commandCounts: Record<string, number>; auditEventCount: number; recentCommands: Command[]; recentAuditEvents: AuditEvent[] }

function queryString(params: Record<string, string | number | undefined | null>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}


function useQueryData<T>(loader: () => Promise<T>, deps: React.DependencyList = [], refreshMs?: number) {
  const [data, setData] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const reload = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setData(await loader()); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  React.useEffect(() => { void reload(); }, [reload]);
  React.useEffect(() => {
    if (!refreshMs) return undefined;
    const timer = window.setInterval(() => void reload(), refreshMs);
    return () => window.clearInterval(timer);
  }, [refreshMs, reload]);
  return { data, loading, error, reload };
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

function LoginPage({ onLogin }: { onLogin: (session: SessionData) => void }) {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = React.useState(false);
  return <Layout style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
    <Card title="Opstage CE 登录" style={{ width: 420 }}>
      <Form layout="vertical" initialValues={{ username: "admin" }} onFinish={async (values) => {
        setSubmitting(true);
        try { const session = await login(values.username, values.password); onLogin(session); message.success("登录成功"); navigate("/"); }
        catch (err) { message.error(err instanceof Error ? err.message : "登录失败"); }
        finally { setSubmitting(false); }
      }}>
        <Form.Item name="username" label="用户名" rules={[{ required: true }]}><Input autoFocus /></Form.Item>
        <Form.Item name="password" label="密码" rules={[{ required: true }]}><Input.Password /></Form.Item>
        <Button type="primary" htmlType="submit" loading={submitting} block>登录</Button>
      </Form>
    </Card>
  </Layout>;
}

function Shell({ session, onLogout }: { session: SessionData; onLogout: () => void }) {
  const location = useLocation();
  const menuEntries: Array<[string, string]> = [
    ["/", "Dashboard"], ["/users", "Users"], ["/registration-tokens", "Registration Tokens"], ["/agents", "Agents"],
    ["/services", "Capsule Services"], ["/commands", "Commands"], ["/audit-events", "Audit Events"], ["/settings", "Settings"]
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
        <Button onClick={async () => { await logout(); onLogout(); }}>退出</Button>
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
  const { data, loading, reload } = useQueryData<DashboardSummary>(() => apiFetch("/api/admin/dashboard/summary"), [], 5000);
  return <Space direction="vertical" size="large" style={{ width: "100%" }}>
    <Space style={{ justifyContent: "space-between", width: "100%" }}><Typography.Title>Dashboard</Typography.Title><Button onClick={reload}>刷新</Button></Space>
    <Space wrap>
      <Card><Statistic title="Workspace" value={data?.workspace.name ?? "-"} /></Card>
      <Card><Statistic title="Online Agents" value={data?.agentCounts.ONLINE ?? 0} loading={loading} /></Card>
      <Card><Statistic title="Healthy Services" value={data?.serviceCounts.HEALTHY ?? 0} loading={loading} /></Card>
      <Card><Statistic title="Running Commands" value={data?.commandCounts.RUNNING ?? 0} loading={loading} /></Card>
      <Card><Statistic title="Audit Events" value={data?.auditEventCount ?? 0} loading={loading} /></Card>
    </Space>
    <Card title="最近命令"><Table rowKey="id" loading={loading} dataSource={data?.recentCommands ?? []} pagination={false} columns={[
      { title: "时间", dataIndex: "createdAt" }, { title: "Action", dataIndex: "actionName" }, { title: "状态", dataIndex: "status", render: (v) => <StatusTag value={String(v)} /> }
    ]} /></Card>
    <Card title="最近审计事件"><Table rowKey="id" loading={loading} dataSource={data?.recentAuditEvents ?? []} pagination={false} columns={[
      { title: "时间", dataIndex: "createdAt" }, { title: "Actor", dataIndex: "actorType" }, { title: "Action", dataIndex: "action" }, { title: "Result", dataIndex: "result", render: (v) => <StatusTag value={String(v)} /> }
    ]} /></Card>
  </Space>;
}


function Users() {
  const { data, loading, error, reload } = useQueryData(() => apiList<User>("/api/admin/users?pageSize=50"));
  const [createOpen, setCreateOpen] = React.useState(false);
  if (error) return <Card title="Users"><Typography.Text type="danger">{error}</Typography.Text></Card>;
  return <Card title="Users" extra={<Space><Button onClick={reload}>刷新</Button><Button type="primary" onClick={() => setCreateOpen(true)}>创建用户</Button></Space>}>
    <Modal open={createOpen} title="创建用户" footer={null} onCancel={() => setCreateOpen(false)} destroyOnClose>
      <Form layout="vertical" initialValues={{ role: "viewer" }} onFinish={async (values) => { await apiFetch<User>("/api/admin/users", { method: "POST", body: JSON.stringify(values) }); message.success("用户已创建"); setCreateOpen(false); void reload(); }}>
        <Form.Item name="username" label="用户名" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="displayName" label="显示名"><Input /></Form.Item>
        <Form.Item name="role" label="角色" rules={[{ required: true }]}><Select options={["owner", "operator", "viewer"].map(value => ({ value, label: value }))} /></Form.Item>
        <Form.Item name="password" label="初始密码" rules={[{ required: true, min: 12 }]}><Input.Password /></Form.Item>
        <Button type="primary" htmlType="submit">创建</Button>
      </Form>
    </Modal>
    <Table rowKey="id" loading={loading} dataSource={data?.data ?? []} pagination={{ pageSize: 20, total: data?.pagination?.total }} columns={[
      { title: "Username", dataIndex: "username" }, { title: "显示名", dataIndex: "displayName" }, { title: "Role", dataIndex: "role", render: (v) => <Tag>{v}</Tag> }, { title: "状态", dataIndex: "status", render: (v) => <StatusTag value={v} /> }, { title: "Last Login", dataIndex: "lastLoginAt" },
      { title: "操作", render: (_, row) => row.status === "ACTIVE" ? <Button danger size="small" disabled={row.role === "owner"} onClick={async () => { await apiFetch(`/api/admin/users/${row.id}`, { method: "PATCH", body: JSON.stringify({ status: "DISABLED" }) }); message.success("用户已禁用"); void reload(); }}>禁用</Button> : null }
    ] as ColumnsType<User>} />
  </Card>;
}

function RegistrationTokens() {
  const { data, loading, reload } = useQueryData(() => apiList<RegistrationToken>("/api/admin/registration-tokens"));
  const [created, setCreated] = React.useState<RegistrationToken | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  return <Card title="Registration Tokens" extra={<Space><Button onClick={reload}>刷新</Button><Button type="primary" onClick={() => setCreateOpen(true)}>创建</Button></Space>}>
    {created && <Card type="inner" title="令牌仅显示一次" style={{ marginBottom: 16 }}><Input.TextArea value={created.token} autoSize readOnly /></Card>}
    <Modal open={createOpen} title="创建注册令牌" footer={null} onCancel={() => setCreateOpen(false)} destroyOnClose>
      <CreateTokenForm onCreated={(token) => { setCreated(token); setCreateOpen(false); void reload(); }} />
    </Modal>
    <Table rowKey="id" loading={loading} dataSource={data?.data ?? []} columns={[
      { title: "名称", dataIndex: "name" }, { title: "状态", dataIndex: "status", render: (v) => <StatusTag value={v} /> }, { title: "Agent", dataIndex: "agentId" }, { title: "创建时间", dataIndex: "createdAt" },
      { title: "操作", render: (_, row) => row.status === "ACTIVE" ? <Button danger onClick={async () => { await apiFetch(`/api/admin/registration-tokens/${row.id}/revoke`, { method: "POST" }); message.success("已吊销"); void reload(); }}>吊销</Button> : null }
    ] as ColumnsType<RegistrationToken>} />
  </Card>;
}

function CreateTokenForm({ onCreated }: { onCreated: (token: RegistrationToken) => void }) {
  return <Form id="create-token" layout="vertical" onFinish={async (values) => { const token = await apiFetch<RegistrationToken>("/api/admin/registration-tokens", { method: "POST", body: JSON.stringify(values) }); onCreated(token); }}>
    <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input placeholder="demo-agent" /></Form.Item>
    <Form.Item name="expiresInSeconds" label="有效秒数"><InputNumber min={60} style={{ width: "100%" }} placeholder="可选" /></Form.Item>
    <Button type="primary" htmlType="submit">创建</Button>
  </Form>;
}

function Agents() {
  const [filters, setFilters] = React.useState<{ q?: string; status?: string }>({});
  const { data, loading, reload } = useQueryData(() => apiList<Agent>(`/api/admin/agents${queryString({ ...filters, pageSize: 50 })}`), [filters.q, filters.status]);
  const [selected, setSelected] = React.useState<Agent | null>(null);
  return <Card title="Agents" extra={<Button onClick={reload}>刷新</Button>}>
    <Space style={{ marginBottom: 16 }} wrap>
      <Input.Search placeholder="搜索 code/name" allowClear onSearch={(q) => setFilters(prev => ({ ...prev, q }))} style={{ width: 240 }} />
      <Select allowClear placeholder="状态" style={{ width: 160 }} onChange={(status) => setFilters(prev => ({ ...prev, status }))} options={["ONLINE", "OFFLINE", "DISABLED", "REVOKED"].map(value => ({ value, label: value }))} />
    </Space>
    <Table rowKey="id" loading={loading} dataSource={data?.data ?? []} pagination={{ pageSize: 20, total: data?.pagination?.total }} onRow={(row) => ({ onClick: async () => setSelected(await apiFetch<Agent>(`/api/admin/agents/${row.id}`)) })} columns={[
      { title: "Code", dataIndex: "code" }, { title: "名称", dataIndex: "name" }, { title: "模式", dataIndex: "mode" }, { title: "Runtime", dataIndex: "runtime" }, { title: "状态", dataIndex: "status", render: (v) => <StatusTag value={v} /> }, { title: "Heartbeat", dataIndex: "lastHeartbeatAt" },
      { title: "操作", render: (_, row) => !["DISABLED", "REVOKED"].includes(row.status) ? <Space><Button size="small" onClick={async (event) => { event.stopPropagation(); await apiFetch(`/api/admin/agents/${row.id}/disable`, { method: "POST" }); message.success("Agent 已禁用"); void reload(); }}>禁用</Button><Button danger size="small" onClick={async (event) => { event.stopPropagation(); await apiFetch(`/api/admin/agents/${row.id}/revoke`, { method: "POST" }); message.success("Agent 已吊销"); void reload(); }}>吊销</Button></Space> : null }
    ] as ColumnsType<Agent>} />
    <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected?.code} width={720}>
      <Descriptions bordered column={1} items={selected ? Object.entries(selected).filter(([k]) => k !== "services").map(([key, value]) => ({ key, label: key, children: String(value ?? "-") })) : []} />
      <Typography.Title level={4} style={{ marginTop: 24 }}>Services</Typography.Title>
      <Table rowKey="id" dataSource={selected?.services ?? []} pagination={false} columns={[{ title: "Code", dataIndex: "code" }, { title: "Name", dataIndex: "name" }, { title: "Health", dataIndex: "healthStatus", render: (v) => <StatusTag value={v} /> }]} />
    </Drawer>
  </Card>;
}

function Services() {
  const [filters, setFilters] = React.useState<{ q?: string; status?: string; healthStatus?: string }>({});
  const { data, loading, reload } = useQueryData(() => apiList<Service>(`/api/admin/capsule-services${queryString({ ...filters, pageSize: 50 })}`), [filters.q, filters.status, filters.healthStatus]);
  const [selected, setSelected] = React.useState<Service | null>(null);
  const openService = async (id: string) => setSelected(await apiFetch<Service>(`/api/admin/capsule-services/${id}`));
  return <Card title="Capsule Services" extra={<Button onClick={reload}>刷新</Button>}>
    <Space style={{ marginBottom: 16 }} wrap>
      <Input.Search placeholder="搜索 code/name" allowClear onSearch={(q) => setFilters(prev => ({ ...prev, q }))} style={{ width: 240 }} />
      <Select allowClear placeholder="服务状态" style={{ width: 160 }} onChange={(status) => setFilters(prev => ({ ...prev, status }))} options={["HEALTHY", "UNHEALTHY", "UNKNOWN"].map(value => ({ value, label: value }))} />
      <Select allowClear placeholder="健康状态" style={{ width: 160 }} onChange={(healthStatus) => setFilters(prev => ({ ...prev, healthStatus }))} options={["UP", "DEGRADED", "DOWN", "UNKNOWN"].map(value => ({ value, label: value }))} />
    </Space>
    <Table rowKey="id" loading={loading} dataSource={data?.data ?? []} pagination={{ pageSize: 20, total: data?.pagination?.total }} onRow={(row) => ({ onClick: () => void openService(row.id) })} columns={[
      { title: "Code", dataIndex: "code" }, { title: "名称", dataIndex: "name" }, { title: "版本", dataIndex: "version" }, { title: "状态", dataIndex: "status", render: (v) => <StatusTag value={v} /> }, { title: "Health", dataIndex: "healthStatus", render: (v) => <StatusTag value={v} /> }, { title: "Last Report", dataIndex: "lastReportedAt" }
    ]} />
    <ServiceDrawer service={selected} onClose={() => setSelected(null)} onCommandCreated={() => message.success("命令已创建，等待 Agent 拉取执行")} />
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
  type?: string;
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

function SchemaPayloadFields({ action, setPayload }: { action: Action; setPayload: (payload: string) => void }) {
  const [form] = Form.useForm<Record<string, string | number | boolean | undefined>>();
  const properties = getSchemaProperties(action);
  const required = Array.isArray(action.inputSchema?.required) ? action.inputSchema.required as string[] : [];
  React.useEffect(() => {
    const defaults = defaultPayloadForAction(action);
    form.setFieldsValue(defaults as Record<string, string | number | boolean | undefined>);
    setPayload(JSON.stringify(defaults, null, 2));
  }, [action, form, setPayload]);
  if (Object.keys(properties).length === 0) return null;
  return <Form form={form} layout="vertical" onValuesChange={(_, values) => setPayload(JSON.stringify(values, null, 2))}>
    {Object.entries(properties).map(([name, property]) => {
      const label = property.title ?? name;
      const rules = required.includes(name) ? [{ required: true, message: `${label} 必填` }] : undefined;
      if (property.enum) {
        return <Form.Item key={name} name={name} label={label} tooltip={property.description} rules={rules}>
          <Select options={property.enum.map(value => ({ value: String(value), label: String(value) }))} />
        </Form.Item>;
      }
      if (property.type === "boolean") {
        return <Form.Item key={name} name={name} label={label} tooltip={property.description} valuePropName="checked" rules={rules}>
          <Switch />
        </Form.Item>;
      }
      if (property.type === "number" || property.type === "integer") {
        return <Form.Item key={name} name={name} label={label} tooltip={property.description} rules={rules}>
          <InputNumber style={{ width: "100%" }} />
        </Form.Item>;
      }
      return <Form.Item key={name} name={name} label={label} tooltip={property.description} rules={rules}>
        <Input />
      </Form.Item>;
    })}
  </Form>;
}

function ServiceDrawer({ service, onClose, onCommandCreated }: { service: Service | null; onClose: () => void; onCommandCreated: () => void }) {
  const [action, setAction] = React.useState<Action | null>(null);
  const [payload, setPayload] = React.useState("{}");
  const submitAction = async () => {
    if (!service || !action) return;
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(payload) as Record<string, unknown>; } catch { message.error("Payload 必须是合法 JSON"); return; }
    await apiFetch<Command>(`/api/admin/capsule-services/${service.id}/actions/${action.name}`, { method: "POST", body: JSON.stringify({ payload: parsed, confirmation: action.requiresConfirmation }) });
    setAction(null); setPayload("{}"); onCommandCreated();
  };
  return <Drawer open={!!service} onClose={onClose} title={service?.name} width={860}>
    {service && <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Descriptions bordered column={2} items={["code", "version", "runtime", "status", "healthStatus", "lastReportedAt", "lastHealthAt"].map((key) => ({ key, label: key, children: key.toLowerCase().includes("status") ? <StatusTag value={String((service as unknown as Record<string, unknown>)[key] ?? "")} /> : String((service as unknown as Record<string, unknown>)[key] ?? "-") }))} />
      <Card type="inner" title="Actions"><Space wrap>{(service.actions ?? []).map(a => <Button key={a.id} danger={a.dangerLevel !== "LOW" || a.requiresConfirmation} onClick={() => { setAction(a); setPayload(JSON.stringify(defaultPayloadForAction(a), null, 2)); }}>{a.label}</Button>)}</Space></Card>
      <Card type="inner" title="Configs"><Table rowKey="id" pagination={false} dataSource={service.configs ?? []} columns={[{ title: "Key", dataIndex: "configKey" }, { title: "Type", dataIndex: "type" }, { title: "Sensitive", dataIndex: "sensitive", render: (v) => v ? <Tag color="red">YES</Tag> : <Tag>NO</Tag> }, { title: "Preview", dataIndex: "valuePreview" }, { title: "Secret Ref", dataIndex: "secretRef" }]} /></Card>
      <Card type="inner" title="Health"><JsonBlock value={service.health ?? {}} /></Card>
      <Card type="inner" title="Manifest"><JsonBlock value={service.manifest ?? {}} /></Card>
    </Space>}
    <Modal open={!!action} title={`执行动作：${action?.label}`} onCancel={() => setAction(null)} onOk={() => void submitAction()} okText={action?.requiresConfirmation ? "确认执行" : "执行"} okButtonProps={{ danger: action?.requiresConfirmation }}>
      <Typography.Paragraph>{action?.description}</Typography.Paragraph>
      {action?.requiresConfirmation && <Typography.Paragraph type="danger">该动作要求二次确认。</Typography.Paragraph>}
      <Typography.Text type="secondary">Payload 会根据 action inputSchema 自动生成表单与初始 JSON，可按需修改。</Typography.Text>
      {action && <SchemaPayloadFields action={action} setPayload={setPayload} />}
      <Input.TextArea value={payload} onChange={(e) => setPayload(e.target.value)} rows={8} />
    </Modal>
  </Drawer>;
}

function Commands() {
  const [filters, setFilters] = React.useState<{ status?: string; actionName?: string }>({});
  const { data, loading, reload } = useQueryData(() => apiList<Command>(`/api/admin/commands${queryString({ ...filters, pageSize: 50 })}`), [filters.status, filters.actionName], 5000);
  const [selected, setSelected] = React.useState<Command | null>(null);
  return <Card title="Commands" extra={<Button onClick={reload}>刷新</Button>}>
    <Space style={{ marginBottom: 16 }} wrap>
      <Input.Search placeholder="Action 名称" allowClear onSearch={(actionName) => setFilters(prev => ({ ...prev, actionName }))} style={{ width: 220 }} />
      <Select allowClear placeholder="状态" style={{ width: 180 }} onChange={(status) => setFilters(prev => ({ ...prev, status }))} options={["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"].map(value => ({ value, label: value }))} />
    </Space>
    <Table rowKey="id" loading={loading} dataSource={data?.data ?? []} pagination={{ pageSize: 20, total: data?.pagination?.total }} onRow={(row) => ({ onClick: async () => setSelected(await apiFetch<Command>(`/api/admin/commands/${row.id}`)) })} columns={[
      { title: "ID", dataIndex: "id" }, { title: "Action", dataIndex: "actionName" }, { title: "状态", dataIndex: "status", render: (v) => <StatusTag value={v} /> }, { title: "创建时间", dataIndex: "createdAt" }, { title: "完成时间", dataIndex: "completedAt" },
      { title: "操作", render: (_, row) => ["PENDING", "RUNNING"].includes(row.status) ? <Button danger size="small" onClick={async (event) => { event.stopPropagation(); await apiFetch(`/api/admin/commands/${row.id}/cancel`, { method: "POST" }); message.success("命令已取消"); void reload(); }}>取消</Button> : null }
    ] as ColumnsType<Command>} />
    <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected?.id} width={720}>
      <Descriptions bordered column={1} items={selected ? [
        { key: "status", label: "状态", children: <StatusTag value={selected.status} /> },
        { key: "action", label: "Action", children: selected.actionName },
        { key: "createdAt", label: "创建时间", children: selected.createdAt },
        { key: "completedAt", label: "完成时间", children: selected.completedAt ?? "-" }
      ] : []} />
      <Typography.Title level={5} style={{ marginTop: 24 }}>Payload</Typography.Title><JsonBlock value={selected?.payload} />
      <Typography.Title level={5}>Result / Error</Typography.Title><JsonBlock value={selected?.result ?? { errorCode: selected?.errorCode, errorMessage: selected?.errorMessage }} />
    </Drawer>
  </Card>;
}

function AuditEvents() {
  const [filters, setFilters] = React.useState<{ actorType?: string; result?: string; action?: string; targetType?: string }>({});
  const { data, loading, reload } = useQueryData(() => apiList<AuditEvent>(`/api/admin/audit-events${queryString({ ...filters, pageSize: 50 })}`), [filters.actorType, filters.result, filters.action, filters.targetType], 5000);
  return <Card title="Audit Events" extra={<Space><Button onClick={() => void downloadBlob(`/api/admin/audit-events/export?format=csv${filters.action ? `&action=${filters.action}` : ""}`, "audit-events.csv")}>导出 CSV</Button><Button onClick={reload}>刷新</Button></Space>}>
    <Space style={{ marginBottom: 16 }} wrap>
      <Input.Search placeholder="Action" allowClear onSearch={(action) => setFilters(prev => ({ ...prev, action }))} style={{ width: 220 }} />
      <Select allowClear placeholder="Actor" style={{ width: 140 }} onChange={(actorType) => setFilters(prev => ({ ...prev, actorType }))} options={["USER", "AGENT", "SYSTEM"].map(value => ({ value, label: value }))} />
      <Select allowClear placeholder="Result" style={{ width: 140 }} onChange={(result) => setFilters(prev => ({ ...prev, result }))} options={["SUCCESS", "FAILURE"].map(value => ({ value, label: value }))} />
      <Input placeholder="Target Type" allowClear onChange={(event) => setFilters(prev => ({ ...prev, targetType: event.target.value }))} style={{ width: 180 }} />
    </Space>
    <Table rowKey="id" loading={loading} dataSource={data?.data ?? []} pagination={{ pageSize: 20, total: data?.pagination?.total }} columns={[{ title: "时间", dataIndex: "createdAt" }, { title: "Actor", dataIndex: "actorType" }, { title: "Action", dataIndex: "action" }, { title: "Target", dataIndex: "targetType" }, { title: "Result", dataIndex: "result", render: (v) => <StatusTag value={String(v)} /> }, { title: "Message", dataIndex: "message" }]} />
  </Card>;
}

function Settings() {
  const { data, loading, reload } = useQueryData<MaintenanceSettings>(() => apiFetch("/api/admin/settings/maintenance"));
  const metrics = useQueryData<Metrics>(() => apiFetch("/api/admin/metrics"), [], 5000);
  const diagnostics = useQueryData<Record<string, unknown>>(() => apiFetch("/api/admin/diagnostics/runtime"));
  const [result, setResult] = React.useState<MaintenanceResult | null>(null);
  const [running, setRunning] = React.useState(false);
  return <Space direction="vertical" size="large" style={{ width: "100%" }}>
    <Card title="Maintenance Settings" loading={loading} extra={<Button onClick={reload}>刷新</Button>}>
      <Descriptions bordered column={1} items={[
        { key: "agentStaleSeconds", label: "Agent stale seconds", children: data?.agentStaleSeconds ?? "-" },
        { key: "auditRetentionDays", label: "Audit retention days", children: data?.auditRetentionDays ?? "-" },
        { key: "maintenanceIntervalSeconds", label: "Maintenance interval seconds", children: data?.maintenanceIntervalSeconds ?? "-" }
      ]} />
      <Space style={{ marginTop: 16 }}>
        <Button type="primary" loading={running} onClick={async () => {
          setRunning(true);
          try { const output = await apiFetch<MaintenanceResult>("/api/admin/maintenance/run", { method: "POST" }); setResult(output); message.success("维护任务已执行"); }
          catch (err) { message.error(err instanceof Error ? err.message : "维护任务执行失败"); }
          finally { setRunning(false); }
        }}>立即运行维护任务</Button>
        <Button onClick={() => void downloadBlob("/api/admin/backup/sqlite", "opstage-backup.db", { method: "POST" })}>下载 SQLite 备份</Button>
      </Space>
    </Card>
    {result && <Card title="Last Maintenance Result"><JsonBlock value={result} /></Card>}
    <Card title="Metrics" loading={metrics.loading}><JsonBlock value={metrics.data} /></Card>
    <Card title="Runtime Diagnostics" loading={diagnostics.loading}><JsonBlock value={diagnostics.data} /></Card>
  </Space>;
}

export function App() {
  const [session, setSession] = React.useState<SessionData | null>(null);
  const [booting, setBooting] = React.useState(true);
  React.useEffect(() => { me().then(setSession).catch((err) => { if (!(err instanceof ApiError && err.status === 401)) console.warn(err); }).finally(() => setBooting(false)); }, []);
  if (booting) return <Layout style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}><Typography.Text>Loading...</Typography.Text></Layout>;
  return <AntApp>{session ? <Shell session={session} onLogout={() => setSession(null)} /> : <Routes><Route path="/login" element={<LoginPage onLogin={setSession} />} /><Route path="*" element={<Navigate to="/login" replace />} /></Routes>}</AntApp>;
}
