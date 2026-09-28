import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Check, Clock, Download, Loader2 } from "lucide-react";
import { FALLBACK_TARGETS, fetchTargets, type TargetsResponse } from "../lib/api";
import { exportProject, type ExportTarget } from "../lib/export";
import { t, useLang } from "../lib/i18n";
import { SAMPLE_PROJECT } from "../lib/project";

/* Target cards mirror GET /targets live, falling back to the static
   contract when the backend is unreachable. Export buttons compile
   the demo project and download the artifact. */
export default function TargetsGrid() {
  const lang = useLang();
  const [data, setData] = useState<TargetsResponse>(FALLBACK_TARGETS);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function exportDemo(id: string) {
    setBusy(id);
    setNotice(t(lang, "exp.working"));
    try {
      const result = await exportProject(SAMPLE_PROJECT, id as ExportTarget, "bundle", lang);
      setNotice(result.message);
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    const ctrl = new AbortController();
    fetchTargets(ctrl.signal)
      .then((t) => {
        setData(t);
        setLive(true);
      })
      .catch(() => {
        /* offline — static contract stays */
      });
    return () => ctrl.abort();
  }, []);

  return (
    <div>
      <div className="mb-5 flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-subtext0">
        <span className={`size-1.5 rounded-full ${live ? "bg-green" : "bg-yellow"}`} />
        {live ? t(lang, "tgt.live") : t(lang, "tgt.offline")}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {data.supported.map((tgt, i) => (
          <motion.div
            key={tgt.id}
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.45, delay: i * 0.07 }}
            className="pane rounded-xl p-5"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-mono text-sm font-semibold capitalize">{tgt.id}</h3>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-green/15 px-2.5 py-0.5 font-mono text-[11px] text-green">
                <Check size={12} /> {t(lang, "tgt.ready")}
              </span>
            </div>
            <p className="mt-2 font-mono text-xs text-subtext0">
              {tgt.etal_target} · {tgt.kind}
            </p>
            <button
              onClick={() => void exportDemo(tgt.id)}
              disabled={busy !== null}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-surface0 px-3.5 py-2 text-[13px] font-medium transition-colors hover:bg-surface1 disabled:opacity-70"
            >
              {busy === tgt.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}{" "}
              {t(lang, "tgt.export")} {tgt.id}
            </button>
          </motion.div>
        ))}
        {data.coming_soon.map((tgt, i) => (
          <motion.div
            key={tgt.id}
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.45, delay: (data.supported.length + i) * 0.07 }}
            className="pane rounded-xl p-5 opacity-70"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-mono text-sm font-semibold">{tgt.id}</h3>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow/15 px-2.5 py-0.5 font-mono text-[11px] text-yellow">
                <Clock size={12} /> {t(lang, "tgt.soon")}
              </span>
            </div>
            <p className="mt-2 font-mono text-xs text-subtext0">
              {tgt.etal_target} · {tgt.kind}
            </p>
          </motion.div>
        ))}
      </div>
      {notice && <p className="mt-4 text-center font-mono text-xs text-subtext0">{notice}</p>}
    </div>
  );
}
