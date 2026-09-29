import { useStore } from "@nanostores/react";
import { Film, Plus } from "lucide-react";
import { PALETTE } from "../lib/palette";
import { t, useLang } from "../lib/i18n";
import {
  addAnimation,
  paintColorStore,
  paintToolStore,
  projectStore,
  setSpritePixels,
  spriteSelStore,
} from "../lib/store";

/* Center of the sprites view: the big painter for the selected
   sprite plus its animations. Gallery lives left, tools right. */
export default function SpriteEditor() {
  const lang = useLang();
  const project = useStore(projectStore);
  const spriteId = useStore(spriteSelStore);
  const color = useStore(paintColorStore);
  const tool = useStore(paintToolStore);

  const sprite = project.sprites.find((s) => s.id === spriteId) ?? project.sprites[0] ?? null;
  const pixels = sprite?.pixels ?? Array(64).fill(0);

  function paint(r: number, c: number) {
    if (!sprite) return;
    const next = [...pixels];
    next[r * 8 + c] = tool === "brush" ? color : 0;
    setSpritePixels(sprite.id, next);
  }

  return (
    <div>
      {sprite ? (
        <div
          className="grid w-fit gap-px rounded-lg border border-surface0 bg-surface0 p-2"
          style={{ gridTemplateColumns: "repeat(8, min(34px, 7vw))" }}
        >
          {pixels.map((v, i) => {
            const r = Math.floor(i / 8);
            const c = i % 8;
            return (
              <button
                key={i}
                aria-label={`pixel ${r},${c}`}
                onPointerDown={() => paint(r, c)}
                onPointerEnter={(e) => {
                  if (e.buttons === 1) paint(r, c);
                }}
                className="aspect-square rounded-[3px]"
                style={{ background: PALETTE[v & 3] }}
              />
            );
          })}
        </div>
      ) : null}
      <p className="mt-2 font-mono text-[11px] text-subtext0">{t(lang, "sprite.hint")}</p>

      <p className="mt-4 font-mono text-[11px] uppercase tracking-widest text-subtext0">
        {t(lang, "sprite.anims")} ({project.anims.length})
      </p>
      <div className="mt-2 space-y-1.5">
        {project.anims.map((a) => (
          <div key={a.id} className="rounded-lg border border-surface0 px-2.5 py-1.5">
            <p className="flex items-center gap-1.5 font-mono text-[11px] text-text">
              <Film size={12} className="text-teal" /> {a.id}
              <span className="ml-auto text-subtext0">×{a.rate} {a.loop ? "∞" : "1"}</span>
            </p>
            <p className="mt-0.5 truncate font-mono text-[10px] text-subtext0">{a.frames.join(" → ")}</p>
          </div>
        ))}
      </div>
      <button
        onClick={() => sprite && addAnimation([sprite.id])}
        className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-surface0 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface1"
      >
        <Plus size={13} /> {t(lang, "sprite.new_anim")}
      </button>
    </div>
  );
}
