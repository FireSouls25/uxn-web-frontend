import { useMemo, useState } from "react";
import { useStore } from "@nanostores/react";
import { Check, Copy, Download } from "lucide-react";
import { t, useLang } from "../lib/i18n";
import { emitProject } from "../lib/project";
import { codeFileStore, projectStore, projectsStore, currentIdStore } from "../lib/store";

/* Code view: generated files read-only (the project is the source of
   truth), plus ONE editable surface — custom.ux, user-authored
   top-level ETAL with optional custom_setup/custom_frame hooks.
   Code projects (e.g. chess) show their file set read-only. */
export default function CodePanel() {
  const lang = useLang();
  const project = useStore(projectStore);
  const file = useStore(codeFileStore);
  const [copied, setCopied] = useState(false);

  const isCode = project.kind === "code";
  const tabs: string[] = isCode
    ? Object.keys(project.codeFiles ?? {})
    : ["main.ux", "devices.ux", "custom.ux"];
  const active = tabs.includes(file) ? file : tabs[0];

  const files = useMemo(() => {
    try {
      return emitProject(project);
    } catch {
      return { "main.ux": "" } as Record<string, string>;
    }
  }, [project]);
  const custom = project.customCode ?? "";
  const customEditable = !isCode && !project.locked;

  function setCustom(text: string) {
    const id = currentIdStore.get();
    const all = projectsStore.get();
    const p = all[id];
    if (p && p.kind === "visual") {
      projectsStore.set({ ...all, [id]: { ...p, customCode: text, updatedAt: Date.now() } });
    }
  }

  const text = isCode ? (files[active] ?? "") : active === "custom.ux" ? custom : (files[active] ?? "");

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
    a.download = active;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {tabs.map((f) => (
          <button
            key={f}
            onClick={() => codeFileStore.set(f)}
            className={`rounded-md px-2.5 py-1 font-mono text-[11px] transition-colors ${
              active === f ? "bg-mauve/20 text-mauve" : "text-subtext0 hover:bg-surface0 hover:text-text"
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
      {!isCode && active === "custom.ux" && customEditable ? (
        <textarea
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          spellCheck={false}
          placeholder={t(lang, "code.custom_ph")}
          className="min-h-[420px] w-full resize-y rounded-lg border border-surface0 bg-crust p-3 font-mono text-[11px] leading-relaxed outline-none placeholder:text-overlay0 focus:border-mauve"
        />
      ) : (
        <pre className="max-h-[420px] overflow-auto rounded-lg border border-surface0 bg-crust p-3 font-mono text-[11px] leading-relaxed">
          {text}
        </pre>
      )}
      <p className="mt-2 font-mono text-[11px] text-subtext0">
        {isCode ? t(lang, "code.hand_note") : active === "custom.ux" ? t(lang, "code.custom_note") : t(lang, "code.note")}
      </p>
    </div>
  );
}
