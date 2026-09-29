import { useEffect, useRef } from "react";
import { useStore } from "@nanostores/react";
import { t, useLang } from "../lib/i18n";
import { currentScene, moveObject, projectStore, resizeProject, sceneIdStore, selectionStore } from "../lib/store";
import type { SceneObject } from "../lib/project";

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

function hitTest(objects: SceneObject[], x: number, y: number): SceneObject | null {
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
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
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);

  const scene = currentScene(project, sceneId);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, project.width, project.height);
    const ink = cssVar("--ctp-text", "#cdd6f4");
    const accent = cssVar("--ctp-mauve", "#cba6f7");
    for (const o of scene.objects) {
      const tile = o.tile ?? [255, 255, 255, 255, 255, 255, 255, 255];
      ctx.fillStyle = ink;
      for (let r = 0; r < TILE; r++) {
        const byte = tile[r] ?? 0;
        for (let c = 0; c < TILE; c++) {
          if (byte & (1 << (7 - c))) ctx.fillRect(o.x + c, o.y + r, 1, 1);
        }
      }
      if (o.id === selection) {
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

  function onDown(e: React.PointerEvent) {
    const [gx, gy] = toGame(e);
    const hit = hitTest(scene.objects, gx, gy);
    selectionStore.set(hit ? hit.id : null);
    if (hit) {
      dragRef.current = { id: hit.id, dx: gx - hit.x, dy: gy - hit.y };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
  }

  function onMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const [gx, gy] = toGame(e);
    projectStore.set(moveObject(projectStore.get(), scene.id, drag.id, gx - drag.dx, gy - drag.dy));
  }

  function onUp() {
    dragRef.current = null;
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        <span className="font-mono text-[11px] uppercase tracking-widest text-subtext0">
          {t(lang, "canvas.scene")}
        </span>
        {project.scenes.map((s) => (
          <button
            key={s.id}
            onClick={() => {
              sceneIdStore.set(s.id);
              selectionStore.set(null);
            }}
            className={`rounded-md px-2.5 py-1 font-mono text-[11px] transition-colors ${
              s.id === scene.id ? "bg-mauve/20 text-mauve" : "text-subtext0 hover:bg-surface0 hover:text-text"
            }`}
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
            className="cursor-pointer rounded-md border border-surface1 bg-mantle px-1.5 py-1 font-mono text-[11px] outline-none"
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
