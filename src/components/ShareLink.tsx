import { useState } from "react";
import { Check, Copy, ExternalLink, Link2, Loader2 } from "lucide-react";
import { t, useLang } from "../lib/i18n";
import { shareProject } from "../lib/export";
import { diagnosticsStore, projectStore } from "../lib/store";

/* "Share a play link": compiles the web page (reusing the cached build
   when nothing changed) and publishes it as a temporary public page on
   the backend. Shows the link with Copy / Open and when it expires. */
export default function ShareLink({ compact = false }: { compact?: boolean }) {
  const lang = useLang();
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [until, setUntil] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const r = await shareProject(projectStore.get(), lang);
      diagnosticsStore.set(r.diagnostics ?? []);
      if (!r.ok || !r.url) {
        setError(r.message);
        return;
      }
      setUrl(r.url);
      setUntil(r.expiresAt ? new Date(r.expiresAt).toLocaleDateString(lang) : null);
      await copy(r.url);
    } finally {
      setBusy(false);
    }
  }

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked: the field is selectable */
    }
  }

  const btn =
    "inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-60";

  return (
    <div className={compact ? "flex w-full items-center justify-end gap-1" : "space-y-1.5"}>
      {!compact && (
        <div className="px-1">
          <p className="text-[12px] font-semibold text-text">{t(lang, "share.title")}</p>
          <p className="text-[11px] leading-snug text-subtext0">{t(lang, "share.hint")}</p>
        </div>
      )}
      {url && (
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            aria-label={t(lang, "share.title")}
            className="min-w-0 flex-1 rounded-md border border-surface1 bg-base px-2 py-1 font-mono text-[11px] text-text"
          />
          <button onClick={() => void copy(url)} title={t(lang, "share.copy")} aria-label={t(lang, "share.copy")} className={`${btn} bg-surface0 text-text hover:bg-surface1`}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
          <a href={url} target="_blank" rel="noopener noreferrer" title={t(lang, "share.open")} aria-label={t(lang, "share.open")} className={`${btn} bg-surface0 text-text hover:bg-surface1`}>
            <ExternalLink size={13} />
          </a>
        </div>
      )}
      <button onClick={() => void create()} disabled={busy} className={`${btn} ${compact ? "shrink-0" : "w-full"} border border-surface1 text-text hover:bg-surface0`}>
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
        {busy ? t(lang, "share.working") : url ? t(lang, "share.again") : compact ? t(lang, "share.title") : t(lang, "share.create")}
      </button>
      {until && !error && !compact && <p className="px-1 text-[10px] text-overlay0">{t(lang, "share.until").replace("{date}", until)}</p>}
      {error && <p title={error} className={compact ? "max-w-40 truncate text-[11px] text-red" : "px-1 text-[11px] leading-snug text-red"}>{error}</p>}
    </div>
  );
}
