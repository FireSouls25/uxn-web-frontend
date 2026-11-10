import { useEffect, useRef } from "react";
import { useStore } from "@nanostores/react";
import { ListChecks, Map as MapIcon } from "lucide-react";
import EventSheet from "./blocks/EventSheet";
import SceneLayer from "./SceneLayer";
import SceneMapLayer from "./SceneMapLayer";
import { t, useLang } from "../lib/i18n";
import { canvasModeStore, mapLevelStore, patchViewport, sceneIdStore, viewportStore } from "../lib/store";

/* Canvas-first viewport shell: owns pan/zoom + the Scene|Blocks
   switch content. Scene mode is the pixel layer (select, drag,
   drop); Blocks mode is two free-form levels — the scene map
   first, double-click a scene to drill into its objects. Nodes on
   both levels drag anywhere and stay where left. Interactive
   children mark themselves data-nopan so background drags pan
   without fighting canvas drags, text fields or node clicks. */
export default function EngineCanvas() {
  const lang = useLang();
  const mode = useStore(canvasModeStore);
  const level = useStore(mapLevelStore);
  const sceneId = useStore(sceneIdStore);
  const vp = useStore(viewportStore);
  const boxRef = useRef<HTMLDivElement>(null);

  // Esc climbs back out: drilled objects → scene map (unless
  // typing in a field, where Esc stays local).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if ((e.target as HTMLElement | null)?.closest("input,select,textarea")) return;
      if (canvasModeStore.get() !== "logic" || mapLevelStore.get() !== "objects") return;
      mapLevelStore.set("map");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Native wheel listener (React's is passive): zoom anchored at cursor.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Let text areas and code fields scroll natively.
      if ((e.target as HTMLElement).closest("[data-nopan]")) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const cur = viewportStore.get();
      const k = Math.min(2.5, Math.max(0.25, cur.k * Math.exp(-e.deltaY * 0.0015)));
      patchViewport({ k, x: px - ((px - cur.x) / cur.k) * k, y: py - ((py - cur.y) / cur.k) * k });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  function onPointerDown(e: React.PointerEvent) {
    // Pan on middle/right drag only: left is click/select everywhere
    // (nodes, block rows, scene paint). Right never opens a menu here.
    if ((e.target as HTMLElement).closest("[data-nopan]")) return;
    if (e.button !== 1 && e.button !== 2) return;
    e.preventDefault();
    const start = viewportStore.get();
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev: PointerEvent) => {
      patchViewport({ x: start.x + ev.clientX - sx, y: start.y + ev.clientY - sy });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div
      ref={boxRef}
      onPointerDown={onPointerDown}
      onContextMenu={(e) => e.preventDefault()}
      className="absolute inset-0 cursor-grab overflow-hidden bg-canvas active:cursor-grabbing"
    >
      {vp.grid && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: "radial-gradient(var(--canvas-dot) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
            backgroundPosition: "0 0",
          }}
        />
      )}
      <div
        className="min-h-full w-full p-4 sm:p-6"
        style={{ transform: `translate(${vp.x}px,${vp.y}px) scale(${vp.k})`, transformOrigin: "0 0" }}
      >
        {mode === "scene" ? <SceneLayer /> : level === "map" ? <SceneMapLayer /> : null}
      </div>
      {mode === "logic" && level === "objects" && <EventSheet />}
      {mode === "logic" && (
        <div data-nopan className="dock absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-full p-1 font-mono text-[11px]">
          <button
            onClick={() => mapLevelStore.set("objects")}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 transition-colors ${level === "objects" ? "seg-active" : "text-subtext0 hover:text-text"}`}
          >
            <ListChecks size={12} /> {t(lang, "logic.events")} · {sceneId}
          </button>
          <button
            onClick={() => mapLevelStore.set("map")}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 transition-colors ${level === "map" ? "seg-active" : "text-subtext0 hover:text-text"}`}
          >
            <MapIcon size={12} /> {t(lang, "logic.map")}
          </button>
        </div>
      )}
    </div>
  );
}
