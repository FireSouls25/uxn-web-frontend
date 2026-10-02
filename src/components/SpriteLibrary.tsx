import { useStore } from "@nanostores/react";
import { Plus } from "lucide-react";
import { useState } from "react";
import { spriteTiles } from "../lib/project";
import { t, useLang } from "../lib/i18n";
import { addSprite, projectStore, setSpriteSize, spriteSelStore } from "../lib/store";
import { SpriteThumb } from "./SpritePicker";

/* Left column of the sprites view: every project sprite for
   selection, plus the new-sprite form. */
export default function SpriteLibrary() {
  const lang = useLang();
  const project = useStore(projectStore);
  const spriteId = useStore(spriteSelStore);
  const [newName, setNewName] = useState("");
  const sel = project.sprites.find((s) => s.id === spriteId);
  const [selW, selH] = sel ? spriteTiles(sel) : [1, 1];

  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-widest text-subtext0">
        {t(lang, "sprite.gallery")} ({project.sprites.length})
      </p>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {project.sprites.map((s) => {
          const [w, h] = spriteTiles(s);
          return (
            <button
              key={s.id}
              onClick={() => spriteSelStore.set(s.id)}
              title={`${s.id} · ${w}×${h}`}
              className={`rounded-lg border p-1.5 transition-colors ${
                s.id === spriteId ? "border-mauve/60 bg-mauve/10" : "border-surface0 hover:border-surface1"
              }`}
            >
              <SpriteThumb id={s.id} />
              <span className="mt-1 block truncate font-mono text-[10px] text-subtext0">
                {s.id} · {w}×{h}
              </span>
            </button>
          );
        })}
      </div>
      {sel && (
        <label className="mt-2 flex items-center gap-2 rounded-lg border border-surface0 px-3 py-2">
          <span className="font-mono text-[11px] text-subtext0">{t(lang, "sprite.size")}</span>
          {[selW, selH].map((v, vi) => (
            <input
              key={vi}
              type="number"
              aria-label={vi === 0 ? t(lang, "sprite.w") : t(lang, "sprite.h")}
              value={v}
              min={1}
              max={4}
              onChange={(e) => setSpriteSize(sel.id, vi === 0 ? e.target.valueAsNumber : selW, vi === 1 ? e.target.valueAsNumber : selH)}
              className="w-12 rounded-md border border-surface1 bg-base px-1.5 py-1 text-right font-mono text-xs outline-none focus:border-mauve"
            />
          ))}
          <span className="font-mono text-[10px] text-overlay0">×8px</span>
        </label>
      )}
      <form
        className="mt-2 flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (newName.trim()) {
            addSprite(newName.trim());
            setNewName("");
          }
        }}
      >
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t(lang, "sprite.new_ph")}
          maxLength={24}
          className="min-w-0 flex-1 rounded-md border border-surface1 bg-base px-2 py-1 text-xs outline-none placeholder:text-overlay0 focus:border-mauve"
        />
        <button
          type="submit"
          aria-label={t(lang, "sprite.new")}
          className="grid size-7 shrink-0 place-items-center rounded-md bg-surface0 transition-colors hover:bg-surface1"
        >
          <Plus size={14} />
        </button>
      </form>
    </div>
  );
}
