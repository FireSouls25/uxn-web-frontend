import { useState } from "react";
import { useStore } from "@nanostores/react";
import {
  Box,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  Gamepad2,
  Home,
  Map as MapIcon,
  Move,
  Plus,
  Trash2,
} from "lucide-react";
import { t, useLang } from "../lib/i18n";
import { sceneVar } from "../lib/scene-ui";
import type { ObjectKind } from "../lib/project";
import {
  addObject,
  addScene,
  deleteObject,
  deleteScene,
  moveObjectToScene,
  projectStore,
  reorderObject,
  sceneIdStore,
  selectionStore,
} from "../lib/store";

export const KIND_ICON = { player: Gamepad2, static: Box, movable: Move } as const;

/* Godot-like node tree: scenes are roots, objects are children.
   Click selects (canvas + inspector follow); rows drag to reorder
   within a scene or move across scenes; plus/minus manage nodes;
   home marks the start scene. Scene accents + helper text make the
   active scene unmistakable. */
export default function HierarchyPanel() {
  const lang = useLang();
  const project = useStore(projectStore);
  const sceneId = useStore(sceneIdStore);
  const selection = useStore(selectionStore);
  const [open, setOpen] = useState<Record<string, boolean>>({ [sceneId]: true });
  const [dragObj, setDragObj] = useState<{ scene: string; index: number } | null>(null);
  const [over, setOver] = useState<{ scene: string; index: number | null } | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<ObjectKind>("static");

  function pick(sid: string, oid: string | null) {
    sceneIdStore.set(sid);
    selectionStore.set(oid);
    setOpen((o) => ({ ...o, [sid]: true }));
  }

  function commitCreate(sid: string) {
    if (sceneIdStore.get() !== sid) sceneIdStore.set(sid);
    addObject(newKind, newName);
    setNewName("");
    setCreating(false);
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
      <ul className="mt-2 space-y-1">
        {project.scenes.map((s, si) => {
          const expanded = open[s.id] ?? s.id === sceneId;
          const accent = sceneVar(si);
          const active = s.id === sceneId;
          return (
            <li
              key={s.id}
              onDragOver={(e) => {
                if (dragObj && dragObj.scene !== s.id) {
                  e.preventDefault();
                  setOver({ scene: s.id, index: null });
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragObj && dragObj.scene !== s.id) {
                  const obj = project.scenes
                    .find((x) => x.id === dragObj.scene)
                    ?.objects[dragObj.index];
                  if (obj) {
                    sceneIdStore.set(dragObj.scene);
                    moveObjectToScene(obj.id, s.id);
                  }
                }
                setDragObj(null);
                setOver(null);
              }}
              onDragLeave={() => setOver((o) => (o?.scene === s.id ? null : o))}
            >
              <div
                className={`flex items-center gap-1 rounded-md border-l-2 px-1.5 py-1 ${
                  active ? "bg-surface0" : ""
                }`}
                style={{ borderLeftColor: accent }}
              >
                <button
                  onClick={() => setOpen((o) => ({ ...o, [s.id]: !expanded }))}
                  aria-label={s.id}
                  className="grid size-5 place-items-center text-subtext0 hover:text-text"
                >
                  {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
                <MapIcon size={13} style={{ color: accent }} className="shrink-0" />
                <button
                  onClick={() => pick(s.id, null)}
                  className={`flex-1 truncate text-left font-mono text-xs ${
                    active && !selection ? "text-text" : "text-subtext0 hover:text-text"
                  }`}
                  style={active ? { color: accent } : undefined}
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
              {over?.scene === s.id && over.index === null && (
                <div className="ml-4 rounded border border-dashed px-2 py-1 text-center font-mono text-[10px]" style={{ borderColor: accent, color: accent }}>
                  {t(lang, "hier.drop_here")}
                </div>
              )}
              {expanded && (
                <ul className="ml-4 space-y-0.5 border-l border-surface1 pl-1.5">
                  {s.objects.map((o, oi) => {
                    const Icon = KIND_ICON[o.kind] ?? Box;
                    const selected = selection === o.id && s.id === sceneId;
                    const showInsert = over?.scene === s.id && over.index === oi;
                    return (
                      <li key={o.id}>
                        {showInsert && <div className="h-0.5 rounded bg-mauve" />}
                        <div
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = "move";
                            setDragObj({ scene: s.id, index: oi });
                          }}
                          onDragEnd={() => {
                            setDragObj(null);
                            setOver(null);
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            setOver({ scene: s.id, index: oi });
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (dragObj && dragObj.scene === s.id) reorderObject(dragObj.index, oi);
                            setDragObj(null);
                            setOver(null);
                          }}
                          className={`group flex cursor-grab items-center gap-1.5 rounded-md px-1.5 py-1 active:cursor-grabbing ${
                            selected ? "bg-mauve/15" : "hover:bg-surface0"
                          }`}
                        >
                          <Icon size={13} className={selected ? "text-mauve" : "text-subtext0"} />
                          <button
                            onClick={() => pick(s.id, o.id)}
                            className={`flex-1 truncate text-left font-mono text-[11px] ${
                              selected ? "text-mauve" : "text-subtext0 group-hover:text-text"
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
                        </div>
                      </li>
                    );
                  })}
                  <li>
                    {creating && sceneId === s.id ? (
                      <form
                        className="flex items-center gap-1 rounded-md bg-surface0 px-1.5 py-1"
                        onSubmit={(e) => {
                          e.preventDefault();
                          commitCreate(s.id);
                        }}
                      >
                        <input
                          autoFocus
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                          placeholder={t(lang, "hier.name_ph")}
                          maxLength={24}
                          className="min-w-0 flex-1 bg-transparent font-mono text-[11px] outline-none placeholder:text-overlay0"
                        />
                        <select
                          aria-label={t(lang, "hier.kind")}
                          value={newKind}
                          onChange={(e) => setNewKind(e.target.value as ObjectKind)}
                          className="select select-sm"
                        >
                          <option value="player">{t(lang, "kind.player")}</option>
                          <option value="static">{t(lang, "kind.static")}</option>
                          <option value="movable">{t(lang, "kind.movable")}</option>
                        </select>
                        <button
                          type="submit"
                          className="rounded bg-mauve/20 px-1.5 py-0.5 font-mono text-[11px] text-mauve"
                        >
                          +
                        </button>
                      </form>
                    ) : (
                      <button
                        onClick={() => {
                          if (sceneId !== s.id) sceneIdStore.set(s.id);
                          setCreating(true);
                        }}
                        className="flex items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[11px] text-subtext0 hover:text-text"
                      >
                        <Plus size={11} /> {t(lang, "hier.new_object")}
                      </button>
                    )}
                  </li>
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 font-mono text-[10px] leading-relaxed text-overlay0">{t(lang, "hier.hint")}</p>
    </div>
  );
}
