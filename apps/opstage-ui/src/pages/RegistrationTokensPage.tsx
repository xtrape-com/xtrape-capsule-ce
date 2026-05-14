import { Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import React from "react";
import { apiFetch, apiList } from "../api.js";
import { StatusTag } from "../components.js";
import { useI18n } from "../i18n.js";
import { queryString, useQueryData } from "../lib/list-helpers.js";
import { defaultPage, type PageState, type RegistrationToken } from "../lib/types.js";

/**
 * Inline form used inside the "create token" modal. Extracted because
 * antd's Modal `destroyOnClose` semantics work better when the form is
 * a separate component (fresh state on each open).
 */
function CreateTokenForm({ onCreated }: { onCreated: (token: RegistrationToken) => void }) {
  const { t } = useI18n();
  const [submitting, setSubmitting] = React.useState(false);
  return (
    <Form
      id="create-token"
      layout="vertical"
      onFinish={async (values) => {
        const body = Object.fromEntries(
          Object.entries(values as Record<string, unknown>).filter(
            ([, value]) => value !== undefined && value !== null && value !== "",
          ),
        );
        setSubmitting(true);
        try {
          const token = await apiFetch<RegistrationToken>("/api/admin/registration-tokens", {
            method: "POST",
            body: JSON.stringify(body),
          });
          onCreated(token);
        } catch (err) {
          message.error(err instanceof Error ? err.message : t("login.failed"));
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <Form.Item name="name" label={t("common.name")} rules={[{ required: true }]}>
        <Input placeholder="demo-agent" />
      </Form.Item>
      <Form.Item name="expiresInSeconds" label={t("registration.expiresInSeconds")}>
        <InputNumber min={60} style={{ width: "100%" }} placeholder={t("form.optional")} />
      </Form.Item>
      <Button type="primary" htmlType="submit" loading={submitting}>
        {t("action.create")}
      </Button>
    </Form>
  );
}

/**
 * Registration token management page. The plaintext token is only shown
 * once on creation; the table renders a placeholder for all other rows
 * because the backend never returns the secret again.
 */
export function RegistrationTokensPage() {
  const { t } = useI18n();
  const [filters, setFilters] = React.useState<{ status?: string }>({});
  const [page, setPage] = React.useState<PageState>(defaultPage);
  const updateFilters = (next: { status?: string }) => {
    setFilters(next);
    setPage(defaultPage);
  };
  const { data, loading, reload } = useQueryData(
    () => apiList<RegistrationToken>(`/api/admin/registration-tokens${queryString({ ...filters, ...page })}`),
    [filters.status, page.page, page.pageSize],
  );
  const [created, setCreated] = React.useState<RegistrationToken | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const createdTokenValue = created?.token ?? created?.rawToken ?? "";
  const copyCreatedToken = async () => {
    if (!createdTokenValue) return;
    await navigator.clipboard.writeText(createdTokenValue);
    message.success(t("registration.copySuccess"));
  };
  return (
    <Card
      title={t("registration.title")}
      extra={
        <Space>
          <Button onClick={reload}>{t("action.refresh")}</Button>
          <Button type="primary" onClick={() => setCreateOpen(true)}>
            {t("action.create")}
          </Button>
        </Space>
      }
    >
      {created && (
        <Card
          type="inner"
          title={t("registration.createdOnce")}
          style={{ marginBottom: 16 }}
          extra={createdTokenValue ? <Button onClick={() => void copyCreatedToken()}>{t("registration.copyToken")}</Button> : null}
        >
          {createdTokenValue ? (
            <Input.TextArea value={createdTokenValue} autoSize readOnly />
          ) : (
            <Typography.Text type="danger">{t("registration.tokenUnavailable")}</Typography.Text>
          )}
        </Card>
      )}
      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          allowClear
          placeholder={t("common.status")}
          style={{ width: 180 }}
          onChange={(status) => updateFilters({ ...filters, status })}
          options={["ACTIVE", "USED", "REVOKED", "EXPIRED"].map((value) => ({ value, label: value }))}
        />
        <Button onClick={() => updateFilters({})}>{t("registration.resetFilters")}</Button>
      </Space>
      <Modal open={createOpen} title={t("registration.createTitle")} footer={null} onCancel={() => setCreateOpen(false)} destroyOnClose>
        <CreateTokenForm
          onCreated={(token) => {
            setCreated(token);
            setCreateOpen(false);
            void reload();
          }}
        />
      </Modal>
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
          { title: t("common.name"), dataIndex: "name" },
          { title: t("common.status"), dataIndex: "status", render: (v) => <StatusTag value={v} /> },
          {
            title: t("registration.token"),
            render: (_, row) =>
              row.id === created?.id && createdTokenValue ? (
                <Input value={createdTokenValue} readOnly />
              ) : (
                <Typography.Text type="secondary">{t("registration.tokenHidden")}</Typography.Text>
              ),
          },
          { title: "Agent", dataIndex: "agentId" },
          { title: t("registration.expiresAt"), dataIndex: "expiresAt", render: (v) => v ?? "-" },
          { title: t("common.createdAt"), dataIndex: "createdAt" },
          {
            title: t("common.operation"),
            render: (_, row) => (
              <Space>
                {row.id === created?.id && createdTokenValue ? (
                  <Button onClick={() => void copyCreatedToken()}>{t("registration.copyToken")}</Button>
                ) : null}
                {row.status === "ACTIVE" ? (
                  <Popconfirm
                    title={t("confirm.revokeToken")}
                    onConfirm={async () => {
                      await apiFetch(`/api/admin/registration-tokens/${row.id}/revoke`, { method: "POST" });
                      message.success(t("registration.revoked"));
                      void reload();
                    }}
                  >
                    <Button danger>{t("action.revoke")}</Button>
                  </Popconfirm>
                ) : null}
                {["EXPIRED", "REVOKED"].includes(row.status) ? (
                  <Popconfirm
                    title={t("confirm.deleteToken")}
                    onConfirm={async () => {
                      await apiFetch(`/api/admin/registration-tokens/${row.id}`, { method: "DELETE" });
                      message.success(t("registration.deleted"));
                      if (created?.id === row.id) setCreated(null);
                      void reload();
                    }}
                  >
                    <Button danger>{t("action.delete")}</Button>
                  </Popconfirm>
                ) : null}
              </Space>
            ),
          },
        ] as ColumnsType<RegistrationToken>}
      />
    </Card>
  );
}
