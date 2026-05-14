import { Button, Card, Form, Input, Layout, message } from "antd";
import React from "react";
import { useNavigate } from "react-router-dom";
import { login, type SessionData } from "../api.js";
import { useI18n } from "../i18n.js";
import { LanguageSwitcher } from "./LanguageSwitcher.js";

/**
 * Standalone login screen. Renders when the App-level effect that probes
 * `/api/admin/auth/me` returns 401 (no session) at boot.
 */
export function LoginPage({ onLogin }: { onLogin: (session: SessionData) => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = React.useState(false);
  return (
    <Layout style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
      <Card title={t("login.title")} style={{ width: 420 }} extra={<LanguageSwitcher />}>
        <Form
          layout="vertical"
          initialValues={{ username: "admin" }}
          onFinish={async (values) => {
            setSubmitting(true);
            try {
              const session = await login(values.username, values.password);
              onLogin(session);
              message.success(t("login.success"));
              navigate("/");
            } catch (err) {
              message.error(err instanceof Error ? err.message : t("login.failed"));
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <Form.Item name="username" label={t("login.username")} rules={[{ required: true }]}>
            <Input autoFocus />
          </Form.Item>
          <Form.Item name="password" label={t("login.password")} rules={[{ required: true }]}>
            <Input.Password />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={submitting} block>
            {t("action.login")}
          </Button>
        </Form>
      </Card>
    </Layout>
  );
}
