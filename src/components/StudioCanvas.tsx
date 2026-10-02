import { useEffect, useRef, useState } from "react";
import { useStore } from "@nanostores/react";
import { Grid3x3, Stamp } from "lucide-react";
import { themeColors } from "../lib/palette";
import { t, useLang } from "../lib/i18n";
import { sceneVar } from "../lib/scene-ui";
import {
  addInstance,
  addObject,
  currentScene,
  defSelStore,
  moveLeafByPath,
  projectStore,
  resizeProject,
  sceneIdStore,
  selectionStore,
  spriteSelStore,
} from "../lib/store";
import { TILE_PX, flattenScene, spritePxOf } from "../lib/project";
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

function hitTest(
  project: ReturnType<typeof projectStore.get>,
  leaves: FlatLeaf[],
  x: number,
  y: number,
): FlatLeaf | null {
  for (let i = leaves.length - 1; i >= 0; i--) {
    const o = leaves[i];
    const [w, h] = spritePxOf(project, o.sprite);
    if (x >= o.x && x < o.x + w && y >= o.y && y < o.y + h) return o;
  }
  return null;
}

/* Pixel canvas for the active scene. Click selects, drag moves
   (clamped to the project bounds, written straight to the store). */
export default function StudioCanvas() {
  const lang = useLang();
  const project = useStore(projectStore);
  const sceneId = useStore(sceneIdStore);
  const selection = useStore(selectionStore);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ path: string; dx: number; dy: number } | null>(null);

  const scene = currentScene(project, sceneId);
  const spriteSel = useStore(spriteSelStore);
  const [snap, setSnap] = useState(true);
  const [placing, setPlacing] = useState(false);
  const leaves: FlatLeaf[] = (() => {
    try {
      return flattenScene(project, scene.id);
    } catch {
      return [];
    }
  })();

  /** Snap a game pixel to the 8px tile grid (top-left origin). */
  function snapV(v: number): number {
    return snap ? Math.round(v / TILE) * TILE : v;
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, project.width, project.height);
    const accent = cssVar("--ctp-mauve", "#cba6f7");
    const pal = themeColors(project.theme);
    const sprites = new Map(project.sprites.map((s) => [s.id, s.pixels]));
    for (const o of leaves) {
      const pixels = sprites.get(o.sprite) ?? [];
      for (let r = 0; r < TILE; r++) {
        for (let c = 0; c < TILE; c++) {
          ctx.fillStyle = pal[(pixels[r * 8 + c] ?? 0) & 3];
          ctx.fillRect(o.x + c, o.y + r, 1, 1);
        }
      }
      if (o.path === selection) {
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1;
        ctx.strokeRect(o.x - 1.5, o.y - 1.5, TILE + 3, TILE + 3);
      }
    }
  }, [project, scene, selection]);

  function toGame(e: React.PointerEvent): [number, number] {
    const canvas = canvasRef.current as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    return [
      Math.floor(((e.clientX - rect.left) / rect.width) * project.width),
      Math.floor(((e.clientY - rect.top) / rect.height) * project.height),
    ];
  }

  const locked = !!project.locked;

  function onDown(e: React.PointerEvent) {
    defSelStore.set(null);
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
    const drag = dragRef.current;
    if (!drag) return;
    const [gx, gy] = toGame(e);
    moveLeafByPath(scene.id, drag.path, snapV(gx - drag.dx), snapV(gy - drag.dy));
  }

  function onUp() {
    dragRef.current = null;
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[11px] uppercase tracking-widest text-subtext0">
          {t(lang, "canvas.switch")}
        </span>
        {project.scenes.map((s, si) => (
          <button
            key={s.id}
            onClick={() => {
              sceneIdStore.set(s.id);
              selectionStore.set(null);
            }}
            className="rounded-md px-2.5 py-1 font-mono text-[11px] transition-all hover:bg-surface0"
            style={
              s.id === scene.id
                ? { background: "color-mix(in srgb, currentColor 14%, transparent)", color: sceneVar(si) }
                : { color: "var(--ctp-subtext0)" }
            }
          >
            {s.id}
          </button>
        ))}
        <span className="ml-auto inline-flex items-center gap-1">
          <button
            onClick={() => setSnap((v) => !v)}
            title={t(lang, "canvas.snap")}
            aria-label={t(lang, "canvas.snap")}
            aria-pressed={snap}
            className={`grid size-7 place-items-center rounded-md transition-colors ${
              snap ? "bg-mauve/20 text-mauve" : "text-subtext0 hover:bg-surface0 hover:text-text"
            }`}
          >
            <Grid3x3 size={14} />
          </button>
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
      {placing && !locked && (
        <p className="mb-2 rounded-lg border border-dashed border-mauve/40 px-3 py-1.5 text-center font-mono text-[11px] text-mauve">
          {t(lang, "canvas.placing")}
        </p>
      )}
      <canvas
        ref={canvasRef}
        width={project.width}
        height={project.height}
        onPointerDown={onDown}
        onPointerMove={onMove}
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
        className="aspect-auto w-full cursor-crosshair rounded-lg border border-surface0"
        style={{
          imageRendering: "pixelated",
          backgroundImage:
            "conic-gradient(var(--ctp-surface0) 25%, transparent 0 50%, var(--ctp-surface0) 0 75%, transparent 0)",
          backgroundSize: "16px 16px",
          touchAction: "none",
        }}
      />
    </div>
  );
}
