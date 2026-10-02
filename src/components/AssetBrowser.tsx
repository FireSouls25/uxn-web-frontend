import { useState } from "react";
import { useStore } from "@nanostores/react";
import { Boxes, Plus } from "lucide-react";
import { KIND_ICON } from "./HierarchyPanel";
import { SpriteThumb } from "./SpritePicker";
import { t, useLang } from "../lib/i18n";
import {
  addDef,
  defSelStore,
  projectStore,
  selectionStore,
  spriteSelStore,
} from "../lib/store";

/* Left column, top: the object template library (GameMaker's Object
   list). Search filters; click selects the def for editing (right
   panel); drag onto the canvas stamps an instance; the + button
   templates the gallery sprite. Sprites live in their own view —
   this is behavior, not art. */
export default function AssetBrowser() {
  const lang = useLang();
  const project = useStore(projectStore);
  const defSel = useStore(defSelStore);
  const spriteSel = useStore(spriteSelStore);
  const [q, setQ] = useState("");
  const locked = !!project.locked;
  const defs = (project.objectDefs ?? []).filter((d) =>
    d.id.toLowerCase().includes(q.trim().toLowerCase()),
  );

  function pick(id: string) {
    defSelStore.set(id);
    selectionStore.set(null);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-widest text-subtext0">
          {t(lang, "assets.title")} ({(project.objectDefs ?? []).length})
        </p>
        {!locked && (
          <button
            onClick={() => addDef("", spriteSel)}
            title={t(lang, "assets.new_def")}
            aria-label={t(lang, "assets.new_def")}
            className="grid size-6 place-items-center rounded-md text-subtext0 transition-colors hover:bg-surface0 hover:text-text"
          >
            <Plus size={13} />
          </button>
        )}
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t(lang, "assets.search")}
        maxLength={24}
        className="mt-2 w-full rounded-md border border-surface1 bg-base px-2 py-1 text-xs outline-none placeholder:text-overlay0 focus:border-mauve"
      />
      {defs.length === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed border-surface1 px-3 py-3 text-center text-[13px] text-subtext0">
          {t(lang, "assets.empty")}
        </p>
      ) : (
        <ul className="mt-2 max-h-56 space-y-0.5 overflow-y-auto">
          {defs.map((d) => {
            const Icon = KIND_ICON[d.kind] ?? Boxes;
            const selected = defSel === d.id;
            return (
              <li key={d.id}>
                <div
                  draggable={!locked}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "copy";
                    e.dataTransfer.setData("application/x-def", JSON.stringify({ defId: d.id }));
                  }}
                  className={`group flex cursor-grab items-center gap-1.5 rounded-md px-1.5 py-1 active:cursor-grabbing ${
                    selected ? "bg-mauve/15" : "hover:bg-surface0"
                  }`}
                >
                  <span className="w-7 shrink-0">
                    <SpriteThumb id={d.sprite} dim={28} />
                  </span>
                  <button
                    onClick={() => pick(d.id)}
                    className={`flex min-w-0 flex-1 items-center gap-1.5 truncate text-left font-mono text-[11px] ${
                      selected ? "text-mauve" : "text-subtext0 group-hover:text-text"
                    }`}
                  >
                    <Icon size={13} className="shrink-0" />
                    <span className="truncate">{d.id}</span>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 font-mono text-[10px] leading-relaxed text-overlay0">{t(lang, "assets.hint")}</p>
    </div>
  );
}
