import { Select } from "antd";
import { useI18n, type Language } from "../i18n.js";

/**
 * Top-level language switcher widget. Persists the choice to
 * localStorage under `opstage.language` (handled inside useI18n).
 *
 * Kept separate from LoginPage / Shell so both can render the same
 * picker without duplicating the option list.
 */
export function LanguageSwitcher() {
  const { language, setLanguage, t } = useI18n();
  return (
    <Select<Language>
      aria-label={t("language.label")}
      value={language}
      onChange={setLanguage}
      style={{ width: 132 }}
      options={[
        { value: "zh-CN", label: t("language.zhCN") },
        { value: "en-US", label: t("language.enUS") },
      ]}
    />
  );
}
