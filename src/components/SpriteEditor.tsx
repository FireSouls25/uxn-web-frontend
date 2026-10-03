import { useState } from "react";
import { useStore } from "@nanostores/react";
import { Film, Plus, X } from "lucide-react";
import { themeColors } from "../lib/palette";
import { spriteTiles } from "../lib/project";
import { t, useLang } from "../lib/i18n";
import {
  addAnimFrame,
  addAnimation,
  paintColorStore,
  paintToolStore,
  patchAnimation,
  projectStore,
  removeAnimFrame,
  setSpritePixels,
  spriteSelStore,
} from "../lib/store";
import { SpriteThumb } from "./SpritePicker";

/* One animation: collapsed row, or expanded frame editor (strip +
   add-selected, rate, loop, ping-pong). Same tile size enforced on
   add — mixed frames would tear at runtime. */
function AnimRow({ animId }: { animId: string }) {
  const lang = useLang();
  const project = useStore(projectStore);
  const spriteId = useStore(spriteSelStore);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const anim = project.anims.find((a) => a.id === animId);
  if (!anim) return null;
  const locked = !!project.locked;

  return (
    <div className="rounded-lg border border-surface0 px-2.5 py-1.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 font-mono text-[11px] text-text"
      >
        <Film size={12} className="shrink-0 text-teal" />
        <span className="truncate">{anim.id}</span>
        <span className="ml-auto shrink-0 text-subtext0">
          ×{anim.rate} {anim.loop ? "∞" : "1"}
          {anim.pingpong ? " ⇄" : ""}
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {anim.frames.map((f, i) => (
              <span key={`${f}-${i}`} className="group relative inline-block w-10">
                <SpriteThumb id={f} dim={40} />
                {!locked && anim.frames.length > 1 && (
                  <button
                    onClick={() => removeAnimFrame(animId, i)}
                    aria-label={`${t(lang, "sprite.frame_remove")} ${f}`}
                    className="absolute -right-1 -top-1 hidden size-4 place-items-center rounded-full bg-red text-crust group-hover:grid"
                  >
                    <X size={10} />
                  </button>
                )}
              </span>
            ))}
            {!locked && (
              <button
                onClick={() => {
                  const err = addAnimFrame(animId, spriteId);
                  setError(err);
                }}
                title={t(lang, "sprite.frame_add")}
                aria-label={t(lang, "sprite.frame_add")}
                className="grid size-10 place-items-center rounded-md border border-dashed border-surface1 text-subtext0 transition-colors hover:border-mauve/60 hover:text-text"
              >
                <Plus size={14} />
              </button>
            )}
          </div>
          {error && <p className="text-[12px] text-red">{error}</p>}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <label className="inline-flex items-center gap-1.5 font-mono text-[11px] text-subtext0">
              {t(lang, "sprite.rate")}
              <input
                type="number"
                value={anim.rate}
                min={1}
                max={255}
                disabled={locked}
                onChange={(e) => {
                  const n = Math.round(e.target.valueAsNumber);
                  if (!Number.isNaN(n)) patchAnimation(animId, { rate: Math.min(255, Math.max(1, n)) });
                }}
                className="w-14 rounded-md border border-surface1 bg-base px-1.5 py-1 text-right font-mono text-[11px] outline-none focus:border-mauve"
              />
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1.5 font-mono text-[11px] text-subtext0">
              <input
                type="checkbox"
                checked={anim.loop}
                disabled={locked}
                onChange={(e) => patchAnimation(animId, { loop: e.target.checked })}
                className="accent-mauve"
              />
              {t(lang, "sprite.loop")}
            </label>
            <label
              className="inline-flex cursor-pointer items-center gap-1.5 font-mono text-[11px] text-subtext0"
              title={t(lang, "sprite.pingpong_hint")}
            >
              <input
                type="checkbox"
                checked={!!anim.pingpong}
                disabled={locked || !anim.loop || anim.frames.length < 2}
                onChange={(e) => patchAnimation(animId, { pingpong: e.target.checked || undefined })}
              />
              {t(lang, "sprite.pingpong")}
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

/* Center of the sprites view: the big painter for the selected
   sprite plus its animations. Gallery lives left, tools right. */
export default function SpriteEditor() {
  const lang = useLang();
  const project = useStore(projectStore);
  const spriteId = useStore(spriteSelStore);
  const color = useStore(paintColorStore);
  const tool = useStore(paintToolStore);

  const sprite = project.sprites.find((s) => s.id === spriteId) ?? project.sprites[0] ?? null;
  const pal = themeColors(project.theme);
  const [tw, th] = sprite ? spriteTiles(sprite) : [1, 1];
  const pixels = sprite?.pixels ?? Array(64).fill(0);
  const locked = !!project.locked;

  /** Paint one pixel of tile (tx, ty) at row r, col c. */
  function paint(tx: number, ty: number, r: number, c: number) {
    if (!sprite) return;
    const next = [...pixels];
    next[(tx + ty * tw) * 64 + r * 8 + c] = tool === "brush" ? color : 0;
    setSpritePixels(sprite.id, next);
  }

  return (
    <div>
      {sprite ? (
        <div
          className="grid w-fit gap-px rounded-lg border border-surface0 bg-surface0 p-2"
          style={{ gridTemplateColumns: `repeat(${tw * 8}, min(34px, 7vw))` }}
        >
          {pixels.map((v, i) => {
            const tile = Math.floor(i / 64);
            const tx = tile % tw;
            const ty = Math.floor(tile / tw);
            const r = Math.floor((i % 64) / 8);
            const c = i % 8;
            return (
              <button
                key={i}
                aria-label={`pixel ${tx * 8 + c},${ty * 8 + r}`}
                disabled={locked}
                onPointerDown={() => paint(tx, ty, r, c)}
                onPointerEnter={(e) => {
                  if (e.buttons === 1) paint(tx, ty, r, c);
                }}
                className="aspect-square rounded-[3px]"
                style={{
                  background: pal[v & 3],
                  marginLeft: c === 0 && tx > 0 ? 4 : undefined,
                  marginTop: r === 0 && ty > 0 ? 4 : undefined,
                }}
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
          <AnimRow key={a.id} animId={a.id} />
        ))}
      </div>
      {!locked && (
        <button
          onClick={() => sprite && addAnimation([sprite.id])}
        className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-surface0 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface1"
      >
        <Plus size={13} /> {t(lang, "sprite.new_anim")}
        </button>
      )}
    </div>
  );
}
