import { useState } from "react";
import { useStore } from "@nanostores/react";
import { ChevronDown, ChevronRight, FilePlus2, Home, Plus, Trash2 } from "lucide-react";
import { t, useLang } from "../lib/i18n";
import {
  addObject,
  addScene,
  currentIdStore,
  deleteObject,
  deleteScene,
  projectStore,
  projectsStore,
  sceneIdStore,
  selectionStore,
} from "../lib/store";

/* Godot-like node tree: scenes are roots, objects are children.
   Click selects (canvas + inspector follow), disclosure toggles,
   plus/minus manage nodes, home marks the start scene. */
export default function HierarchyPanel() {
  const lang = useLang();
  const project = useStore(projectStore);
  const sceneId = useStore(sceneIdStore);
  const selection = useStore(selectionStore);
  const [open, setOpen] = useState<Record<string, boolean>>({ [sceneId]: true });

  function pick(sid: string, oid: string | null) {
    sceneIdStore.set(sid);
    selectionStore.set(oid);
    setOpen((o) => ({ ...o, [sid]: true }));
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-widest text-subtext0">
          {t(lang, "hier.title")}
        </p>
        <button
          onClick={() => addScene()}
          title={t(lang, "hier.new_scene")}
          aria-label={t(lang, "hier.new_scene")}
          className="grid size-6 place-items-center rounded-md text-subtext0 transition-colors hover:bg-surface0 hover:text-text"
        >
          <FilePlus2 size={13} />
        </button>
      </div>
      <ul className="mt-2 space-y-0.5">
        {project.scenes.map((s) => {
          const expanded = open[s.id] ?? s.id === sceneId;
          return (
            <li key={s.id}>
              <div
                className={`flex items-center gap-1 rounded-md px-1.5 py-1 ${
                  s.id === sceneId ? "bg-surface0" : ""
                }`}
              >
                <button
                  onClick={() => setOpen((o) => ({ ...o, [s.id]: !expanded }))}
                  aria-label={s.id}
                  className="grid size-5 place-items-center text-subtext0 hover:text-text"
                >
                  {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
                <button
                  onClick={() => pick(s.id, null)}
                  className={`flex-1 truncate text-left font-mono text-xs ${
                    s.id === sceneId && !selection ? "text-mauve" : "text-text"
                  }`}
                >
                  {s.id}
                </button>
                {project.start === s.id && <Home size={12} className="shrink-0 text-green" />}
                {project.scenes.length > 1 && (
                  <button
                    onClick={() => deleteScene(s.id)}
                    aria-label={`${t(lang, "hier.delete")} ${s.id}`}
                    className="grid size-5 shrink-0 place-items-center text-subtext0 opacity-0 transition-opacity hover:text-red group-hover:opacity-100"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
              {expanded && (
                <ul className="ml-4 space-y-0.5 border-l border-surface1 pl-1.5">
                  {s.objects.map((o) => (
                    <li
                      key={o.id}
                      className={`group flex items-center gap-1 rounded-md px-1.5 py-1 ${
                        selection === o.id && s.id === sceneId ? "bg-mauve/15" : ""
                      }`}
                    >
                      <button
                        onClick={() => pick(s.id, o.id)}
                        className={`flex-1 truncate text-left font-mono text-[11px] ${
                          selection === o.id && s.id === sceneId ? "text-mauve" : "text-subtext0 hover:text-text"
                        }`}
                      >
                        {o.id}
                        <span className="text-overlay0">
                          {" "}
                          [{o.x},{o.y}]
                        </span>
                      </button>
                      <button
                        onClick={() => {
                          sceneIdStore.set(s.id);
                          deleteObject(o.id);
                        }}
                        aria-label={`${t(lang, "hier.delete")} ${o.id}`}
                        className="grid size-5 shrink-0 place-items-center text-subtext0 opacity-0 transition-opacity hover:text-red group-hover:opacity-100"
                      >
                        <Trash2 size={11} />
                      </button>
                    </li>
                  ))}
                  <li>
                    <button
                      onClick={() => {
                        if (sceneId !== s.id) sceneIdStore.set(s.id);
                        addObject();
                      }}
                      className="flex items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[11px] text-subtext0 hover:text-text"
                    >
                      <Plus size={11} /> {t(lang, "hier.new_object")}
                    </button>
                  </li>
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
