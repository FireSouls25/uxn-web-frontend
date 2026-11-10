import { useState } from "react";
import { useStore } from "@nanostores/react";
import { motion } from "motion/react";
import { FolderOpen, Play, Plus, Trash2 } from "lucide-react";
import { t, useLang } from "../lib/i18n";
import {
  PLAY_ON_OPEN_KEY,
  createProject,
  currentIdStore,
  deleteProject,
  openProject,
  projectsStore,
} from "../lib/store";
import { chessProject } from "../lib/examples";
import { platformerProject } from "../lib/examples/platformer";
import { catcherProject } from "../lib/examples/catcher";
import { lifeLabProject } from "../lib/examples/lifelab";
import type { Project } from "../lib/project";

/** Read-only examples, always offered (Duplicate to edit). */
const EXAMPLES: Array<{ make: () => Project; desc: string }> = [
  { make: lifeLabProject, desc: "proj.lifelab_desc" },
  { make: platformerProject, desc: "proj.platformer_desc" },
  { make: catcherProject, desc: "proj.catcher_desc" },
  { make: chessProject, desc: "proj.chess_desc" },
];
import type { LoopMode } from "../lib/project";

/* Project management: list, create, open, delete. Account-only —
   RequireAuth guarantees a session before this renders. */
export default function ProjectsHub() {
  const lang = useLang();
  const projects = useStore(projectsStore);
  const currentId = useStore(currentIdStore);
  const [name, setName] = useState("");
  const [loop, setLoop] = useState<LoopMode>("engine");

  function create(e: React.FormEvent) {
    e.preventDefault();
    const id = createProject(name || t(lang, "proj.name_ph"), loop);
    setName("");
    window.location.href = "/studio";
    void id;
  }

  function open(id: string) {
    openProject(id);
    window.location.href = "/studio";
  }

  function openExample(make: () => Project, play = false) {
    const p = make();
    try {
      if (play) sessionStorage.setItem(PLAY_ON_OPEN_KEY, p.id);
      else sessionStorage.removeItem(PLAY_ON_OPEN_KEY);
    } catch {
      /* no sessionStorage: the studio opens without auto-play */
    }
    const all = projectsStore.get();
    projectsStore.set({ ...all, [p.id]: { ...p, updatedAt: Date.now() } });
    openProject(p.id);
    window.location.href = "/studio";
  }

  const list = Object.values(projects)
    .filter((p) => p.kind !== "code" && !p.locked)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-bold tracking-tight">
        {t(lang, "proj.title")}
      </h1>
      <p className="mt-1 text-sm text-subtext0">{t(lang, "proj.sub")}</p>

      <h2 className="mt-8 font-mono text-[11px] uppercase tracking-widest text-mauve">
        {t(lang, "proj.examples")}
      </h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {EXAMPLES.map(({ make, desc }, i) => {
          const ex = make();
          return (
            <motion.div
              key={ex.id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: i * 0.05 }}
              className="pane rounded-xl border-mauve/30 p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[15px] font-semibold">{ex.name}</h2>
                <span className="flex gap-1">
                  <span className="rounded-full bg-teal/15 px-2 py-0.5 font-mono text-[10px] text-teal">
                    {t(lang, "loop.engine")}
                  </span>
                  <span className="rounded-full bg-yellow/15 px-2 py-0.5 font-mono text-[10px] text-yellow">
                    {t(lang, "proj.locked")}
                  </span>
                </span>
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-subtext0">
                {t(lang, desc)}
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => openExample(make, true)}
                  className="seg-active inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium"
                >
                  <Play size={14} /> {t(lang, "proj.play")}
                </button>
                <button
                  onClick={() => openExample(make, false)}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-surface0 px-3 py-2 text-[13px] font-medium transition-colors hover:bg-surface1"
                >
                  <FolderOpen size={14} /> {t(lang, "proj.open")}
                </button>
              </div>
            </motion.div>
          );
        })}
      </div>

      <h2 className="mt-8 font-mono text-[11px] uppercase tracking-widest text-subtext0">
        {t(lang, "proj.mine")}
      </h2>

      <form
        onSubmit={create}
        className="pane mt-6 flex flex-wrap gap-2 rounded-xl p-3"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t(lang, "proj.name_ph")}
          maxLength={48}
          className="min-w-40 flex-1 rounded-lg border border-surface1 bg-base px-3.5 py-2 text-sm outline-none placeholder:text-overlay0 focus:border-mauve"
        />
        <div
          role="radiogroup"
          aria-label={t(lang, "loop.title")}
          className="flex items-center gap-1 rounded-lg border border-surface1 p-1"
        >
          {(["engine", "script"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={loop === m}
              title={t(
                lang,
                m === "engine" ? "loop.engine_hint" : "loop.script_hint",
              )}
              onClick={() => setLoop(m)}
              className={`rounded-md px-2.5 py-1 font-mono text-[11px] transition-colors ${
                loop === m
                  ? "seg-active"
                  : "text-subtext0 hover:bg-surface0 hover:text-text"
              }`}
            >
              {t(lang, m === "engine" ? "loop.engine" : "loop.script")}
            </button>
          ))}
        </div>
        <motion.button
          type="submit"
          whileTap={{ scale: 0.97 }}
          className="inline-flex items-center gap-2 rounded-lg bg-mauve px-4 py-2 text-sm font-semibold text-crust"
        >
          <Plus size={15} /> {t(lang, "proj.new")}
        </motion.button>
      </form>

      {list.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-surface1 px-4 py-8 text-center text-sm text-subtext0">
          {t(lang, "proj.empty")}
        </p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {list.map((p, i) => (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: Math.min(i * 0.05, 0.3) }}
              className={`pane rounded-xl p-4 ${p.id === currentId ? "border-mauve/40" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="truncate text-[15px] font-semibold">{p.name}</h2>
                <button
                  onClick={() => deleteProject(p.id)}
                  aria-label={t(lang, "proj.delete")}
                  className="grid size-7 shrink-0 place-items-center rounded-md text-subtext0 transition-colors hover:bg-surface0 hover:text-red"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <p className="mt-1 font-mono text-[11px] text-subtext0">
                {p.loop === "script"
                  ? `${t(lang, "loop.script")} · ${1 + (p.scripts ?? []).length} ${t(lang, "proj.files")} · `
                  : `${p.scenes.length} ${t(lang, "proj.scenes")} · ${p.scenes.reduce((n, s) => n + s.nodes.length, 0)} ${t(lang, "proj.objects")} · `}
                {p.width}×{p.height}
              </p>
              <button
                onClick={() => open(p.id)}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-surface0 px-3 py-2 text-[13px] font-medium transition-colors hover:bg-surface1"
              >
                <FolderOpen size={14} /> {t(lang, "proj.open")}
              </button>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
