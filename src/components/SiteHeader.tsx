import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Box, Menu, X } from "lucide-react";
import ThemeSelect from "./ThemeSelect";
import LangSelect from "./LangSelect";
import { t, useLang } from "../lib/i18n";
import { apiLogout, apiMe } from "../lib/auth";
import { clearSession, getSession, type Session } from "../lib/session";

export default function SiteHeader() {
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const [session, setSessionState] = useState<Session | null>(null);

  useEffect(() => {
    const s = getSession();
    if (!s) return;
    // Best-effort validation: a dead token clears quietly.
    apiMe(s.access)
      .then(() => setSessionState(s))
      .catch(() => clearSession());
  }, []);

  function logout() {
    const s = getSession();
    if (s) void apiLogout(s.refresh);
    clearSession();
    setSessionState(null);
  }

  const LINKS = [
    { href: "/projects", label: t(lang, "nav.projects") },
    { href: "/studio", label: t(lang, "nav.studio") },
    { href: "/#targets", label: t(lang, "nav.targets") },
    { href: "/#features", label: t(lang, "nav.features") },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-surface0 bg-mantle/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
        <a href="/" className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-md bg-mauve text-crust">
            <Box size={17} strokeWidth={2.4} />
          </span>
          <span className="font-mono text-sm font-semibold tracking-tight">
            uxn<span className="text-mauve">·</span>forge
          </span>
        </a>

        <nav className="ml-6 hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <a
              key={l.href + l.label}
              href={l.href}
              className="rounded-md px-3 py-1.5 text-[13px] text-subtext0 transition-colors hover:bg-surface0 hover:text-text"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-1.5 md:flex">
          <LangSelect />
          <ThemeSelect />
          {session ? (
            <>
              <a
                href="/studio"
                className="rounded-md bg-surface0 px-3 py-1.5 font-mono text-xs text-text"
              >
                {session.name}
              </a>
              <button
                onClick={logout}
                className="rounded-md px-3 py-1.5 text-[13px] text-subtext0 transition-colors hover:bg-surface0 hover:text-text"
              >
                {t(lang, "nav.logout")}
              </button>
            </>
          ) : (
            <>
              <a
                href="/login"
                className="rounded-md px-3 py-1.5 text-[13px] text-subtext0 transition-colors hover:bg-surface0 hover:text-text"
              >
                {t(lang, "nav.login")}
              </a>
              <motion.a
                href="/register"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className="rounded-md bg-mauve px-3.5 py-1.5 text-[13px] font-semibold text-crust"
              >
                {t(lang, "nav.signup")}
              </motion.a>
            </>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1 md:hidden">
          <LangSelect />
          <ThemeSelect />
          <button
            onClick={() => setOpen((v) => !v)}
            aria-label={t(lang, "nav.menu")}
            className="grid size-8 place-items-center rounded-md text-subtext0 hover:bg-surface0 hover:text-text"
          >
            {open ? <X size={17} /> : <Menu size={17} />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.nav
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t border-surface0 md:hidden"
          >
            <div className="flex flex-col gap-1 px-4 py-3">
              {LINKS.map((l) => (
                <a
                  key={l.href + l.label}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-2 text-sm text-subtext0 hover:bg-surface0 hover:text-text"
                >
                  {l.label}
                </a>
              ))}
              {session ? (
                <button
                  onClick={() => {
                    logout();
                    setOpen(false);
                  }}
                  className="rounded-md px-3 py-2 text-left text-sm text-subtext0 hover:bg-surface0 hover:text-text"
                >
                  {t(lang, "nav.logout")} ({session.name})
                </button>
              ) : (
                <>
                  <a
                    href="/login"
                    onClick={() => setOpen(false)}
                    className="rounded-md px-3 py-2 text-sm text-subtext0 hover:bg-surface0 hover:text-text"
                  >
                    {t(lang, "nav.login")}
                  </a>
                  <a
                    href="/register"
                    onClick={() => setOpen(false)}
                    className="rounded-md bg-mauve px-3 py-2 text-sm font-semibold text-crust"
                  >
                    {t(lang, "nav.signup")}
                  </a>
                </>
              )}
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
