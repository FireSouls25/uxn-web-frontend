import { useEffect, useState } from "react";
import { TriangleAlert, X } from "lucide-react";
import { t, useLang } from "../lib/i18n";
import { getSession } from "../lib/session";

/* Guest warning: logged-out work is memory-only and dies with the tab. */
export default function SessionBanner() {
  const lang = useLang();
  const [guest, setGuest] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setGuest(getSession() === null);
    try {
      setDismissed(sessionStorage.getItem("uxn.banner-dismissed") === "1");
    } catch {
      /* ignore */
    }
  }, []);

  function dismiss() {
    setDismissed(true);
    try {
      sessionStorage.setItem("uxn.banner-dismissed", "1");
    } catch {
      /* ignore */
    }
  }

  if (!guest || dismissed) return null;

  return (
    <div className="pane flex flex-wrap items-center gap-3 rounded-xl border-yellow/30 bg-yellow/5 px-4 py-2.5">
      <TriangleAlert size={15} className="shrink-0 text-yellow" />
      <p className="text-[13px]">
        <span className="font-semibold text-yellow">{t(lang, "guest.title")}</span>
        <span className="text-subtext0"> — {t(lang, "guest.body")}</span>
      </p>
      <a
        href="/login"
        className="rounded-lg bg-yellow/15 px-3 py-1.5 text-[13px] font-medium text-yellow transition-colors hover:bg-yellow/25"
      >
        {t(lang, "guest.login")}
      </a>
      <button
        onClick={dismiss}
        aria-label={t(lang, "misc.dismiss")}
        className="grid size-7 place-items-center rounded-md text-subtext0 transition-colors hover:bg-surface0 hover:text-text"
      >
        <X size={14} />
      </button>
    </div>
  );
}
