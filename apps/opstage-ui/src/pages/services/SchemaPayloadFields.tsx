import { Form, Input, InputNumber, Select, Switch } from "antd";
import React from "react";
import { useI18n } from "../../i18n.js";
import type { Action } from "../../lib/types.js";
import { defaultPayloadForAction, getSchemaProperties } from "./helpers.js";

/**
 * Renders an action's `inputSchema` as a typed antd form. Each property
 * becomes a `Form.Item` whose control matches the declared `type`:
 *
 *   - enum     → Select
 *   - boolean  → Switch
 *   - number / integer → InputNumber
 *   - string with format=password OR name containing "password" → Input.Password
 *   - string with format=textarea → Input.TextArea
 *   - otherwise → Input
 *
 * The parent owns the serialized JSON payload string; this component
 * keeps both views in sync by calling `setPayload` on every change.
 * Returns `null` when the schema has no `properties` (the operator
 * just edits the JSON pane directly in that case).
 */
export function SchemaPayloadFields({
  action,
  initialPayload,
  setPayload,
}: {
  action: Action;
  initialPayload?: Record<string, unknown>;
  setPayload: (payload: string) => void;
}) {
  const { t } = useI18n();
  const [form] = Form.useForm<Record<string, string | number | boolean | undefined>>();
  const properties = getSchemaProperties(action);
  const required = Array.isArray(action.inputSchema?.required) ? (action.inputSchema.required as string[]) : [];
  React.useEffect(() => {
    const defaults = initialPayload ?? defaultPayloadForAction(action);
    form.setFieldsValue(defaults as Record<string, string | number | boolean | undefined>);
    setPayload(JSON.stringify(defaults, null, 2));
  }, [action, form, initialPayload, setPayload]);
  if (Object.keys(properties).length === 0) return null;
  return (
    <Form
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
        const extra = t("service.payloadFieldMeta", {
          name,
          type: typeLabel,
          required: required.includes(name) ? t("form.required") : t("form.optional"),
        });
        const rules = required.includes(name) ? [{ required: true, message: `${label} ${t("form.required")}` }] : undefined;
        if (property.enum) {
          return (
            <Form.Item key={name} name={name} label={label} tooltip={property.description} rules={rules} extra={extra}>
              <Select options={property.enum.map((value, index) => ({ value: String(value), label: property.enumLabels?.[index] ?? String(value) }))} />
            </Form.Item>
          );
        }
        if (property.type === "boolean") {
          return (
            <Form.Item key={name} name={name} label={label} tooltip={property.description} valuePropName="checked" rules={rules} extra={extra}>
              <Switch />
            </Form.Item>
          );
        }
        if (property.type === "number" || property.type === "integer") {
          return (
            <Form.Item key={name} name={name} label={label} tooltip={property.description} rules={rules} extra={extra}>
              <InputNumber style={{ width: "100%" }} />
            </Form.Item>
          );
        }
        return (
          <Form.Item key={name} name={name} label={label} tooltip={property.description} rules={rules} extra={extra}>
            {property.format === "textarea" ? (
              <Input.TextArea
                placeholder={property.placeholder ?? String(property.default ?? "")}
                maxLength={property.maxLength}
                readOnly={property.readOnly}
                autoSize={{ minRows: 3, maxRows: 8 }}
              />
            ) : property.format === "password" || name.toLowerCase().includes("password") ? (
              <Input.Password
                placeholder={property.placeholder ?? String(property.default ?? "")}
                maxLength={property.maxLength ?? 4096}
                readOnly={property.readOnly}
              />
            ) : (
              <Input
                placeholder={property.placeholder ?? String(property.default ?? "")}
                maxLength={property.maxLength}
                readOnly={property.readOnly}
              />
            )}
          </Form.Item>
        );
      })}
    </Form>
  );
}
