import { useEffect, useRef, useState } from "react";
import { useStore } from "@nanostores/react";
import { Stamp } from "lucide-react";
import { themeColors } from "../lib/palette";
import { glyphRows } from "../lib/font";
import { t, useLang } from "../lib/i18n";
import {
  addInstance,
  addObject,
  currentScene,
  defSelStore,
  moveLeafByPath,
  projectStore,
  paintTile,
  resizeProject,
  setSceneTilemap,
  sceneIdStore,
  selectionStore,
  setProjectBg,
  spriteSelStore,
  viewportStore,
} from "../lib/store";
import { TILE_PX, blendColor, cellCount, flattenScene, leafPaint, leafPxOf, worldSize } from "../lib/project";
import type { FlatLeaf } from "../lib/project";

const TILE = TILE_PX;

const SIZE_PRESETS: Array<[string, number, number]> = [
  ["128×128", 128, 128],
  ["256×256", 256, 256],
  ["320×180", 320, 180],
  ["256×240", 256, 240],
  ["160×144", 160, 144],
  ["640×360", 640, 360],
];

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/* Grid line color with contrast against the scene background: dark
   lines on light backgrounds, light lines on dark ones. Derived at
   paint time, so it tracks any bg + theme combination. */
function gridOn(hex: string): string {
  const m = hex.match(/^#([0-9a-fA-F]{6})$/);
  if (!m) return "rgba(128,128,128,0.25)";
  const v = parseInt(m[1], 16);
  const lum = (0.299 * ((v >> 16) & 0xff) + 0.587 * ((v >> 8) & 0xff) + 0.114 * (v & 0xff)) / 255;
  return lum > 0.5 ? "rgba(0,0,0,0.16)" : "rgba(255,255,255,0.18)";
}

function hitTest(
  project: ReturnType<typeof projectStore.get>,
  leaves: FlatLeaf[],
  x: number,
  y: number,
): FlatLeaf | null {
  for (let i = leaves.length - 1; i >= 0; i--) {
    const o = leaves[i];
    const [w, h] = leafPxOf(project, o);
    if (x >= o.x && x < o.x + w && y >= o.y && y < o.y + h) return o;
  }
  return null;
}

/* Scene layer of the canvas-first studio: the StudioCanvas pixel
   render, hit-test, drag-move and def-drop, minus the scene tabs
   (the header owns those now). Snap/grid come from the shared
   viewport store so header and canvas can never disagree. */
export default function SceneLayer() {
  const lang = useLang();
  const project = useStore(projectStore);
  const sceneId = useStore(sceneIdStore);
  const selection = useStore(selectionStore);
  const vp = useStore(viewportStore);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ path: string; dx: number; dy: number } | null>(null);

  const scene = currentScene(project, sceneId);
  // World size: a tile layer makes the scene wider/taller than the screen.
  const [W, H] = worldSize(project, scene);
  // Wider than one screen: show it at screen scale and scroll sideways.
  const wide = W > project.width;
  const spriteSel = useStore(spriteSelStore);
  const pal = themeColors(project.theme);
  const bg = project.bg ?? 0;
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const [placing, setPlacing] = useState(false);
  // Tile brush: null = not painting, 0 = eraser, n = sheet cell n-1.
  const [brush, setBrush] = useState<number | null>(null);
  const paintingRef = useRef(false);
  const leaves: FlatLeaf[] = (() => {
    try {
      return flattenScene(project, scene.id);
    } catch {
      return [];
    }
  })();
  const selLeaf = selection ? leaves.find((l) => l.path === selection) : undefined;

  /** Snap a game pixel to the 8px tile grid (top-left origin). */
  function snapV(v: number): number {
    return vp.snap ? Math.round(v / TILE) * TILE : v;
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const accent = cssVar("--ctp-mauve", "#cba6f7");
    const pal = themeColors(project.theme);
    // Opaque background = exactly what the ROM paints (draw_bg fills
    // the same palette index), so the editor is WYSIWYG — no checker.
    ctx.fillStyle = pal[project.bg ?? 0];
    ctx.fillRect(0, 0, W, H);
    const sprites = new Map(project.sprites.map((s) => [s.id, s]));
    const tm = scene.tilemap;
    const sheet = tm ? sprites.get(tm.sprite) : undefined;
    if (tm && sheet) {
      // Tile layer under everything, cell n-1 of the sheet per byte.
      for (let r = 0; r < tm.rows; r++)
        for (let c = 0; c < tm.cols; c++) {
          const v = tm.tiles[r * tm.cols + c];
          if (!v) continue;
          const base = (v - 1) * 64;
          if (base >= sheet.pixels.length) continue;
          for (let i = 0; i < 64; i++) {
            const col = blendColor(sheet.pixels[base + i], tm.blend ?? 1);
            if (col === null) continue;
            ctx.fillStyle = pal[col];
            ctx.fillRect(c * 8 + (i % 8), r * 8 + Math.floor(i / 8), 1, 1);
          }
        }
    }
    for (const o of leaves) {
      const spr = sprites.get(o.sprite);
      if (spr) {
        // Same cell/flip/blend the ROM draws (transparent blends let
        // what's underneath show, like the VM).
        for (const [x, y, c] of leafPaint(spr, o)) {
          ctx.fillStyle = pal[c];
          ctx.fillRect(o.x + x, o.y + y, 1, 1);
        }
      }
      if (o.label) {
        // Same 8x8 glyphs and 1bpp blend the runtime draws: text on a
        // sprite uses blend 5 (ink 1, clear paper); a text-only object
        // uses its own colors.
        const b = o.sprite ? 5 : (o.blend ?? 5);
        const ink = blendColor(1, b);
        const paper = blendColor(0, b);
        for (const [i, ch] of [...o.label].entries()) {
          const rows = glyphRows(ch.charCodeAt(0));
          for (let r = 0; r < 8; r++) {
            for (let bit = 0; bit < 8; bit++) {
              const on = rows[r] & (1 << (7 - bit));
              const c = on ? ink : paper;
              if (c === null) continue;
              ctx.fillStyle = pal[c];
              ctx.fillRect(o.x + i * 8 + bit, o.y + r, 1, 1);
            }
          }
        }
      }
      if (o.path === selection) {
        const [sw, sh] = leafPxOf(project, o);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1;
        ctx.strokeRect(o.x - 1.5, o.y - 1.5, sw + 3, sh + 3);
      }
    }
    if (vp.grid) {
      // 1px game-resolution lines: always aligned, no upscale shimmer.
      ctx.fillStyle = gridOn(pal[project.bg ?? 0]);
      for (let x = TILE; x < W; x += TILE) ctx.fillRect(x, 0, 1, H);
      for (let y = TILE; y < H; y += TILE) ctx.fillRect(0, y, W, 1);
    }
    if (W > project.width || H > project.height) {
      // What the camera shows at the start: one screen from the origin.
      ctx.strokeStyle = accent;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(0.5, 0.5, project.width - 1, project.height - 1);
      ctx.setLineDash([]);
    }
  }, [project, scene, selection, vp.grid]);

  function toGame(e: React.PointerEvent): [number, number] {
    const canvas = canvasRef.current as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    return [
      Math.floor(((e.clientX - rect.left) / rect.width) * W),
      Math.floor(((e.clientY - rect.top) / rect.height) * H),
    ];
  }

  const locked = !!project.locked;

  function paintAt(e: React.PointerEvent): void {
    if (brush === null || !scene.tilemap) return;
    const [gx, gy] = toGame(e);
    paintTile(scene.id, Math.floor(gx / 8), Math.floor(gy / 8), brush);
  }

  function onDown(e: React.PointerEvent) {
    defSelStore.set(null);
    if (brush !== null && scene.tilemap && !locked) {
      paintingRef.current = true;
      paintAt(e);
      return;
    }
    if (placing && !locked) {
      // Stamp mode: click empty canvas to place the gallery sprite.
      // Right button (or Esc) leaves the mode; a hit just selects.
      if (e.button === 2) {
        setPlacing(false);
        return;
      }
      const [gx, gy] = toGame(e);
      const hit = hitTest(project, leaves, gx, gy);
      if (hit) {
        selectionStore.set(hit.path);
        return;
      }
      sceneIdStore.set(scene.id);
      const art = project.sprites.some((s) => s.id === spriteSel)
        ? spriteSel
        : (project.sprites[0]?.id ?? "hero");
      addObject("static", "", art, snapV(gx), snapV(gy));
      return;
    }
    const [gx, gy] = toGame(e);
    const hit = hitTest(project, leaves, gx, gy);
    selectionStore.set(hit ? hit.path : null);
    if (hit && !locked) {
      dragRef.current = { path: hit.path, dx: gx - hit.x, dy: gy - hit.y };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
  }

  function onMove(e: React.PointerEvent) {
    if (paintingRef.current) {
      paintAt(e);
      return;
    }
    const drag = dragRef.current;
    if (!drag) return;
    const [gx, gy] = toGame(e);
    moveLeafByPath(scene.id, drag.path, snapV(gx - drag.dx), snapV(gy - drag.dy));
  }

  function onUp() {
    paintingRef.current = false;
    dragRef.current = null;
  }

  return (
    <div data-nopan className="mx-auto w-full max-w-3xl">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[11px] uppercase tracking-widest text-subtext0">
          {scene.id} · {leaves.length}
          {cursor && (
            <span className="text-text">
              {" "}· {cursor[0]},{cursor[1]}
            </span>
          )}
          {selLeaf && (() => {
            const [sw, sh] = leafPxOf(project, selLeaf);
            return (
              <span className="text-text">
                {" "}· {selLeaf.id} [{selLeaf.x},{selLeaf.y}] {sw}×{sh}
              </span>
            );
          })()}
        </span>
        <span className="inline-flex items-center gap-1" role="radiogroup" aria-label={t(lang, "canvas.bg")}>
          <span className="mr-0.5 font-mono text-[11px] uppercase tracking-widest text-subtext0">
            {t(lang, "canvas.bg")}
          </span>
          {[0, 1, 2, 3].map((i) => (
            <button
              key={i}
              role="radio"
              aria-checked={bg === i}
              title={`${t(lang, "canvas.bg")} ${i + 1}`}
              onClick={() => setProjectBg(i)}
              className={`size-5 rounded-md border transition-all ${
                bg === i ? "scale-110 border-mauve ring-2 ring-mauve/40" : "border-surface1 hover:scale-105"
              }`}
              style={{ background: pal[i] }}
            />
          ))}
        </span>
        <span className="ml-auto inline-flex items-center gap-1">
          <button
            onClick={() => setPlacing((v) => !v)}
            title={t(lang, "canvas.place")}
            aria-label={t(lang, "canvas.place")}
            aria-pressed={placing}
            className={`grid size-7 place-items-center rounded-md transition-colors ${
              placing ? "bg-mauve/20 text-mauve" : "text-subtext0 hover:bg-surface0 hover:text-text"
            }`}
          >
            <Stamp size={14} />
          </button>
        </span>
        <label className="inline-flex items-center gap-1.5 font-mono text-[11px] text-subtext0">
          {t(lang, "size.label")}
          <select
            aria-label={t(lang, "size.label")}
            value={`${project.width}×${project.height}`}
            onChange={(e) => {
              const preset = SIZE_PRESETS.find(([label]) => label === e.target.value);
              if (preset) resizeProject(preset[1], preset[2]);
            }}
            className="select"
          >
            {SIZE_PRESETS.map(([label]) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
            {!SIZE_PRESETS.some(([, w, h]) => w === project.width && h === project.height) && (
              <option value={`${project.width}×${project.height}`}>
                {project.width}×{project.height}
              </option>
            )}
          </select>
        </label>
      </div>
      <TileBar
        sceneId={scene.id}
        brush={brush}
        setBrush={setBrush}
        locked={locked}
      />
      {placing && !locked && (
        <p className="mb-2 rounded-lg border border-dashed border-mauve/40 px-3 py-1.5 text-center font-mono text-[11px] text-mauve">
          {t(lang, "canvas.placing")}
        </p>
      )}
      {vp.grid && !wide && (
        <div className="mb-1 flex gap-1" aria-hidden="true">
          <span className="size-3 shrink-0 rounded-[3px] bg-mauve/70" title="origin 0,0" />
          <div className="relative h-3 min-w-0 flex-1">
            {Array.from({ length: Math.floor(W / 8) + 1 }, (_, i) => {
              const gx = i * 8;
              const major = gx % 32 === 0;
              return (
                <span
                  key={gx}
                  className={`absolute top-0 w-px ${major ? "h-3 bg-overlay1" : "h-1.5 bg-surface1"}`}
                  style={{ left: `${(gx / W) * 100}%` }}
                />
              );
            })}
          </div>
        </div>
      )}
      <div className="flex gap-1">
        {vp.grid && !wide && (
          <div className="relative w-3 shrink-0" aria-hidden="true">
            {Array.from({ length: Math.floor(H / 8) + 1 }, (_, i) => {
              const gy = i * 8;
              const major = gy % 32 === 0;
              return (
                <span
                  key={gy}
                  className={`absolute left-0 h-px ${major ? "w-3 bg-overlay1" : "w-1.5 bg-surface1"}`}
                  style={{ top: `${(gy / H) * 100}%` }}
                />
              );
            })}
          </div>
        )}
      <div className={wide ? "min-w-0 flex-1 overflow-x-auto rounded-lg" : "contents"}>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        onPointerDown={onDown}
        onPointerMove={(e) => {
          setCursor(toGame(e));
          onMove(e);
        }}
        onPointerLeave={() => setCursor(null)}
        onPointerUp={onUp}
        onDragOver={(e) => {
          if (!locked && e.dataTransfer.types.includes("application/x-def")) e.preventDefault();
        }}
        onDrop={(e) => {
          if (locked) return;
          let defId = "";
          try {
            defId = (JSON.parse(e.dataTransfer.getData("application/x-def")) as { defId: string }).defId;
          } catch {
            return;
          }
          if (!defId) return;
          e.preventDefault();
          const [gx, gy] = toGame(e as unknown as React.PointerEvent);
          sceneIdStore.set(scene.id);
          addInstance(defId, snapV(gx), snapV(gy));
        }}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key === "Escape") setPlacing(false);
        }}
        tabIndex={0}
        className={`aspect-auto cursor-crosshair rounded-lg border border-surface0 ${wide ? "block max-w-none" : "min-w-0 flex-1"}`}
        style={{
          imageRendering: "pixelated",
          touchAction: "none",
          ...(wide ? { width: `${(W / project.width) * 100}%` } : {}),
        }}
      />
      </div>
      </div>
    </div>
  );
}

/* Tile layer bar: pick a brush from the scene's tile sheet and paint
   on the canvas (drag to paint runs, the eraser clears), or add a
   tile layer to a scene that has none. */
function TileBar({
  sceneId,
  brush,
  setBrush,
  locked,
}: {
  sceneId: string;
  brush: number | null;
  setBrush: (b: number | null) => void;
  locked: boolean;
}) {
  const lang = useLang();
  const project = useStore(projectStore);
  const scene = currentScene(project, sceneId);
  const tm = scene.tilemap;
  const sheets = project.sprites.filter((s) => s.cell && s.cell.w === 1 && s.cell.h === 1);
  if (!tm) {
    if (locked) return null;
    return (
      <div className="mb-2 flex flex-wrap items-center gap-2 font-mono text-[11px] text-subtext0">
        <span className="uppercase tracking-widest">{t(lang, "tiles.title")}</span>
        {sheets.length === 0 ? (
          <span>{t(lang, "tiles.need_sheet")}</span>
        ) : (
          <select
            className="select"
            value=""
            onChange={(e) => {
              const sprite = e.target.value;
              if (!sprite) return;
              const cols = Math.ceil(project.width / 8) * 4;
              const rows = Math.ceil(project.height / 8);
              setSceneTilemap(sceneId, { sprite, cols, rows, tiles: Array(cols * rows).fill(0), solid: [] });
            }}
          >
            <option value="">+ {t(lang, "tiles.add")}</option>
            {sheets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id}
              </option>
            ))}
          </select>
        )}
      </div>
    );
  }
  const sheet = project.sprites.find((s) => s.id === tm.sprite);
  const n = sheet ? cellCount(sheet) : 0;
  const pal = themeColors(project.theme);
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1 font-mono text-[11px] text-subtext0">
      <span className="mr-1 uppercase tracking-widest">
        {t(lang, "tiles.title")} {tm.cols}×{tm.rows}
      </span>
      {!locked && (
        <>
          <button
            onClick={() => setBrush(brush === null ? 1 : null)}
            aria-pressed={brush !== null}
            className={`rounded-md px-2 py-0.5 ${brush !== null ? "seg-active" : "hover:bg-surface0"}`}
            title={t(lang, "tiles.paint_hint")}
          >
            {t(lang, brush !== null ? "tiles.painting" : "tiles.paint")}
          </button>
          {brush !== null && (
            <>
              <button
                onClick={() => setBrush(0)}
                aria-pressed={brush === 0}
                title={t(lang, "tiles.erase")}
                className={`grid size-6 place-items-center rounded border ${brush === 0 ? "border-mauve" : "border-surface1"}`}
              >
                ×
              </button>
              {sheet &&
                Array.from({ length: n }, (_, c) => (
                  <button
                    key={c}
                    onClick={() => setBrush(c + 1)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      const solid = tm.solid.includes(c) ? tm.solid.filter((x) => x !== c) : [...tm.solid, c];
                      setSceneTilemap(sceneId, { ...tm, solid });
                    }}
                    aria-pressed={brush === c + 1}
                    title={t(lang, tm.solid.includes(c) ? "tiles.solid" : "tiles.decor")}
                    className={`relative size-6 rounded border p-0.5 ${brush === c + 1 ? "border-mauve" : "border-surface1"}`}
                  >
                    <TileSwatch pixels={sheet.pixels.slice(c * 64, c * 64 + 64)} pal={pal} blend={tm.blend ?? 1} />
                    {tm.solid.includes(c) && <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-red" />}
                  </button>
                ))}
            </>
          )}
          <button
            onClick={() => {
              if (window.confirm(t(lang, "tiles.remove_confirm"))) setSceneTilemap(sceneId, undefined);
            }}
            className="ml-auto rounded-md px-2 py-0.5 hover:bg-surface0 hover:text-red"
          >
            {t(lang, "tiles.remove")}
          </button>
        </>
      )}
    </div>
  );
}

function TileSwatch({ pixels, pal, blend }: { pixels: number[]; pal: string[]; blend: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, 8, 8);
    pixels.forEach((v, i) => {
      const c = blendColor(v & 3, blend);
      if (c === null) return;
      ctx.fillStyle = pal[c];
      ctx.fillRect(i % 8, Math.floor(i / 8), 1, 1);
    });
  }, [pixels, pal, blend]);
  return <canvas ref={ref} width={8} height={8} className="size-full" style={{ imageRendering: "pixelated" }} />;
}
