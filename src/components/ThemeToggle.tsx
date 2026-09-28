import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export type Theme = "mocha" | "latte";

export function currentTheme(): Theme {
  if (typeof document === "undefined") return "mocha";
  return (document.documentElement.dataset.theme as Theme) || "mocha";
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("mocha");

  useEffect(() => {
    setTheme(currentTheme());
  }, []);

  function flip() {
    const next: Theme = theme === "mocha" ? "latte" : "mocha";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("uxn.theme", next);
    } catch {
      /* private mode — theme just won't persist */
    }
    setTheme(next);
  }

  return (
    <button
      onClick={flip}
      aria-label={theme === "mocha" ? "Switch to light mode" : "Switch to dark mode"}
      className="grid size-8 place-items-center rounded-md text-subtext0 transition-colors hover:bg-surface0 hover:text-text"
    >
      {theme === "mocha" ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
