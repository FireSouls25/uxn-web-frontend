import { Languages } from "lucide-react";
import MenuSelect from "./MenuSelect";
import { LANGS, setLang, t, useLang, type Lang } from "../lib/i18n";

/* Auto-detect default (stored → navigator → English); explicit
   override persists. */
export default function LangSelect() {
  const lang = useLang();

  return (
    <MenuSelect
      value={lang}
      label={t(lang, "lang.label")}
      icon={<Languages size={14} />}
      onChange={(v) => setLang(v as Lang)}
      options={LANGS.map((l) => ({
        value: l,
        label: t(lang, l === "en" ? "lang.en" : "lang.es"),
      }))}
    />
  );
}
