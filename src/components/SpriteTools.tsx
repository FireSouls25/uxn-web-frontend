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
} from "lucide-react";
import { themeColors, setPaletteIndex } from "../lib/palette";
import { flattenScene } from "../lib/project";
import { t, useLang } from "../lib/i18n";
import { paintColorStore, paintToolStore, projectStore, setSpritePixels, setTheme, spriteSelStore } from "../lib/store";

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
        <p className="mt-2 font-mono text-[11px] text-subtext0">
          {t(lang, "sprite.used_by")}: {usedByAll.length > 0 ? usedByAll.join(", ") : "—"}
        </p>
      </div>
    );
  }
  function paintAll(value: number[] | number) {
    if (!sprite) return;
    setSpritePixels(sprite.id, typeof value === "number" ? Array(64).fill(value) : value);
  }

  function transform(fn: (px: number[]) => number[]) {
    if (!sprite) return;
    setSpritePixels(sprite.id, fn([...sprite.pixels]));
  }
  const flipH = (px: number[]) => px.map((_, i) => px[Math.floor(i / 8) * 8 + (7 - (i % 8))]);
  const flipV = (px: number[]) => px.map((_, i) => px[(7 - Math.floor(i / 8)) * 8 + (i % 8)]);
  const shift = (dx: number, dy: number) => (px: number[]) => {
    const out = Array(64).fill(0);
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) out[((r + dy + 8) % 8) * 8 + ((c + dx + 8) % 8)] = px[r * 8 + c];
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
        <button onClick={() => sprite && paintAll(Array(64).fill(color))} title={t(lang, "sprite.fill")} className={iconBtn}>
          <PaintBucket size={15} />
        </button>
        <button onClick={() => paintAll(Array(64).fill(0))} title={t(lang, "sprite.clear")} className={`${iconBtn} font-mono text-[11px]`}>
          ∅
        </button>
        <button onClick={() => transform(flipH)} title="flip ↔" className={iconBtn}>
          <FlipHorizontal2 size={15} />
        </button>
        <button onClick={() => transform(flipV)} title="flip ↕" className={iconBtn}>
          <FlipVertical2 size={15} />
        </button>
        <button onClick={() => transform(shift(-1, 0))} title="←" className={iconBtn}>
          <ArrowLeft size={15} />
        </button>
        <button onClick={() => transform(shift(1, 0))} title="→" className={iconBtn}>
          <ArrowRight size={15} />
        </button>
        <button onClick={() => transform(shift(0, -1))} title="↑" className={iconBtn}>
          <ArrowUp size={15} />
        </button>
        <button onClick={() => transform(shift(0, 1))} title="↓" className={iconBtn}>
          <ArrowDown size={15} />
        </button>
      </div>
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
