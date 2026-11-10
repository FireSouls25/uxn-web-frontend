import { useState } from "react";
import { useStore } from "@nanostores/react";
import { Check, Copy, Eye, EyeOff, Loader2, Plug, Unplug } from "lucide-react";
import { t, useLang } from "../../lib/i18n";
import { bridgeStore, claudeCommand, connectBridge, disconnectBridge, mcpJson, resumeBridge } from "../../lib/agent/bridge";

/* "Connect an agent": pairs an outside MCP client (Claude Code, …)
   with this tab, shows how to add it, and what it has been doing. */
export default function ConnectAgent() {
  const lang = useLang();
  const s = useStore(bridgeStore);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function pair() {
    setBusy(true);
    setErr(null);
    const r = await connectBridge();
    if (!r.ok) setErr(t(lang, r.status === 401 ? "bridge.login" : r.status === 0 ? "agent.offline" : "bridge.failed"));
    setBusy(false);
  }

  async function copy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      /* clipboard blocked: text stays selectable */
    }
  }

  const dot = s.status === "on" ? "bg-green" : s.status === "connecting" ? "bg-yellow" : "bg-overlay0";
  const mask = (k: string) => (show ? k : `${k.slice(0, 8)}…${k.slice(-4)}`);

  const block = (id: string, label: string, text: string, shown = text) => (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-subtext0">{label}</span>
        <button onClick={() => void copy(id, text)} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] text-subtext0 hover:bg-surface0 hover:text-text">
          {copied === id ? <Check size={11} /> : <Copy size={11} />} {t(lang, copied === id ? "share.copied" : "share.copy")}
        </button>
      </div>
      <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-md border border-surface1 bg-base px-2 py-1.5 font-mono text-[10.5px] leading-snug text-text">{shown}</pre>
    </div>
  );

  return (
    <div className="flex-1 space-y-3 overflow-y-auto px-3.5 py-3 text-[12.5px] leading-relaxed">
      <p className="text-text">{t(lang, "bridge.intro")}</p>

      {!s.key ? (
        <>
          {s.status === "expired" && <p className="text-[11.5px] text-yellow">{t(lang, "bridge.expired")}</p>}
          <button onClick={() => void pair()} disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-mauve px-3 py-2 text-[13px] font-semibold text-crust disabled:opacity-60">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
            {t(lang, "bridge.connect")}
          </button>
          {err && <p className="text-[11.5px] text-red">{err}</p>}
          <p className="text-[11px] text-subtext0">{t(lang, "bridge.note")}</p>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <span className={`size-2 rounded-full ${dot}`} />
            <span className="font-semibold text-text">{t(lang, `bridge.s_${s.status}`)}</span>
            {s.calls > 0 && (
              <span className="ml-auto font-mono text-[10.5px] text-subtext0">
                {s.calls} · {s.last}
              </span>
            )}
          </div>
          {s.status === "replaced" && (
            <button onClick={resumeBridge} className="w-full rounded-lg border border-surface1 px-3 py-1.5 text-[12px] font-semibold text-text hover:bg-surface0">
              {t(lang, "bridge.use_here")}
            </button>
          )}
          {block("cmd", t(lang, "bridge.claude"), claudeCommand(s.mcpUrl ?? "", s.key), claudeCommand(s.mcpUrl ?? "", mask(s.key)))}
          {block("json", t(lang, "bridge.json"), mcpJson(s.mcpUrl ?? "", s.key), mcpJson(s.mcpUrl ?? "", mask(s.key)))}
          <button onClick={() => setShow((v) => !v)} className="inline-flex items-center gap-1 font-mono text-[10.5px] text-subtext0 hover:text-text">
            {show ? <EyeOff size={11} /> : <Eye size={11} />} {t(lang, show ? "bridge.hide_key" : "bridge.show_key")}
          </button>
          <p className="text-[11px] text-subtext0">{t(lang, "bridge.keep_open")}</p>
          <button onClick={() => void disconnectBridge()} className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red/40 px-3 py-1.5 text-[12px] font-semibold text-red hover:bg-red/10">
            <Unplug size={13} /> {t(lang, "bridge.disconnect")}
          </button>
        </>
      )}
    </div>
  );
}
