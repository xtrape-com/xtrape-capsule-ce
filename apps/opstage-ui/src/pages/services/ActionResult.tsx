import { Button, Card, Descriptions, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import React from "react";
import { useI18n } from "../../i18n.js";
import type {
  Command,
  ResultDetailField,
  ResultDetailMeta,
  ResultListRowAction,
  Service,
} from "../../lib/types.js";
import {
  getPathValue,
  inferListColumns,
  renderListCell,
  resolveRowPayload,
  resultDetailFromCommand,
  resultListFromCommand,
  resultRowKey,
} from "./helpers.js";

/**
 * One-shot action button rendered inside an action-result list/detail.
 * Calls `onOpenAction` with a payload derived from `rowAction.payload`
 * (a template that may reference `$row.path` strings). While any sibling
 * button on the same row is running, others on that row are disabled
 * to avoid double-submits.
 */
export function ResultActionButton({
  rowAction,
  row,
  rowKey,
  service,
  onOpenAction,
}: {
  rowAction: ResultListRowAction;
  row: Record<string, unknown>;
  rowKey: string;
  service: Service | null;
  onOpenAction: (actionName: string, payload: Record<string, unknown>) => Promise<void>;
}) {
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
  return (
    <Button
      key={actionKey}
      size="small"
      loading={isRunning}
      danger={rowAction.danger || targetAction?.requiresConfirmation}
      disabled={!targetAction || (sameRowRunning && !isRunning)}
      onClick={() => void run()}
    >
      {rowAction.label}
    </Button>
  );
}

/**
 * Render a Capsule action's `result.data.list` payload as a typed antd
 * Table. Returns `null` when the command did not produce a list-shaped
 * result.
 */
export function ActionResultList({
  command,
  service,
  onOpenAction,
}: {
  command: Command | null;
  service: Service | null;
  onOpenAction: (actionName: string, payload: Record<string, unknown>) => Promise<void>;
}) {
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
      render: (_value, row, index) => (
        <Space wrap>
          {list.rowActions!.map((rowAction) => (
            <ResultActionButton
              key={`${resultRowKey(row, index)}:${rowAction.action}:${rowAction.label}`}
              rowAction={rowAction}
              row={row}
              rowKey={resultRowKey(row, index)}
              service={service}
              onOpenAction={onOpenAction}
            />
          ))}
        </Space>
      ),
    });
  }
  const pageSize = Number.isFinite(Number(list.pageSize)) && Number(list.pageSize) > 0 ? Number(list.pageSize) : 10;
  return (
    <Card
      size="small"
      title={
        <Space>
          {list.title ?? "List"}
          <Tag>{t("service.listRowCount", { count: rows.length })}</Tag>
        </Space>
      }
      extra={
        list.pageActions?.length ? (
          <Space wrap>
            {list.pageActions.map((pageAction) => (
              <ResultActionButton
                key={`page:${pageAction.action}:${pageAction.label}`}
                rowAction={pageAction}
                row={{}}
                rowKey="page"
                service={service}
                onOpenAction={onOpenAction}
              />
            ))}
          </Space>
        ) : null
      }
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
    </Card>
  );
}

/**
 * Pull a `result.data.detail` payload off a command and render it
 * through `ActionDetailCard`. Returns `null` when no such detail is
 * present.
 */
export function ActionResultDetail({
  command,
  service,
  onOpenAction,
}: {
  command: Command | null;
  service: Service | null;
  onOpenAction: (actionName: string, payload: Record<string, unknown>) => Promise<void>;
}) {
  const detail = resultDetailFromCommand(command);
  if (!detail) return null;
  return <ActionDetailCard detail={detail} service={service} onOpenAction={onOpenAction} />;
}

/**
 * Renders a `ResultDetailMeta` as a Descriptions card. Also used as the
 * "prepared detail" preview rendered before any command is executed,
 * so it is exported separately from `ActionResultDetail`.
 */
export function ActionDetailCard({
  detail,
  service,
  onOpenAction,
}: {
  detail: ResultDetailMeta;
  service: Service | null;
  onOpenAction: (actionName: string, payload: Record<string, unknown>) => Promise<void>;
}) {
  const data = detail.data ?? {};
  const fields: ResultDetailField[] = detail.fields?.length
    ? detail.fields
    : Object.keys(data).slice(0, 12).map((key) => ({ key, label: key }));
  return (
    <Card
      size="small"
      title={detail.title ?? "Detail"}
      extra={
        detail.actions?.length ? (
          <Space wrap>
            {detail.actions.map((action) => (
              <ResultActionButton
                key={`detail:${action.action}:${action.label}`}
                rowAction={action}
                row={data}
                rowKey={String(data.id ?? "detail")}
                service={service}
                onOpenAction={onOpenAction}
              />
            ))}
          </Space>
        ) : null
      }
      style={{ marginTop: 16 }}
    >
      <Descriptions
        bordered
        size="small"
        column={1}
        items={fields.map((field) => ({
          key: field.key,
          label: field.label ?? field.key,
          children: renderListCell(getPathValue(data, field.key), {
            key: field.key,
            format: field.format,
            copyable: field.copyable,
          }),
        }))}
      />
    </Card>
  );
}
