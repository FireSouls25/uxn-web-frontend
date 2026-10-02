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
import { spriteTiles, type ObjectKind } from "../lib/project";
import {
  addNode,
  addScene,
  deleteNode,
  deleteScene,
  defSelStore,
  moveNode,
  projectStore,
  readList,
  reorderNodes,
  sceneIdStore,
  selectionStore,
  spriteSelStore,
  type ListRef,
} from "../lib/store";
import SpritePicker, { SpriteThumb } from "./SpritePicker";

export const KIND_ICON = { player: Gamepad2, static: Box, movable: Move } as const;

interface NodeRowsProps {
  sceneId: string;
  parent: string[];
  depth: number;
  lang: ReturnType<typeof useLang>;
}

function payload(e: React.DragEvent): { sceneId: string; parent: string[]; index: number } | null {
  try {
    return JSON.parse(e.dataTransfer.getData("application/x-node")) as {
      sceneId: string;
      parent: string[];
      index: number;
    };
  } catch {
    return null;
  }
}

/* Recursive node list. Drag reorders within a list or moves across
   lists (cycle-guarded in the store); branches expand into home
   content one level at a time. */
function NodeRows({ sceneId, parent, depth, lang }: NodeRowsProps) {
  const project = useStore(projectStore);
  const selection = useStore(selectionStore);
  const spriteSel = useStore(spriteSelStore);
  const [over, setOver] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<ObjectKind>("static");
  const [newSprite, setNewSprite] = useState<string | null>(null);
  const [newDef, setNewDef] = useState("");
  const [picking, setPicking] = useState(false);

  const ref: ListRef = { sceneId, parent };
  const nodes = readList(project, ref);
  const locked = !!project.locked;
  const pathOf = (id: string) => [...parent, id].join("/");
  // The picker's choice, else the gallery selection, else the first tile.
  const chosenSprite =
    (newSprite && project.sprites.some((s) => s.id === newSprite) ? newSprite : null) ??
    (project.sprites.some((s) => s.id === spriteSel) ? spriteSel : null) ??
    project.sprites[0]?.id ??
    "hero";

  function pick(path: string | null) {
    sceneIdStore.set(sceneId);
    selectionStore.set(path);
    defSelStore.set(null);
  }

  function commitCreate() {
    const clean = newName.trim().slice(0, 24);
    let id = clean && /^[A-Za-z][A-Za-z0-9_]*$/.test(clean) ? clean : "obj";
    let n = 2;
    const base = id;
    while (nodes.some((o) => o.id === id)) id = `${base}_${n++}`;
    const usingDef = newDef && project.objectDefs?.some((d) => d.id === newDef);
    if (
      addNode(ref, {
        id,
        x: 8,
        y: 8,
        ...(usingDef
          ? { def: newDef }
          : {
              sprite: chosenSprite,
              kind: newKind,
              ...(newKind === "movable" ? { solid: true } : {}),
            }),
      })
    ) {
      pick(pathOf(id));
    }
    setNewName("");
    setNewSprite(null);
    setNewDef("");
    setCreating(false);
  }

  return (
    <ul className={depth > 0 ? "ml-4 space-y-0.5 border-l border-surface1 pl-1.5" : "space-y-0.5"}>
      {nodes.map((o, oi) => {
        const path = pathOf(o.id);
        const selected = selection === path;
        const showInsert = over === oi;
        const Icon = o.scene ? MapIcon : (KIND_ICON[o.kind ?? "static"] ?? Box);
        return (
          <li key={o.id}>
            {showInsert && <div className="h-0.5 rounded bg-mauve" />}
            <div
              draggable={!locked}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData(
                  "application/x-node",
                  JSON.stringify({ sceneId, parent, index: oi }),
                );
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(oi);
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const src = payload(e);
                if (src) {
                  if (src.sceneId === sceneId && JSON.stringify(src.parent) === JSON.stringify(parent)) {
                    reorderNodes(ref, src.index, oi);
                  } else {
                    moveNode(src, src.index, ref);
                  }
                }
                setOver(null);
              }}
              onDragEnd={() => setOver(null)}
              className={`group flex cursor-grab items-center gap-1.5 rounded-md px-1.5 py-1 active:cursor-grabbing ${
                selected ? "bg-mauve/15" : "hover:bg-surface0"
              }`}
            >
              <Icon size={13} className={selected ? "text-mauve" : "text-subtext0"} />
              <button
                onClick={() => pick(path)}
                className={`flex-1 truncate text-left font-mono text-[11px] ${
                  selected ? "text-mauve" : "text-subtext0 group-hover:text-text"
                }`}
              >
                {o.id}
                {!o.scene && (
                  <span className="text-overlay0">
                    {" "}
                    [{o.x},{o.y}]
                  </span>
                )}
              </button>
              {!locked && (
                <button
                  onClick={() => deleteNode(ref, oi)}
                  aria-label={`${t(lang, "hier.delete")} ${o.id}`}
                  className="grid size-5 shrink-0 place-items-center text-subtext0 opacity-0 transition-opacity hover:text-red group-hover:opacity-100"
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>
            {o.scene && (
              <BranchChildren sceneId={sceneId} parent={[...parent, o.id]} depth={depth + 1} lang={lang} />
            )}
          </li>
        );
      })}
      {!locked && (
        <li>
          {creating ? (
            <form
              className="space-y-1 rounded-md bg-surface0 px-1.5 py-1"
              onSubmit={(e) => {
                e.preventDefault();
                commitCreate();
              }}
            >
              {(project.objectDefs ?? []).length > 0 && (
                <select
                  aria-label={t(lang, "hier.template")}
                  value={newDef}
                  onChange={(e) => setNewDef(e.target.value)}
                  className="select select-sm w-full"
                >
                  <option value="">{t(lang, "hier.blank")}</option>
                  {(project.objectDefs ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.id} ({d.kind})
                    </option>
                  ))}
                </select>
              )}
              <div className="flex items-center gap-1">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={t(lang, "hier.name_ph")}
                  maxLength={24}
                  className="min-w-0 flex-1 bg-transparent font-mono text-[11px] outline-none placeholder:text-overlay0"
                />
                {!newDef && (
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
                )}
                <button
                  type="submit"
                  className="rounded bg-mauve/20 px-1.5 py-0.5 font-mono text-[11px] text-mauve"
                >
                  +
                </button>
              </div>
              {!newDef && (
                <>
                  <button
                    type="button"
                    onClick={() => setPicking(true)}
                    title={t(lang, "hier.sprite")}
                    className="flex w-full items-center gap-2 rounded px-1 py-0.5 hover:bg-surface1"
                  >
                    <span className="w-10 shrink-0">
                      <SpriteThumb id={chosenSprite} dim={40} />
                    </span>
                    <span className="flex-1 truncate text-left font-mono text-[11px] text-subtext0">
                      {chosenSprite} ·{" "}
                      {(() => {
                        const s = project.sprites.find((x) => x.id === chosenSprite);
                        const [w, h] = s ? spriteTiles(s) : [1, 1];
                        return `${w}×${h}`;
                      })()}
                    </span>
                  </button>
                  <SpritePicker open={picking} onPick={setNewSprite} onClose={() => setPicking(false)} />
                </>
              )}
            </form>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="flex items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[11px] text-subtext0 hover:text-text"
            >
              <Plus size={11} /> {t(lang, "hier.new_object")}
            </button>
          )}
        </li>
      )}
    </ul>
  );
}

/* Children of a branch instance, read from the home scene. */
function BranchChildren({
  sceneId,
  parent,
  depth,
  lang,
}: {
  sceneId: string;
  parent: string[];
  depth: number;
  lang: ReturnType<typeof useLang>;
}) {
  const [open, setOpen] = useState(depth < 2);
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="ml-4 font-mono text-[10px] text-overlay0 hover:text-subtext0"
      >
        <ChevronRight size={11} className="inline" /> …
      </button>
    );
  }
  return (
    <div>
      <button
        onClick={() => setOpen(false)}
        className="ml-4 font-mono text-[10px] text-overlay0 hover:text-subtext0"
      >
        <ChevronDown size={11} className="inline" /> …
      </button>
      <NodeRows sceneId={sceneId} parent={parent} depth={depth} lang={lang} />
    </div>
  );
}

/* Godot-like node tree: scenes are roots, branches expand into home
   content, leaves carry kind icons. Scene accents + helper text make
   the active scene unmistakable. */
export default function HierarchyPanel() {
  const lang = useLang();
  const project = useStore(projectStore);
  const sceneId = useStore(sceneIdStore);
  const [overScene, setOverScene] = useState<string | null>(null);
  const locked = !!project.locked;

  function pick(sid: string) {
    sceneIdStore.set(sid);
    selectionStore.set(null);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-widest text-subtext0">
          {t(lang, "hier.title")}
        </p>
        {!locked && (
          <button
            onClick={() => addScene()}
            title={t(lang, "hier.new_scene")}
            aria-label={t(lang, "hier.new_scene")}
            className="grid size-6 place-items-center rounded-md text-subtext0 transition-colors hover:bg-surface0 hover:text-text"
          >
            <FilePlus2 size={13} />
          </button>
        )}
      </div>
      <ul className="mt-2 space-y-1">
        {project.scenes.map((s, si) => {
          const accent = sceneVar(si);
          const active = s.id === sceneId;
          return (
            <li
              key={s.id}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes("application/x-node")) {
                  e.preventDefault();
                  setOverScene(s.id);
                }
              }}
              onDragLeave={() => setOverScene((o) => (o === s.id ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                const src = payload(e);
                if (src) moveNode(src, src.index, { sceneId: s.id, parent: [] });
                setOverScene(null);
              }}
            >
              <div
                className={`flex items-center gap-1 rounded-md border-l-2 px-1.5 py-1 ${
                  active ? "bg-surface0" : ""
                }`}
                style={{ borderLeftColor: accent }}
              >
                <MapIcon size={13} style={{ color: accent }} className="shrink-0" />
                <button
                  onClick={() => pick(s.id)}
                  className={`flex-1 truncate text-left font-mono text-xs ${
                    active ? "" : "text-subtext0 hover:text-text"
                  }`}
                  style={active ? { color: accent } : undefined}
                >
                  {s.id}
                </button>
                {project.start === s.id && <Home size={12} className="shrink-0 text-green" />}
                {project.scenes.length > 1 && !locked && (
                  <button
                    onClick={() => deleteScene(s.id)}
                    aria-label={`${t(lang, "hier.delete")} ${s.id}`}
                    className="grid size-5 shrink-0 place-items-center text-subtext0 opacity-0 transition-opacity hover:text-red group-hover:opacity-100"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
              {overScene === s.id && (
                <div
                  className="ml-4 rounded border border-dashed px-2 py-1 text-center font-mono text-[10px]"
                  style={{ borderColor: accent, color: accent }}
                >
                  {t(lang, "hier.drop_here")}
                </div>
              )}
              <div className="ml-4 border-l border-surface1 pl-1.5">
                <NodeRows sceneId={s.id} parent={[]} depth={1} lang={lang} />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 font-mono text-[10px] leading-relaxed text-overlay0">{t(lang, "hier.hint")}</p>
    </div>
  );
}
