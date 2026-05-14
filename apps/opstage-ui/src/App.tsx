import { App as AntApp, Badge, Button, Layout, Menu, Space, Tag, Typography } from "antd";
import React from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ApiError, logout, me, type SessionData } from "./api.js";
import { useI18n } from "./i18n.js";
import { AgentsPage } from "./pages/AgentsPage.js";
import { AuditEventsPage } from "./pages/AuditEventsPage.js";
import { CommandsPage } from "./pages/CommandsPage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { LanguageSwitcher } from "./pages/LanguageSwitcher.js";
import { LoginPage } from "./pages/LoginPage.js";
import { RegistrationTokensPage } from "./pages/RegistrationTokensPage.js";
import { ServicesPage } from "./pages/services/ServicesPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { UsersPage } from "./pages/UsersPage.js";

// Re-exports preserved so existing tests / external callers that
// imported these helpers from "./App.js" keep working. They now live
// under ./lib/ and ./pages/services/.
export { formatBytes, formatDurationMs } from "./lib/format.js";
export { diagnosticRows, hasMetricWarning, metricRows } from "./lib/metrics.js";
export { formatRelativeTime, renderListCell, resolveRowPayload, resultRowKey } from "./pages/services/helpers.js";

/**
 * Top-level chrome rendered once an authenticated session exists.
 * Owns the sidebar Menu, header badge/role tag, language switcher,
 * logout button, and the route table that mounts each page component.
 */
function Shell({ session, onLogout }: { session: SessionData; onLogout: () => void }) {
  const { t } = useI18n();
  const location = useLocation();
  const menuEntries: Array<[string, string]> = [
    ["/", t("menu.dashboard")],
    ["/users", t("menu.users")],
    ["/registration-tokens", t("menu.registrationTokens")],
    ["/agents", t("menu.agents")],
    ["/services", t("menu.services")],
    ["/commands", t("menu.commands")],
    ["/audit-events", t("menu.auditEvents")],
    ["/settings", t("menu.settings")],
  ];
  const menuItems = menuEntries.map(([key, label]) => ({ key, label: <Link to={key}>{label}</Link> }));
  const selected = menuItems.find((item) => item.key !== "/" && location.pathname.startsWith(item.key))?.key ?? "/";
  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Layout.Sider width={240}>
        <Typography.Title level={4} style={{ color: "white", padding: 16, margin: 0 }}>
          Opstage CE
        </Typography.Title>
        <Menu theme="dark" mode="inline" selectedKeys={[selected]} items={menuItems} />
      </Layout.Sider>
      <Layout>
        <Layout.Header
          style={{ background: "white", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 24px" }}
        >
          <Space>
            <Badge status="processing" />
            <span>{session.user.displayName ?? session.user.username}</span>
            <Tag>{session.user.role}</Tag>
          </Space>
          <Space>
            <LanguageSwitcher />
            <Button
              onClick={async () => {
                await logout();
                onLogout();
              }}
            >
              {t("action.logout")}
            </Button>
          </Space>
        </Layout.Header>
        <Layout.Content style={{ padding: 24 }}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/registration-tokens" element={<RegistrationTokensPage />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/services" element={<ServicesPage />} />
            <Route path="/commands" element={<CommandsPage />} />
            <Route path="/audit-events" element={<AuditEventsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </Layout.Content>
      </Layout>
    </Layout>
  );
}

/**
 * Root component. Probes `/api/admin/auth/me` at boot to detect an
 * existing session; renders the login route tree until one exists.
 */
export function App() {
  const { t } = useI18n();
  const [session, setSession] = React.useState<SessionData | null>(null);
  const [booting, setBooting] = React.useState(true);
  React.useEffect(() => {
    me()
      .then(setSession)
      .catch((err) => {
        if (!(err instanceof ApiError && err.status === 401)) console.warn(err);
      })
      .finally(() => setBooting(false));
  }, []);
  if (booting)
    return (
      <Layout style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <Typography.Text>{t("app.loading")}</Typography.Text>
      </Layout>
    );
  return (
    <AntApp>
      {session ? (
        <Shell session={session} onLogout={() => setSession(null)} />
      ) : (
        <Routes>
          <Route path="/login" element={<LoginPage onLogin={setSession} />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      )}
    </AntApp>
  );
}
