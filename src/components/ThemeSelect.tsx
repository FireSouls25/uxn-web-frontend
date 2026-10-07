import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import MenuSelect from "./MenuSelect";
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

/* Auto (OS-detect) default, explicit Dark/Light override. The page
   boots into the browser's preferred scheme when no choice is
   stored (see the pre-paint script in Base.astro). */
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

  return (
    <MenuSelect
      value={choice}
      label={t(lang, "theme.label")}
      onChange={(v) => {
        const next = v as ThemeChoice;
        applyTheme(next);
        setChoice(next);
      }}
      options={[
        { value: "auto", label: t(lang, "theme.auto"), icon: <Monitor size={14} /> },
        { value: "mocha", label: t(lang, "theme.mocha"), icon: <Moon size={14} /> },
        { value: "latte", label: t(lang, "theme.latte"), icon: <Sun size={14} /> },
      ]}
    />
  );
}
