import { useMemo, useState } from "react";
import { useStore } from "@nanostores/react";
import { Check, Copy, Download } from "lucide-react";
import { t, useLang } from "../lib/i18n";
import { emitProject } from "../lib/project";
import { projectStore } from "../lib/store";

/* Read-only preview of the generated files. Direct edits are
   intentionally disabled: the project is the source of truth, and a
   forked text would silently diverge from canvas/inspector state.
   Copy or download snapshots instead. */
export default function CodePanel() {
  const lang = useLang();
  const project = useStore(projectStore);
  const [file, setFile] = useState<"main.ux" | "devices.ux">("main.ux");
  const [copied, setCopied] = useState(false);

  const files = useMemo(() => {
    try {
      return emitProject(project);
    } catch {
      return { "main.ux": "", "devices.ux": "" };
    }
  }, [project]);
  const text = files[file] ?? "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard denied — download still works */
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = file;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        {(["main.ux", "devices.ux"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFile(f)}
            className={`rounded-md px-2.5 py-1 font-mono text-[11px] transition-colors ${
              file === f ? "bg-mauve/20 text-mauve" : "text-subtext0 hover:bg-surface0 hover:text-text"
            }`}
          >
            {f}
          </button>
        ))}
        <span className="ml-auto flex gap-1">
          <button
            onClick={() => void copy()}
            className="inline-flex items-center gap-1.5 rounded-md bg-surface0 px-2.5 py-1 font-mono text-[11px] transition-colors hover:bg-surface1"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? t(lang, "code.copied") : t(lang, "code.copy")}
          </button>
          <button
            onClick={download}
            className="inline-flex items-center gap-1.5 rounded-md bg-surface0 px-2.5 py-1 font-mono text-[11px] transition-colors hover:bg-surface1"
          >
            <Download size={12} /> {t(lang, "code.download")}
          </button>
        </span>
      </div>
      <pre className="max-h-[420px] overflow-auto rounded-lg border border-surface0 bg-crust p-3 font-mono text-[11px] leading-relaxed">
        {text}
      </pre>
      <p className="mt-2 font-mono text-[11px] text-subtext0">{t(lang, "code.note")}</p>
    </div>
  );
}
