import { useStore } from "@nanostores/react";
import { Plus } from "lucide-react";
import { useState } from "react";
import { spriteTiles } from "../lib/project";
import { t, useLang } from "../lib/i18n";
import {
  addAnimation,
  addSprite,
  projectStore,
  spriteSelStore,
} from "../lib/store";
import { SpriteThumb } from "./SpritePicker";
import { AnimRow } from "./SpriteEditor";

/* Left rail of the sprites view: two stacked libraries — Sprites
   (gallery, creator, tile footprint) and Animations (filmstrips).
   Everything placeable or assignable lives in this one column. */
export default function SpriteLibrary() {
  const lang = useLang();
  const project = useStore(projectStore);
  const spriteId = useStore(spriteSelStore);
  const [newName, setNewName] = useState("");
  const locked = !!project.locked;

  return (
    <div className="space-y-4">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-widest text-subtext0">
          {t(lang, "sprite.gallery")} ({project.sprites.length})
        </p>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {project.sprites.map((s) => {
            const [w, h] = spriteTiles(s);
            return (
              <button
                key={s.id}
                onClick={() => spriteSelStore.set(s.id)}
                title={`${s.id} · ${w}×${h}`}
                aria-pressed={s.id === spriteId}
                className={`rounded-lg border p-2 transition-colors ${
                  s.id === spriteId ? "border-mauve/60 bg-mauve/10" : "border-surface0 hover:border-surface1"
                }`}
              >
                <SpriteThumb id={s.id} dim={96} />
                <span className="mt-1 block truncate font-mono text-[10px] text-subtext0">
                  {s.id} · {w}×{h}
                </span>
              </button>
            );
          })}
        </div>
        {!locked && (
          <form
            className="mt-2 rounded-xl border border-surface0 p-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim()) {
                addSprite(newName.trim());
                setNewName("");
              }
            }}
          >
            <div className="flex gap-1.5">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t(lang, "sprite.new_ph")}
                aria-label={t(lang, "sprite.new")}
                maxLength={24}
                className="min-w-0 flex-1 rounded-md border border-surface1 bg-base px-2 py-1.5 text-xs outline-none placeholder:text-overlay0 focus:border-mauve"
              />
            </div>
            <button
              type="submit"
              className="mt-1.5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-surface0 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface1"
            >
              <Plus size={14} /> {t(lang, "sprite.new")}
            </button>
          </form>
        )}
      </div>

      <div>
        <p className="font-mono text-[11px] uppercase tracking-widest text-subtext0">
          {t(lang, "sprite.anims")} ({project.anims.length})
        </p>
        <div className="mt-2 space-y-1.5">
          {project.anims.map((a) => (
            <AnimRow key={a.id} animId={a.id} />
          ))}
        </div>
        {!locked && spriteId && (
          <button
            onClick={() => addAnimation([spriteId])}
            className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-surface0 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface1"
          >
            <Plus size={13} /> {t(lang, "sprite.new_anim")}
          </button>
        )}
      </div>
    </div>
  );
}
