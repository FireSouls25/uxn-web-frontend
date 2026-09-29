import { useEffect, useRef } from "react";
import { useStore } from "@nanostores/react";
import { themeColors } from "../lib/palette";
import { t, useLang } from "../lib/i18n";
import { sceneVar } from "../lib/scene-ui";
import {
  currentScene,
  moveLeafByPath,
  projectStore,
  resizeProject,
  sceneIdStore,
  selectionStore,
} from "../lib/store";
import { flattenScene } from "../lib/project";
import type { FlatLeaf } from "../lib/project";

const TILE = 8;

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

function hitTest(leaves: FlatLeaf[], x: number, y: number): FlatLeaf | null {
  for (let i = leaves.length - 1; i >= 0; i--) {
    const o = leaves[i];
    if (x >= o.x && x < o.x + TILE && y >= o.y && y < o.y + TILE) return o;
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
  const leaves: FlatLeaf[] = (() => {
    try {
      return flattenScene(project, scene.id);
    } catch {
      return [];
    }
  })();

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
    const [gx, gy] = toGame(e);
    const hit = hitTest(leaves, gx, gy);
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
    moveLeafByPath(scene.id, drag.path, gx - drag.dx, gy - drag.dy);
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
        <label className="ml-auto inline-flex items-center gap-1.5 font-mono text-[11px] text-subtext0">
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
      <canvas
        ref={canvasRef}
        width={project.width}
        height={project.height}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
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
