import { Alert, Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tabs, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import React from "react";
import { apiFetch, apiList } from "../api.js";
import { JsonBlock, ShortIdText, StatusTag } from "../components.js";
import { useI18n } from "../i18n.js";
import { formatTimestampSeconds } from "../lib/format.js";
import { queryString, useQueryData } from "../lib/list-helpers.js";
import { defaultPage, type AuditEvent, type BusEvent, type BusRoute, type PageState } from "../lib/types.js";

type RouteFormValues = {
  name: string;
  description?: string;
  status: "ENABLED" | "DISABLED" | "DRY_RUN";
  eventType: string;
  sourceServiceCode?: string;
  targetServiceCode: string;
  actionName: string;
};

function routePayload(values: RouteFormValues) {
  return {
    name: values.name,
    description: values.description || undefined,
    status: values.status ?? "DISABLED",
    match: { eventType: values.eventType, sourceServiceCode: values.sourceServiceCode || undefined },
    target: { serviceCode: values.targetServiceCode, actionName: values.actionName },
  };
}

function routeInitialValues(route?: BusRoute | null): Partial<RouteFormValues> {
  return route
    ? {
        name: route.name,
        description: route.description ?? undefined,
        status: route.status as RouteFormValues["status"],
        eventType: route.match?.eventType,
        sourceServiceCode: route.match?.sourceServiceCode,
        targetServiceCode: route.target?.serviceCode,
        actionName: route.target?.actionName,
      }
    : { status: "DISABLED" };
}

export function BusPage() {
  const { t } = useI18n();
  const [page, setPage] = React.useState<PageState>(defaultPage);
  const [auditPage, setAuditPage] = React.useState<PageState>(defaultPage);
  const [editing, setEditing] = React.useState<BusRoute | null>(null);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [form] = Form.useForm<RouteFormValues>();
  const routes = useQueryData(() => apiFetch<BusRoute[]>("/api/admin/bus/routes"), [], 5000);
  const events = useQueryData(() => apiList<BusEvent>(`/api/admin/bus/events${queryString({ page: page.page, pageSize: page.pageSize })}`), [page.page, page.pageSize], 5000);
  const audit = useQueryData(() => apiList<AuditEvent>(`/api/admin/bus/audit${queryString({ page: auditPage.page, pageSize: auditPage.pageSize })}`), [auditPage.page, auditPage.pageSize], 5000);

  const disabled = [routes.errorCode, events.errorCode, audit.errorCode].includes("CAPSULE_BUS_DISABLED");

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue(routeInitialValues(null));
    setModalOpen(true);
  };
  const openEdit = (route: BusRoute) => {
    setEditing(route);
    form.setFieldsValue(routeInitialValues(route));
    setModalOpen(true);
  };
  const saveRoute = async () => {
    const values = await form.validateFields();
    const payload = routePayload(values);
    if (editing) {
      await apiFetch<BusRoute>(`/api/admin/bus/routes/${editing.id}`, { method: "PUT", body: JSON.stringify(payload) });
      message.success(t("bus.routeUpdated"));
    } else {
      await apiFetch<BusRoute>("/api/admin/bus/routes", { method: "POST", body: JSON.stringify(payload) });
      message.success(t("bus.routeCreated"));
    }
    setModalOpen(false);
    await Promise.all([routes.reload(), audit.reload()]);
  };
  const deleteRoute = async (route: BusRoute) => {
    await apiFetch<BusRoute>(`/api/admin/bus/routes/${route.id}`, { method: "DELETE" });
    message.success(t("bus.routeDeleted"));
    await Promise.all([routes.reload(), audit.reload()]);
  };

  const routeColumns: ColumnsType<BusRoute> = [
    { title: t("common.id"), dataIndex: "id", render: (v) => <ShortIdText value={String(v)} /> },
    { title: t("common.name"), dataIndex: "name" },
    { title: t("common.status"), dataIndex: "status", render: (v) => <StatusTag value={String(v)} /> },
    { title: t("bus.eventType"), render: (_, row) => <Typography.Text code>{row.match?.eventType}</Typography.Text> },
    { title: t("bus.sourceService"), render: (_, row) => row.match?.sourceServiceCode || <Typography.Text type="secondary">*</Typography.Text> },
    { title: t("bus.target"), render: (_, row) => <><Typography.Text code>{row.target?.serviceCode}</Typography.Text> / <Typography.Text code>{row.target?.actionName}</Typography.Text></> },
    { title: t("common.createdAt"), dataIndex: "updatedAt", render: (v) => formatTimestampSeconds(String(v)) },
    {
      title: t("common.action"),
      render: (_, row) => (
        <Space>
          <Button size="small" onClick={() => openEdit(row)}>{t("action.edit")}</Button>
          <Popconfirm title={t("confirm.deleteRoute")} onConfirm={() => void deleteRoute(row)}>
            <Button danger size="small">{t("action.delete")}</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const eventColumns: ColumnsType<BusEvent> = [
    { title: t("common.id"), dataIndex: "id", render: (v) => <ShortIdText value={String(v)} /> },
    { title: t("bus.eventType"), dataIndex: "eventType", render: (v) => <Typography.Text code>{String(v)}</Typography.Text> },
    { title: t("bus.sourceService"), dataIndex: "sourceServiceCode" },
    { title: t("bus.routeCount"), dataIndex: "routeCount", render: (v) => <Tag>{String(v)}</Tag> },
    { title: t("bus.acceptedAt"), dataIndex: "acceptedAt", render: (v) => formatTimestampSeconds(String(v)) },
    { title: t("common.preview"), render: (_, row) => <JsonBlock value={{ payload: row.payload, metadata: row.metadata }} /> },
  ];


  const auditColumns: ColumnsType<AuditEvent> = [
    { title: t("common.id"), dataIndex: "id", render: (v) => <ShortIdText value={String(v)} /> },
    { title: t("audit.action"), dataIndex: "action", render: (v) => <Typography.Text code>{String(v)}</Typography.Text> },
    { title: t("audit.actor"), render: (_, row) => <>{row.actorType}{row.actorId ? <> / <ShortIdText value={row.actorId} /></> : null}</> },
    { title: t("audit.target"), render: (_, row) => <>{row.targetType ?? "-"}{row.targetId ? <> / <ShortIdText value={row.targetId} /></> : null}</> },
    { title: t("common.result"), dataIndex: "result", render: (v) => <StatusTag value={String(v)} /> },
    { title: t("common.createdAt"), dataIndex: "createdAt", render: (v) => formatTimestampSeconds(String(v)) },
    { title: t("common.preview"), render: (_, row) => <JsonBlock value={row.metadata ?? {}} /> },
  ];

  return (
    <Card title={t("bus.title")} extra={<Button onClick={() => void Promise.all([routes.reload(), events.reload(), audit.reload()])}>{t("action.refresh")}</Button>}>
      <Alert type="warning" showIcon style={{ marginBottom: 16 }} message={t("bus.experimentalWarning")} />
      {disabled ? <Alert type="info" showIcon style={{ marginBottom: 16 }} message={t("bus.disabledHint")} /> : null}
      {routes.error && !disabled ? <Alert type="error" showIcon style={{ marginBottom: 16 }} message={routes.error} /> : null}
      {events.error && !disabled ? <Alert type="error" showIcon style={{ marginBottom: 16 }} message={events.error} /> : null}
      {audit.error && !disabled ? <Alert type="error" showIcon style={{ marginBottom: 16 }} message={audit.error} /> : null}
      <Tabs
        items={[
          {
            key: "routes",
            label: t("bus.routes"),
            children: (
              <>
                <Space style={{ marginBottom: 16 }}>
                  <Button type="primary" onClick={openCreate} disabled={disabled}>{t("bus.createRoute")}</Button>
                </Space>
                <Table rowKey="id" loading={routes.loading} dataSource={routes.data ?? []} columns={routeColumns} scroll={{ x: 1200 }} />
              </>
            ),
          },
          {
            key: "events",
            label: t("bus.events"),
            children: (
              <Table
                rowKey="id"
                loading={events.loading}
                dataSource={events.data?.data ?? []}
                columns={eventColumns}
                scroll={{ x: 1200 }}
                pagination={{
                  current: events.data?.pagination?.page ?? page.page,
                  pageSize: events.data?.pagination?.pageSize ?? page.pageSize,
                  total: events.data?.pagination?.total,
                  showSizeChanger: true,
                  onChange: (nextPage, nextPageSize) => setPage({ page: nextPage, pageSize: nextPageSize }),
                }}
              />
            ),
          },
          {
            key: "audit",
            label: t("bus.audit"),
            children: (
              <Table
                rowKey="id"
                loading={audit.loading}
                dataSource={audit.data?.data ?? []}
                columns={auditColumns}
                scroll={{ x: 1200 }}
                pagination={{
                  current: audit.data?.pagination?.page ?? auditPage.page,
                  pageSize: audit.data?.pagination?.pageSize ?? auditPage.pageSize,
                  total: audit.data?.pagination?.total,
                  showSizeChanger: true,
                  onChange: (nextPage, nextPageSize) => setAuditPage({ page: nextPage, pageSize: nextPageSize }),
                }}
              />
            ),
          },
        ]}
      />
      <Modal title={editing ? t("bus.editRoute") : t("bus.createRoute")} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => void saveRoute()} destroyOnClose>
        <Form form={form} layout="vertical" preserve={false} initialValues={routeInitialValues(editing)}>
          <Form.Item name="name" label={t("common.name")} rules={[{ required: true, message: t("form.required") }]}><Input /></Form.Item>
          <Form.Item name="description" label={t("common.description")}><Input.TextArea rows={2} /></Form.Item>
          <Form.Item name="status" label={t("common.status")} rules={[{ required: true, message: t("form.required") }]}>
            <Select options={["DISABLED", "DRY_RUN", "ENABLED"].map((value) => ({ value, label: value }))} />
          </Form.Item>
          <Form.Item name="eventType" label={t("bus.eventType")} rules={[{ required: true, message: t("form.required") }]}><Input placeholder="demo.item.created" /></Form.Item>
          <Form.Item name="sourceServiceCode" label={t("bus.sourceService")}><Input placeholder="demo-worker" /></Form.Item>
          <Form.Item name="targetServiceCode" label={t("bus.targetService")} rules={[{ required: true, message: t("form.required") }]}><Input placeholder="demo-worker" /></Form.Item>
          <Form.Item name="actionName" label={t("bus.actionName")} rules={[{ required: true, message: t("form.required") }]}><Input placeholder="notify" /></Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
