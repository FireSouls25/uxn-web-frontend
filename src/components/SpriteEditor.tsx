import { useEffect, useRef, useState } from "react";
import { useStore } from "@nanostores/react";
import { ChevronLeft, ChevronRight, Film, Plus, Redo2, Undo2, X } from "lucide-react";
import { themeColors } from "../lib/palette";
import { spriteTiles } from "../lib/project";
import { t, useLang } from "../lib/i18n";
import {
  addAnimFrame,
  moveAnimFrame,
  paintColorStore,
  paintToolStore,
  patchAnimation,
  projectStore,
  removeAnimFrame,
  setSpritePixels,
  spriteSelStore,
} from "../lib/store";
import SpritePicker, { SpriteThumb } from "./SpritePicker";

/* One animation: open filmstrip editor (frames + reorder + gallery
   pick, rate, loop, ping-pong). Same tile size enforced on add —
   mixed frames would tear at runtime. Rendered in the left rail so
   the strip is always visible, never behind a collapsed row. */
export function AnimRow({ animId }: { animId: string }) {
  const lang = useLang();
  const project = useStore(projectStore);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const anim = project.anims.find((a) => a.id === animId);
  if (!anim) return null;
  const locked = !!project.locked;

  return (
    <div className="rounded-lg border border-surface0 px-2.5 py-1.5">
      <div className="flex w-full items-center gap-1.5 font-mono text-[11px] text-text">
        <Film size={12} className="shrink-0 text-teal" />
        <span className="truncate">{anim.id}</span>
        <span className="ml-auto shrink-0 text-subtext0">
          ×{anim.rate} {anim.loop ? "∞" : "1"}
          {anim.pingpong ? " ⇄" : ""}
        </span>
      </div>
      <div className="mt-2 space-y-2">
        <div className="flex flex-wrap items-start gap-1.5">
          {anim.frames.map((f, i) => (
            <span key={`${f}-${i}`} className="flex w-10 flex-col items-center gap-0.5">
              <SpriteThumb id={f} dim={40} />
              {!locked && (
                <span className="flex items-center">
                  <button
                    onClick={() => moveAnimFrame(animId, i, -1)}
                    disabled={i === 0}
                    title={t(lang, "sprite.frame_left")}
                    aria-label={`${t(lang, "sprite.frame_left")} ${f}`}
                    className="grid size-5 place-items-center rounded text-subtext0 transition-colors hover:bg-surface0 hover:text-text disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-subtext0"
                  >
                    <ChevronLeft size={12} />
                  </button>
                  <button
                    onClick={() => removeAnimFrame(animId, i)}
                    disabled={anim.frames.length <= 1}
                    title={t(lang, "sprite.frame_remove")}
                    aria-label={`${t(lang, "sprite.frame_remove")} ${f}`}
                    className="grid size-5 place-items-center rounded text-subtext0 transition-colors hover:bg-surface0 hover:text-red disabled:opacity-30"
                  >
                    <X size={11} />
                  </button>
                  <button
                    onClick={() => moveAnimFrame(animId, i, 1)}
                    disabled={i === anim.frames.length - 1}
                    title={t(lang, "sprite.frame_right")}
                    aria-label={`${t(lang, "sprite.frame_right")} ${f}`}
                    className="grid size-5 place-items-center rounded text-subtext0 transition-colors hover:bg-surface0 hover:text-text disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-subtext0"
                  >
                    <ChevronRight size={12} />
                  </button>
                </span>
              )}
            </span>
          ))}
          {!locked && (
            <button
              onClick={() => setPicking(true)}
              title={t(lang, "sprite.frame_pick")}
              aria-label={t(lang, "sprite.frame_pick")}
              className="grid size-10 place-items-center rounded-md border border-dashed border-surface1 text-subtext0 transition-colors hover:border-mauve/60 hover:text-text"
            >
              <Plus size={14} />
            </button>
          )}
        </div>
        <SpritePicker
          open={picking}
          onPick={(sid) => {
            setError(addAnimFrame(animId, sid));
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
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
    </div>
  );
}

/* Center of the sprites view: the painter for the selected sprite,
   grown into its panel. Gallery + animations live left, tools right. */
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

  // Stroke-local undo: snapshot at stroke start, redo dies there.
  const past = useRef<number[][]>([]);
  const future = useRef<number[][]>([]);
  const [hist, setHist] = useState(0);
  function snapshot() {
    past.current.push([...pixels]);
    if (past.current.length > 60) past.current.shift();
    future.current = [];
    setHist((n) => n + 1);
  }
  function undo() {
    if (!sprite || past.current.length === 0) return;
    future.current.push([...pixels]);
    setSpritePixels(sprite.id, past.current.pop() as number[]);
    setHist((n) => n + 1);
  }
  function redo() {
    if (!sprite || future.current.length === 0) return;
    past.current.push([...pixels]);
    setSpritePixels(sprite.id, future.current.pop() as number[]);
    setHist((n) => n + 1);
  }
  void hist;

  useEffect(() => {
    if (locked) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /** Paint one pixel of tile (tx, ty) at row r, col c. */
  function paint(tx: number, ty: number, r: number, c: number) {
    if (!sprite) return;
    const idx = (tx + ty * tw) * 64 + r * 8 + c;
    if (tool === "pick") {
      paintColorStore.set(pixels[idx] & 3);
      paintToolStore.set("brush");
      return;
    }
    const next = [...pixels];
    next[idx] = tool === "brush" ? color : 0;
    setSpritePixels(sprite.id, next);
  }

  return (
    <div>
      {!locked && (
        <div className="mb-2 flex items-center gap-1">
          <button
            onClick={undo}
            disabled={past.current.length === 0}
            title={t(lang, "sprite.undo")}
            aria-label={t(lang, "sprite.undo")}
            className="grid size-7 place-items-center rounded-md text-subtext0 transition-colors hover:bg-surface0 hover:text-text disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-subtext0"
          >
            <Undo2 size={14} />
          </button>
          <button
            onClick={redo}
            disabled={future.current.length === 0}
            title={t(lang, "sprite.redo")}
            aria-label={t(lang, "sprite.redo")}
            className="grid size-7 place-items-center rounded-md text-subtext0 transition-colors hover:bg-surface0 hover:text-text disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-subtext0"
          >
            <Redo2 size={14} />
          </button>
        </div>
      )}
      {sprite ? (
        <div
          className="mx-auto grid w-full gap-1.5 rounded-lg border border-surface0 bg-surface0 p-2"
          style={{ gridTemplateColumns: `repeat(${tw}, 1fr)`, maxWidth: tw * 8 * 40 }}
        >
          {Array.from({ length: tw * th }, (_, tile) => {
            const tx = tile % tw;
            const ty = Math.floor(tile / tw);
            return (
              <div key={tile} className="grid grid-cols-8 gap-px">
                {Array.from({ length: 64 }, (_, k) => {
                  const r = Math.floor(k / 8);
                  const c = k % 8;
                  const i = tile * 64 + k;
                  const v = pixels[i] ?? 0;
                  return (
                    <button
                      key={k}
                      aria-label={`pixel ${tx * 8 + c},${ty * 8 + r}`}
                      disabled={locked}
                      onPointerDown={() => {
                        snapshot();
                        paint(tx, ty, r, c);
                      }}
                      onPointerEnter={(e) => {
                        if (e.buttons === 1) paint(tx, ty, r, c);
                      }}
                      className="aspect-square rounded-[3px]"
                      style={{ background: pal[v & 3] }}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      ) : null}
      <p className="mt-2 text-center font-mono text-[11px] text-subtext0">{t(lang, "sprite.hint")}</p>
    </div>
  );
}
