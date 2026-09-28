import { Languages } from "lucide-react";
import { LANGS, setLang, useLang, type Lang } from "../lib/i18n";

export default function LangToggle() {
  const lang = useLang();

  function cycle() {
    const next: Lang = lang === "en" ? "es" : "en";
    setLang(next);
  }

  return (
    <button
      onClick={cycle}
      aria-label={lang === "en" ? "Cambiar a español" : "Switch to English"}
      title={lang === "en" ? "Cambiar a español" : "Switch to English"}
      className="grid size-8 place-items-center rounded-md font-mono text-[11px] font-semibold text-subtext0 transition-colors hover:bg-surface0 hover:text-text"
    >
      <span className="inline-flex items-center gap-1">
        <Languages size={14} />
        {LANGS.indexOf(lang) === 0 ? "EN" : "ES"}
      </span>
    </button>
  );
}
