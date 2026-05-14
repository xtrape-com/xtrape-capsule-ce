import { Alert, Button, Card, Collapse, Descriptions, Drawer, Input, Modal, Space, Spin, Table, Tag, Typography, message } from "antd";
import React from "react";
import { ApiError, apiFetch } from "../../api.js";
import { JsonBlock, StatusTag } from "../../components.js";
import { useI18n } from "../../i18n.js";
import type { Action, ActionPrepare, Command, ResultDetailMeta, Service } from "../../lib/types.js";
import { ActionDetailCard, ActionResultDetail, ActionResultList } from "./ActionResult.js";
import { SchemaPayloadFields } from "./SchemaPayloadFields.js";
import {
  accountStatusesFromHealth,
  actionCategoryLabel,
  defaultPayloadForAction,
  generatedKeyFromCommand,
  groupActions,
  isLongRunningAction,
  isTerminalCommandStatus,
  resultDetailFromValue,
  waitForCommandResult,
} from "./helpers.js";

/**
 * Right-hand drawer rendered when the operator selects a service row.
 * Owns the action-execute lifecycle: opening an action modal,
 * preparing initial payload via `/actions/:name` GET, submitting via
 * POST, then either polling (long-running) or awaiting terminal status
 * (short-running). Renders prepared/result detail + list payloads
 * through the action-result components.
 */
export function ServiceDrawer({
  service,
  refreshing,
  onClose,
  onRefresh,
  onCommandCreated,
}: {
  service: Service | null;
  refreshing?: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onCommandCreated: () => void;
}) {
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
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commandResult?.id, commandResult?.status, autoPollCommandId, refreshAfterCommandId]);

  async function executeNamedAction(
    actionName: string,
    nextPayload: Record<string, unknown>,
    confirmation?: boolean,
    options: { silent?: boolean } = {},
  ): Promise<Command | undefined> {
    if (!service) return;
    const targetAction = service.actions?.find((item) => item.name === actionName);
    setCommandRunning(true);
    try {
      const created = await apiFetch<Command>(`/api/admin/capsule-services/${service.id}/actions/${actionName}`, {
        method: "POST",
        body: JSON.stringify({ payload: nextPayload, confirmation: confirmation === true }),
      });
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
    try {
      parsed = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return;
    }
    await executeNamedAction(action.name, parsed, false, { silent: true });
  }

  const submitAction = async () => {
    if (!service || !action) return;
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      message.error(t("service.invalidPayload"));
      return;
    }
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
      const error =
        err instanceof ApiError
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

  return (
    <Drawer
      open={!!service}
      onClose={onClose}
      title={service?.name}
      width={860}
      extra={
        <Button disabled={!service} loading={refreshing} onClick={onRefresh}>
          {t("action.refresh")}
        </Button>
      }
    >
      {service && (
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
          <Descriptions
            bordered
            column={2}
            items={["code", "version", "runtime", "status", "healthStatus", "lastReportedAt", "lastHealthAt"].map((key) => ({
              key,
              label: key,
              children: key.toLowerCase().includes("status") ? (
                <StatusTag value={String((service as unknown as Record<string, unknown>)[key] ?? "")} />
              ) : (
                String((service as unknown as Record<string, unknown>)[key] ?? "-")
              ),
            }))}
          />
          <Card type="inner" title={t("common.actions")}>
            <Space direction="vertical" size="middle" style={{ width: "100%" }}>
              {groupActions(service.actions).map((group) => (
                <div key={group.category}>
                  <Typography.Text strong>{actionCategoryLabel(group.category, t)}</Typography.Text>
                  <div style={{ marginTop: 8 }}>
                    <Space wrap>
                      {group.actions.map((a) => (
                        <Button
                          key={a.id}
                          loading={prepareLoading && action?.id === a.id}
                          danger={a.dangerLevel !== "LOW" || a.requiresConfirmation}
                          onClick={() => void openAction(a)}
                        >
                          {a.label}
                        </Button>
                      ))}
                    </Space>
                  </div>
                </div>
              ))}
            </Space>
          </Card>
          <Card type="inner" title={t("common.configs")}>
            <Table
              rowKey="id"
              pagination={false}
              dataSource={service.configs ?? []}
              columns={[
                { title: t("common.key"), dataIndex: "configKey" },
                { title: t("common.type"), dataIndex: "type" },
                { title: t("common.sensitive"), dataIndex: "sensitive", render: (v) => (v ? <Tag color="red">{t("common.yes")}</Tag> : <Tag>{t("common.no")}</Tag>) },
                { title: t("common.preview"), dataIndex: "valuePreview" },
                { title: t("common.secretRef"), dataIndex: "secretRef" },
              ]}
            />
          </Card>
          {accountStatusesFromHealth(service.health).length > 0 && (
            <Card type="inner" title={t("service.accountStatus")}>
              <Table
                rowKey={(row) => row.id ?? row.label ?? Math.random().toString(36)}
                pagination={false}
                dataSource={accountStatusesFromHealth(service.health)}
                columns={[
                  { title: t("common.id"), dataIndex: "label", render: (_v, row) => row.label ?? row.id ?? "-" },
                  { title: t("common.status"), dataIndex: "healthy", render: (v) => <StatusTag value={v ? "HEALTHY" : "UNHEALTHY"} /> },
                  { title: t("service.operationStatus"), dataIndex: "operationStatus", render: (v) => <StatusTag value={String(v ?? "IDLE")} /> },
                  { title: t("common.message"), dataIndex: "operationMessage", render: (_v, row) => row.operationMessage ?? row.lastError ?? "-" },
                  { title: t("service.failures"), dataIndex: "consecutiveFailures" },
                  { title: t("service.cooldownMs"), dataIndex: "cooldownRemainingMs" },
                ]}
              />
            </Card>
          )}
          <Card type="inner" title={t("common.health")}>
            <JsonBlock value={service.health ?? {}} />
          </Card>
          <Card type="inner" title={t("common.manifest")}>
            <JsonBlock value={service.manifest ?? {}} />
          </Card>
        </Space>
      )}
      <Modal
        open={!!action}
        width={920}
        title={t("service.executeAction", { label: action?.label ?? "" })}
        onCancel={() => {
          prepareRequestSeq.current += 1;
          setAction(null);
          setPrepareError(null);
          setPrepareStartedAt(null);
        }}
        onOk={() => void submitAction()}
        okText={action?.requiresConfirmation ? t("action.confirmRun") : t("action.run")}
        confirmLoading={commandRunning || prepareLoading}
        okButtonProps={{ danger: action?.requiresConfirmation, disabled: prepareLoading || Boolean(prepareError) }}
      >
        <Spin spinning={prepareLoading} tip={t("service.actionPreparing")}>
          {prepareLoading && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message={t("service.actionPreparing")}
              description={t("service.actionPreparingDetail", {
                elapsed: Math.floor(prepareElapsedMs / 1000),
                status: service?.status ?? "-",
              })}
            />
          )}
          {prepareError && (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 12 }}
              message={t("service.actionPrepareFailed")}
              description={
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Typography.Text>{`${prepareError.message}${prepareError.code ? ` (${prepareError.code})` : ""}`}</Typography.Text>
                  {prepareError.details && <JsonBlock value={prepareError.details} />}
                </Space>
              }
              action={
                <Button size="small" onClick={() => action && void openAction(action)}>
                  {t("action.retry")}
                </Button>
              }
            />
          )}
          <Typography.Paragraph>{action?.description}</Typography.Paragraph>
          {action?.requiresConfirmation && <Typography.Paragraph type="danger">{t("service.actionRequiresConfirmation")}</Typography.Paragraph>}
          <Typography.Text type="secondary">{t("service.autoPayloadHelp")}</Typography.Text>
          {action && !prepareLoading && <SchemaPayloadFields action={action} initialPayload={initialPayload} setPayload={setPayload} />}
          <Collapse
            size="small"
            style={{ marginTop: 16 }}
            items={[
              {
                key: "requestJson",
                label: t("service.requestJson"),
                forceRender: true,
                children: (
                  <Input.TextArea
                    disabled={prepareLoading}
                    value={payload}
                    onChange={(e) => setPayload(e.target.value)}
                    autoSize={{ minRows: 3, maxRows: 12 }}
                  />
                ),
              },
            ]}
          />
          {commandResult && (
            <Card
              size="small"
              title={
                <Space>
                  {`${t("command.title")} ${commandResult.id}`}
                  <StatusTag value={commandResult.status} />
                </Space>
              }
              style={{ marginTop: 16 }}
            >
              <Collapse
                size="small"
                items={[
                  {
                    key: "commandDetails",
                    label: t("service.commandDetails"),
                    children: (
                      <Descriptions
                        size="small"
                        bordered
                        column={1}
                        items={[
                          { key: "status", label: t("common.status"), children: <StatusTag value={commandResult.status} /> },
                          { key: "createdAt", label: t("command.createdAt"), children: commandResult.createdAt },
                          { key: "completedAt", label: t("command.completedAt"), children: commandResult.completedAt ?? "-" },
                        ]}
                      />
                    ),
                  },
                ]}
              />
              {generatedKeyFromCommand(commandResult) && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginTop: 12, marginBottom: 12 }}
                  message={t("service.generatedKeyTitle")}
                  description={
                    <Space direction="vertical" style={{ width: "100%" }}>
                      <Typography.Text>{t("service.generatedKeyHelp")}</Typography.Text>
                      <Typography.Text code copyable={{ text: generatedKeyFromCommand(commandResult)! }}>
                        {generatedKeyFromCommand(commandResult)}
                      </Typography.Text>
                    </Space>
                  }
                />
              )}
              <ActionResultDetail command={commandResult} service={service} onOpenAction={openContextAction} />
              <ActionResultList command={commandResult} service={service} onOpenAction={openContextAction} />
              <Collapse
                size="small"
                style={{ marginTop: 16 }}
                items={[
                  {
                    key: "resultJson",
                    label: t("service.resultJson"),
                    children: <JsonBlock value={commandResult.result ?? { errorCode: commandResult.errorCode, errorMessage: commandResult.errorMessage }} />,
                  },
                ]}
              />
            </Card>
          )}
          {!commandResult && preparedDetail && <ActionDetailCard detail={preparedDetail} service={service} onOpenAction={openContextAction} />}
        </Spin>
      </Modal>
    </Drawer>
  );
}
