import { Languages } from "lucide-react";
import { LANGS, setLang, t, useLang, type Lang } from "../lib/i18n";

/* Auto-detect default (stored → navigator → English); explicit
   override persists. */
export default function LangSelect() {
  const lang = useLang();

  return (
    <label
      className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-subtext0 transition-colors hover:bg-surface0 hover:text-text"
      title={t(lang, "lang.label")}
    >
      <Languages size={15} />
      <select
        aria-label={t(lang, "lang.label")}
        value={lang}
        onChange={(e) => setLang(e.target.value as Lang)}
        className="cursor-pointer bg-transparent font-mono text-[11px] outline-none"
      >
        {LANGS.map((l) => (
          <option key={l} value={l}>
            {l === "en" ? "English" : "Español"}
          </option>
        ))}
      </select>
    </label>
  );
}
