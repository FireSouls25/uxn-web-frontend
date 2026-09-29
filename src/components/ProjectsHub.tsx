import { useState } from "react";
import { useStore } from "@nanostores/react";
import { motion } from "motion/react";
import { FolderOpen, Plus, Trash2 } from "lucide-react";
import { t, useLang } from "../lib/i18n";
import { createProject, currentIdStore, deleteProject, openProject, projectsStore } from "../lib/store";

/* Project management: list, create, open, delete. Guests manage
   memory-only projects (banner says so); logins persist. */
export default function ProjectsHub() {
  const lang = useLang();
  const projects = useStore(projectsStore);
  const currentId = useStore(currentIdStore);
  const [name, setName] = useState("");

  function create(e: React.FormEvent) {
    e.preventDefault();
    const id = createProject(name || t(lang, "proj.name_ph"));
    setName("");
    window.location.href = "/studio";
    void id;
  }

  function open(id: string) {
    openProject(id);
    window.location.href = "/studio";
  }

  const list = Object.values(projects).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-bold tracking-tight">{t(lang, "proj.title")}</h1>
      <p className="mt-1 text-sm text-subtext0">{t(lang, "proj.sub")}</p>

      <form onSubmit={create} className="pane mt-6 flex gap-2 rounded-xl p-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t(lang, "proj.name_ph")}
          maxLength={48}
          className="flex-1 rounded-lg border border-surface1 bg-base px-3.5 py-2 text-sm outline-none placeholder:text-overlay0 focus:border-mauve"
        />
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
                {p.scenes.length} {t(lang, "proj.scenes")} ·{" "}
                {p.scenes.reduce((n, s) => n + s.objects.length, 0)} {t(lang, "proj.objects")} ·{" "}
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
