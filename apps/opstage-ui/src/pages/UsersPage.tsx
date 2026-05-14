import { Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import React from "react";
import { apiFetch, apiList } from "../api.js";
import { StatusTag } from "../components.js";
import { useI18n } from "../i18n.js";
import { queryString, useQueryData } from "../lib/list-helpers.js";
import { defaultPage, type PageState, type User } from "../lib/types.js";

/**
 * Owner-only user management page. Owners can create operators / viewers,
 * change roles, disable / enable accounts, and reset passwords. Non-owner
 * operators see this page in read-only mode (the backend rejects mutations
 * with FORBIDDEN_ROLE).
 */
export function UsersPage() {
  const { t } = useI18n();
  const [filters, setFilters] = React.useState<{ q?: string; role?: string; status?: string }>({});
  const [page, setPage] = React.useState<PageState>(defaultPage);
  const updateFilters = (next: { q?: string; role?: string; status?: string }) => {
    setFilters(next);
    setPage(defaultPage);
  };
  const { data, loading, error, reload } = useQueryData(
    () => apiList<User>(`/api/admin/users${queryString({ ...filters, ...page })}`),
    [filters.q, filters.role, filters.status, page.page, page.pageSize],
  );
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<User | null>(null);
  const [resetTarget, setResetTarget] = React.useState<User | null>(null);
  if (error) {
    return (
      <Card title={t("user.title")}>
        <Typography.Text type="danger">{error}</Typography.Text>
      </Card>
    );
  }
  return (
    <Card
      title={t("user.title")}
      extra={
        <Space>
          <Button onClick={reload}>{t("action.refresh")}</Button>
          <Button type="primary" onClick={() => setCreateOpen(true)}>
            {t("user.createTitle")}
          </Button>
        </Space>
      }
    >
      <Modal open={createOpen} title={t("user.createTitle")} footer={null} onCancel={() => setCreateOpen(false)} destroyOnClose>
        <Form
          layout="vertical"
          initialValues={{ role: "viewer" }}
          onFinish={async (values) => {
            await apiFetch<User>("/api/admin/users", { method: "POST", body: JSON.stringify(values) });
            message.success(t("user.created"));
            setCreateOpen(false);
            void reload();
          }}
        >
          <Form.Item name="username" label={t("login.username")} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="displayName" label={t("common.displayName")}>
            <Input />
          </Form.Item>
          <Form.Item name="role" label={t("common.role")} rules={[{ required: true }]}>
            <Select options={["owner", "operator", "viewer"].map((value) => ({ value, label: value }))} />
          </Form.Item>
          <Form.Item name="password" label={t("user.initialPassword")} rules={[{ required: true, min: 12 }]}>
            <Input.Password />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            {t("action.create")}
          </Button>
        </Form>
      </Modal>
      <Modal open={!!editTarget} title={t("user.updateTitle")} footer={null} onCancel={() => setEditTarget(null)} destroyOnClose>
        {editTarget && (
          <Form
            layout="vertical"
            initialValues={{ displayName: editTarget.displayName, role: editTarget.role, status: editTarget.status }}
            onFinish={async (values) => {
              await apiFetch(`/api/admin/users/${editTarget.id}`, { method: "PATCH", body: JSON.stringify(values) });
              message.success(t("user.updated"));
              setEditTarget(null);
              void reload();
            }}
          >
            <Form.Item name="displayName" label={t("common.displayName")}>
              <Input />
            </Form.Item>
            <Form.Item name="role" label={t("common.role")} rules={[{ required: true }]}>
              <Select options={["owner", "operator", "viewer"].map((value) => ({ value, label: value }))} />
            </Form.Item>
            <Form.Item name="status" label={t("common.status")} rules={[{ required: true }]}>
              <Select options={["ACTIVE", "DISABLED"].map((value) => ({ value, label: value }))} />
            </Form.Item>
            <Button type="primary" htmlType="submit">
              {t("action.edit")}
            </Button>
          </Form>
        )}
      </Modal>
      <Modal open={!!resetTarget} title={t("user.resetPasswordTitle")} footer={null} onCancel={() => setResetTarget(null)} destroyOnClose>
        <Form
          layout="vertical"
          onFinish={async (values) => {
            if (!resetTarget) return;
            await apiFetch(`/api/admin/users/${resetTarget.id}/reset-password`, {
              method: "POST",
              body: JSON.stringify({ password: values.password }),
            });
            message.success(t("user.passwordReset"));
            setResetTarget(null);
            void reload();
          }}
        >
          <Form.Item name="password" label={t("user.newPassword")} rules={[{ required: true, min: 12 }]}>
            <Input.Password />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            {t("user.resetPassword")}
          </Button>
        </Form>
      </Modal>
      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search placeholder={t("user.searchPlaceholder")} allowClear onSearch={(q) => updateFilters({ ...filters, q })} style={{ width: 260 }} />
        <Select
          allowClear
          placeholder={t("common.role")}
          style={{ width: 160 }}
          onChange={(role) => updateFilters({ ...filters, role })}
          options={["owner", "operator", "viewer"].map((value) => ({ value, label: value }))}
        />
        <Select
          allowClear
          placeholder={t("common.status")}
          style={{ width: 160 }}
          onChange={(status) => updateFilters({ ...filters, status })}
          options={["ACTIVE", "DISABLED"].map((value) => ({ value, label: value }))}
        />
        <Button onClick={() => updateFilters({})}>{t("user.resetFilters")}</Button>
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
          { title: t("common.username"), dataIndex: "username" },
          { title: t("common.displayName"), dataIndex: "displayName" },
          { title: t("common.role"), dataIndex: "role", render: (v) => <Tag>{v}</Tag> },
          { title: t("common.status"), dataIndex: "status", render: (v) => <StatusTag value={v} /> },
          { title: t("user.lastLogin"), dataIndex: "lastLoginAt" },
          {
            title: t("common.operation"),
            render: (_, row) => (
              <Space>
                <Button size="small" onClick={() => setEditTarget(row)}>
                  {t("action.edit")}
                </Button>
                <Button size="small" onClick={() => setResetTarget(row)}>
                  {t("user.resetPassword")}
                </Button>
                {row.status === "ACTIVE" ? (
                  <Popconfirm
                    title={t("confirm.disableUser")}
                    onConfirm={async () => {
                      await apiFetch(`/api/admin/users/${row.id}`, { method: "PATCH", body: JSON.stringify({ status: "DISABLED" }) });
                      message.success(t("user.disabled"));
                      void reload();
                    }}
                  >
                    <Button danger size="small" disabled={row.role === "owner"}>
                      {t("action.disable")}
                    </Button>
                  </Popconfirm>
                ) : (
                  <Button
                    size="small"
                    onClick={async () => {
                      await apiFetch(`/api/admin/users/${row.id}`, { method: "PATCH", body: JSON.stringify({ status: "ACTIVE" }) });
                      message.success(t("user.enabled"));
                      void reload();
                    }}
                  >
                    {t("action.enable")}
                  </Button>
                )}
              </Space>
            ),
          },
        ] as ColumnsType<User>}
      />
    </Card>
  );
}
