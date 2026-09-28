import { useState } from "react";
import { motion } from "motion/react";
import { Download, Loader2 } from "lucide-react";
import { t, useLang } from "../lib/i18n";
import { exportProject, type ExportMode, type ExportTarget } from "../lib/export";
import { projectStore } from "../lib/store";

/* Real export: current project → backend → file in Downloads. */
export default function ExportPanel() {
  const lang = useLang();
  const [target, setTarget] = useState<ExportTarget>("web");
  const [mode, setMode] = useState<ExportMode>("bundle");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);

  async function run() {
    setBusy(true);
    setMessage(t(lang, "exp.working"));
    setDiagnostics([]);
    try {
      const result = await exportProject(projectStore.get(), target, mode, lang);
      setMessage(result.message);
      setDiagnostics((result.diagnostics ?? []).slice(0, 3).map((d) => `${d.file ?? "?"}:${d.line ?? "?"} ${d.msg}`));
    } finally {
      setBusy(false);
    }
  }

  const seg = (active: boolean) =>
    `rounded-md px-3 py-1.5 font-mono text-xs transition-colors ${
      active ? "bg-mauve/20 text-mauve" : "text-subtext0 hover:bg-surface0 hover:text-text"
    }`;

  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-widest text-subtext0">{t(lang, "exp.title")}</p>
      <div className="mt-2 space-y-2.5">
        <div>
          <p className="mb-1 font-mono text-[11px] text-subtext0">{t(lang, "exp.target")}</p>
          <div className="flex gap-1">
            {(["web", "linux"] as const).map((id) => (
              <button key={id} onClick={() => setTarget(id)} className={seg(target === id)}>
                {id}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1 font-mono text-[11px] text-subtext0">{t(lang, "exp.mode")}</p>
          <div className="flex gap-1">
            {(
              [
                ["bundle", t(lang, "exp.bundle")],
                ["rom", t(lang, "exp.rom")],
                ["tal", t(lang, "exp.tal")],
              ] as Array<[ExportMode, string]>
            ).map(([id, label]) => (
              <button key={id} onClick={() => setMode(id)} className={seg(mode === id)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <motion.button
          onClick={run}
          disabled={busy}
          whileTap={busy ? undefined : { scale: 0.98 }}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-green px-3 py-2 text-[13px] font-semibold text-crust disabled:opacity-70"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {busy ? t(lang, "exp.working") : t(lang, "exp.go")}
        </motion.button>
        {message && <p className="text-[13px] text-subtext0">{message}</p>}
        {diagnostics.length > 0 && (
          <ul className="space-y-1 font-mono text-[11px] text-red">
            {diagnostics.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
