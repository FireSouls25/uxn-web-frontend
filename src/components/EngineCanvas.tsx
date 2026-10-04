import { useEffect, useRef } from "react";
import { useStore } from "@nanostores/react";
import LogicGraphLayer from "./LogicGraphLayer";
import SceneLayer from "./SceneLayer";
import SceneMapLayer from "./SceneMapLayer";
import { canvasModeStore, patchViewport, viewportStore } from "../lib/store";

/* Canvas-first viewport shell: owns pan/zoom + the Scene|Logic mode
   switch content. Scene mode is the pixel layer (select, drag, drop);
   logic mode stacks the scene-map layer over the logic-graph layer.
   Interactive children mark themselves data-nopan so background drags
   pan without fighting canvas drags, text fields or node clicks. */
export default function EngineCanvas() {
  const mode = useStore(canvasModeStore);
  const vp = useStore(viewportStore);
  const boxRef = useRef<HTMLDivElement>(null);

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
    if ((e.target as HTMLElement).closest("[data-nopan]")) return;
    if (e.button !== 0 && e.button !== 1) return;
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
      className="absolute inset-0 cursor-grab overflow-hidden bg-black active:cursor-grabbing"
    >
      {vp.grid && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: "radial-gradient(#26272d 1px, transparent 1px)",
            backgroundSize: "24px 24px",
            backgroundPosition: `${vp.x}px ${vp.y}px`,
          }}
        />
      )}
      <div
        className="min-h-full w-full p-4 sm:p-6"
        style={{ transform: `translate(${vp.x}px,${vp.y}px) scale(${vp.k})`, transformOrigin: "0 0" }}
      >
        {mode === "scene" ? (
          <SceneLayer />
        ) : (
          <div className="mx-auto w-full max-w-4xl space-y-6">
            <SceneMapLayer />
            <LogicGraphLayer />
          </div>
        )}
      </div>
    </div>
  );
}
