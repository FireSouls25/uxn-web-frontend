import { useEffect } from "react";
import { useStore } from "@nanostores/react";
import { X } from "lucide-react";
import { t, useLang } from "../lib/i18n";
import { closePlaytest, playtestStore } from "../lib/store";

/* Fullscreen playtest: the compiled web bundle running in an iframe
   (same bytes as the download). X or Esc closes and revokes the blob
   URL so repeated runs never leak object URLs. */
export default function PlaytestOverlay() {
  const lang = useLang();
  const url = useStore(playtestStore);

  useEffect(() => {
    if (!url) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePlaytest();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [url]);

  if (!url) return null;

  return (
    <div className="bg-scrim-strong fixed inset-0 z-50 flex flex-col p-3 sm:p-6">
      <div className="mx-auto flex w-full max-w-5xl items-center gap-3 pb-3">
        <p className="font-mono text-[11px] uppercase tracking-widest text-subtext0">
          {t(lang, "play.title")}
        </p>
        <button
          onClick={closePlaytest}
          title={t(lang, "hdr.close")}
          aria-label={t(lang, "hdr.close")}
          className="ml-auto grid size-9 place-items-center rounded-lg bg-surface0 text-text transition-colors hover:bg-surface1"
        >
          <X size={16} />
        </button>
      </div>
      <div className="mx-auto flex w-full max-w-5xl min-h-0 flex-1 flex-col">
        <iframe
          src={url}
          title={t(lang, "play.title")}
          className="min-h-0 w-full flex-1 rounded-lg border border-surface0 bg-code"
        />
        <p className="mt-2 text-center font-mono text-[10px] text-overlay0">{t(lang, "exp.play_hint")}</p>
      </div>
    </div>
  );
}
