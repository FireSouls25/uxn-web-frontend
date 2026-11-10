import { useStore } from "@nanostores/react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Brush,
  Eraser,
  FlipHorizontal2,
  FlipVertical2,
  PaintBucket,
  Pipette,
} from "lucide-react";
import { themeColors, setPaletteIndex } from "../lib/palette";
import { flattenScene, spriteTiles } from "../lib/project";
import { t, useLang } from "../lib/i18n";
import { paintColorStore, paintToolStore, projectStore, setSpriteCell, setSpritePixels, setSpriteSize, setTheme, spriteSelStore } from "../lib/store";

/* Right column of the sprites view: palette, brush and transforms
   for the selected sprite. Nothing about scenes or objects here. */
export default function SpriteTools() {
  const lang = useLang();
  const project = useStore(projectStore);
  const spriteId = useStore(spriteSelStore);
  const color = useStore(paintColorStore);
  const tool = useStore(paintToolStore);

  const sprite = project.sprites.find((s) => s.id === spriteId) ?? null;
  const usedBy: string[] = [];
  for (const x of project.scenes) {
    try {
      for (const leaf of flattenScene(project, x.id)) {
        if (leaf.sprite === spriteId) usedBy.push(leaf.path);
      }
    } catch {
      /* broken chain mid-edit — top-level fallback below */
    }
  }
  if (usedBy.length === 0) {
    for (const x of project.scenes) {
      for (const o of x.nodes) {
        if (o.sprite === spriteId) usedBy.push(o.id);
      }
    }
  }
  const pal = themeColors(project.theme);
  const usedByPaths = (sceneId: string): string[] => {
    try {
      return flattenScene(project, sceneId)
        .filter((l) => l.sprite === spriteId)
        .map((l) => l.path);
    } catch {
      return [];
    }
  };
  const usedByAll = project.scenes.flatMap((x) => usedByPaths(x.id).map((p) => `${x.id}/${p}`));
  if (!!project.locked) {
    return (
      <div>
        <p className="font-mono text-[11px] uppercase tracking-widest text-subtext0">
          {t(lang, "sprite.tools")}
          {sprite && <span className="text-mauve"> · {sprite.id}</span>}
        </p>
        {sprite && (() => {
          const [w, h] = spriteTiles(sprite);
          return (
            <p className="mt-2 font-mono text-[11px] text-subtext0">
              {t(lang, "sprite.size")} · {w}×{h} ({w * 8}×{h * 8}px)
            </p>
          );
        })()}
        <p className="mt-2 font-mono text-[11px] text-subtext0">
          {t(lang, "sprite.used_by")}: {usedByAll.length > 0 ? usedByAll.join(", ") : "—"}
        </p>
      </div>
    );
  }
  function paintAll(value: number[] | number) {
    if (!sprite) return;
    const [w, h] = spriteTiles(sprite);
    setSpritePixels(sprite.id, typeof value === "number" ? Array(64 * w * h).fill(value) : value);
  }

  function transform(fn: (px: number[], w: number, h: number) => number[]) {
    if (!sprite) return;
    const [w, h] = spriteTiles(sprite);
    setSpritePixels(sprite.id, fn([...sprite.pixels], w, h));
  }
  // Whole-sprite transforms over the w×h tile grid (per-tile math
  // would mirror tiles in place instead of moving them).
  const flipH = (px: number[], w: number) =>
    px.map((_, i) => {
      const t = Math.floor(i / 64);
      const tx = t % w;
      const ty = (t - tx) / w;
      const r = Math.floor((i % 64) / 8);
      const c = i % 8;
      return px[(w - 1 - tx + ty * w) * 64 + r * 8 + (7 - c)];
    });
  const flipV = (px: number[], w: number, h: number) =>
    px.map((_, i) => {
      const t = Math.floor(i / 64);
      const tx = t % w;
      const ty = (t - tx) / w;
      const r = Math.floor((i % 64) / 8);
      const c = i % 8;
      return px[(tx + (h - 1 - ty) * w) * 64 + (7 - r) * 8 + c];
    });
  const shift = (dx: number, dy: number) => (px: number[], w: number, h: number) => {
    const W = w * 8;
    const H = h * 8;
    const out = Array(px.length).fill(0);
    for (let r = 0; r < H; r++)
      for (let c = 0; c < W; c++) out[((r + dy + H) % H) * W + ((c + dx + W) % W)] = px[r * W + c];
    return out;
  };

  const iconBtn =
    "grid size-8 place-items-center rounded-md text-subtext0 transition-colors hover:bg-surface0 hover:text-text";
  const active = `${iconBtn} bg-surface0 text-mauve`;

  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-widest text-subtext0">
        {t(lang, "sprite.tools")}
        {sprite && <span className="text-mauve"> · {sprite.id}</span>}
      </p>
      <div className="mt-2 flex items-center gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <button
            key={i}
            onClick={() => {
              paintColorStore.set(i);
              paintToolStore.set("brush");
            }}
            title={`${t(lang, "sprite.color")} ${i}${i === 0 ? ` (${t(lang, "sprite.bg")})` : ""}`}
            className={`size-8 rounded-md border-2 transition-transform ${
              color === i && tool === "brush" ? "scale-110 border-mauve" : "border-transparent"
            }`}
            style={{ background: pal[i] }}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <button onClick={() => paintToolStore.set("brush")} title={t(lang, "sprite.paint")} className={tool === "brush" ? active : iconBtn}>
          <Brush size={15} />
        </button>
        <button onClick={() => paintToolStore.set("erase")} title={t(lang, "sprite.erase")} className={tool === "erase" ? active : iconBtn}>
          <Eraser size={15} />
        </button>
        <button onClick={() => paintToolStore.set("pick")} title={t(lang, "sprite.pick")} className={tool === "pick" ? active : iconBtn}>
          <Pipette size={15} />
        </button>
        <button onClick={() => sprite && paintAll(color)} title={t(lang, "sprite.fill")} className={iconBtn}>
          <PaintBucket size={15} />
        </button>
        <button onClick={() => paintAll(0)} title={t(lang, "sprite.clear")} className={`${iconBtn} font-mono text-[11px]`}>
          ∅
        </button>
        <button onClick={() => transform(flipH)} title={t(lang, "sprite.flip_h")} className={iconBtn}>
          <FlipHorizontal2 size={15} />
        </button>
        <button onClick={() => transform(flipV)} title={t(lang, "sprite.flip_v")} className={iconBtn}>
          <FlipVertical2 size={15} />
        </button>
        <button onClick={() => transform(shift(-1, 0))} title={t(lang, "sprite.shift_left")} className={iconBtn}>
          <ArrowLeft size={15} />
        </button>
        <button onClick={() => transform(shift(1, 0))} title={t(lang, "sprite.shift_right")} className={iconBtn}>
          <ArrowRight size={15} />
        </button>
        <button onClick={() => transform(shift(0, -1))} title={t(lang, "sprite.shift_up")} className={iconBtn}>
          <ArrowUp size={15} />
        </button>
        <button onClick={() => transform(shift(0, 1))} title={t(lang, "sprite.shift_down")} className={iconBtn}>
          <ArrowDown size={15} />
        </button>
      </div>
      <div className="mt-3 rounded-xl border border-surface0 p-2">
        <p className="font-mono text-[11px] text-subtext0">
          {t(lang, "sprite.size")}
          {sprite && (() => {
            const [w, h] = spriteTiles(sprite);
            return (
              <span>
                {" "}· {sprite.id} · {w}×{h} ({w * 8}×{h * 8}px)
              </span>
            );
          })()}
        </p>
        {sprite && (() => {
          const [w, h] = spriteTiles(sprite);
          return (
            <div className="mt-1.5 grid w-fit grid-cols-4 gap-1" role="radiogroup" aria-label={t(lang, "sprite.size")}>
              {Array.from({ length: 16 }, (_, i) => {
                const x = (i % 4) + 1;
                const y = Math.floor(i / 4) + 1;
                const on = x <= w && y <= h;
                return (
                  <button
                    key={i}
                    role="radio"
                    aria-checked={x === w && y === h}
                    title={`${x}×${y}`}
                    onClick={() => setSpriteSize(sprite.id, x, y)}
                    className={`size-6 rounded border transition-colors ${
                      on ? "border-mauve/60 bg-mauve/20" : "border-surface1 hover:border-surface2"
                    }`}
                  />
                );
              })}
            </div>
          );
        })()}
      </div>
      {sprite && (() => {
        const [w, h] = spriteTiles(sprite);
        // Every cell size that tiles the sprite evenly (whole = off).
        const opts: Array<[number, number]> = [];
        for (let ch = 1; ch <= h; ch++) for (let cw = 1; cw <= w; cw++) if (w % cw === 0 && h % ch === 0) opts.push([cw, ch]);
        if (opts.length < 2) return null;
        const cur = sprite.cell ? `${sprite.cell.w}x${sprite.cell.h}` : `${w}x${h}`;
        return (
          <label className="mt-3 block rounded-xl border border-surface0 p-2" title={t(lang, "sprite.sheet_hint")}>
            <span className="font-mono text-[11px] text-subtext0">{t(lang, "sprite.sheet")}</span>
            <select
              value={cur}
              disabled={!!project.locked}
              onChange={(e) => {
                const [cw, ch] = e.target.value.split("x").map(Number);
                setSpriteCell(sprite.id, cw === w && ch === h ? null : { w: cw, h: ch });
              }}
              className="mt-1.5 w-full rounded-md border border-surface1 bg-base px-2 py-1 font-mono text-xs outline-none focus:border-mauve"
            >
              {opts.map(([cw, ch]) => (
                <option key={`${cw}x${ch}`} value={`${cw}x${ch}`}>
                  {cw === w && ch === h ? t(lang, "sprite.sheet_off") : `${cw}×${ch} · ${(w / cw) * (h / ch)}`}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[10px] leading-snug text-overlay0">{t(lang, "sprite.sheet_hint")}</p>
          </label>
        );
      })()}
      <p className="mt-2 font-mono text-[11px] text-subtext0">
        {t(lang, "sprite.used_by")}: {usedByAll.length > 0 ? usedByAll.join(", ") : "—"}
      </p>
      <p className="mt-3 font-mono text-[11px] uppercase tracking-widest text-subtext0">
        {t(lang, "sprite.palette")}
      </p>
      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        {themeColors(project.theme).map((hex, i) => (
          <label key={i} className="flex items-center gap-1.5 rounded-md border border-surface0 px-1.5 py-1">
            <input
              type="color"
              value={hex}
              disabled={!!project.locked}
              onChange={(e) => setTheme(setPaletteIndex(project.theme, i, e.target.value))}
              className="size-6 cursor-pointer rounded border-0 bg-transparent p-0"
            />
            <span className="font-mono text-[10px] text-subtext0">
              {i} · {hex}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
