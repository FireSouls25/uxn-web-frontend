import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { t, useLang } from "../lib/i18n";

export type ThemeChoice = "auto" | "mocha" | "latte";
const KEY = "uxn.theme";

export function effectiveTheme(choice: ThemeChoice): "mocha" | "latte" {
  if (choice === "mocha" || choice === "latte") return choice;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "latte" : "mocha";
}

export function applyTheme(choice: ThemeChoice): void {
  document.documentElement.dataset.theme = effectiveTheme(choice);
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    /* private mode */
  }
}

export function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "mocha" || v === "latte" || v === "auto") return v;
  } catch {
    /* ignore */
  }
  return "auto";
}

const ICONS = { auto: Monitor, mocha: Moon, latte: Sun } as const;

/* System (auto-detect) default, explicit Mocha/Latte override. */
export default function ThemeSelect() {
  const lang = useLang();
  const [choice, setChoice] = useState<ThemeChoice>("auto");

  useEffect(() => {
    setChoice(readChoice());
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      if (readChoice() === "auto") applyTheme("auto");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const Icon = ICONS[choice];

  return (
    <label
      className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-subtext0 transition-colors hover:bg-surface0 hover:text-text"
      title={t(lang, "theme.label")}
    >
      <Icon size={15} />
      <select
        aria-label={t(lang, "theme.label")}
        value={choice}
        onChange={(e) => {
          const next = e.target.value as ThemeChoice;
          applyTheme(next);
          setChoice(next);
        }}
        className="cursor-pointer bg-transparent font-mono text-[11px] outline-none"
      >
        <option value="auto">{t(lang, "theme.system")}</option>
        <option value="mocha">{t(lang, "theme.mocha")}</option>
        <option value="latte">{t(lang, "theme.latte")}</option>
      </select>
    </label>
  );
}
