import { useStore } from "@nanostores/react";
import { t, useLang } from "../lib/i18n";
import { projectStore } from "../lib/store";

/* Studio top bar: which project is open, what kind, at what size.
   After the great sameness confusion, this is load-bearing UI. */
export default function ProjectBar() {
  const lang = useLang();
  const project = useStore(projectStore);

  return (
    <div className="pane flex flex-wrap items-center gap-3 rounded-xl px-4 py-2.5">
      <span className="text-[15px] font-bold tracking-tight">{project.name}</span>
      <span
        className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${
          project.kind === "code" ? "bg-teal/15 text-teal" : "bg-mauve/15 text-mauve"
        }`}
      >
        {project.kind === "code" ? t(lang, "proj.code_kind") : t(lang, "proj.visual_kind")}
      </span>
      {project.locked && (
        <span className="rounded-full bg-yellow/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-yellow">
          {t(lang, "proj.locked")}
        </span>
      )}
      <span className="font-mono text-[11px] text-subtext0">
        {project.kind === "code"
          ? `${Object.keys(project.codeFiles ?? {}).length} ${t(lang, "proj.files")}`
          : `${project.scenes.length} ${t(lang, "proj.scenes")} · ${project.width}×${project.height}`}
      </span>
    </div>
  );
}
