import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@nanostores/react";
import { Maximize, ZoomIn, ZoomOut } from "lucide-react";
import { t, useLang } from "../lib/i18n";
import { sceneVar } from "../lib/scene-ui";
import { buildSceneMap } from "../lib/project";
import { projectStore, sceneIdStore } from "../lib/store";

const NODE_W = 150;
const NODE_H = 56;
const GAP_X = 100;
const GAP_Y = 30;

/* Scene overview map (Phase 4): every scene as a node, every
   transition — bindings AND event goto blocks — as a labeled edge.
   Drag to pan, scroll to zoom, click a node to jump the studio
   there. Pure rendering over buildSceneMap: no model change, and a
   broken scene still shows up (dashed) instead of breaking the map. */
export default function EventsGraph() {
  const lang = useLang();
  const project = useStore(projectStore);
  const map = useMemo(() => buildSceneMap(project), [project]);
  const boxRef = useRef<HTMLDivElement>(null);
  const movedRef = useRef(false);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });

  // Layout: BFS-depth columns (unreachable last), rows top-aligned.
  const pos = useMemo(() => {
    const cols = new Map<number, number>();
    const out = new Map<string, { x: number; y: number }>();
    const maxDepth = Math.max(0, ...map.nodes.map((n) => n.depth));
    for (const n of map.nodes) {
      const col = n.depth < 0 ? maxDepth + 1 : n.depth;
      const row = cols.get(col) ?? 0;
      cols.set(col, row + 1);
      out.set(n.id, { x: col * (NODE_W + GAP_X), y: row * (NODE_H + GAP_Y) });
    }
    return out;
  }, [map]);

  function fit() {
    const el = boxRef.current;
    if (!el || map.nodes.length === 0) return;
    const rect = el.getBoundingClientRect();
    let maxX = 0;
    let maxY = 0;
    for (const p of pos.values()) {
      maxX = Math.max(maxX, p.x + NODE_W);
      maxY = Math.max(maxY, p.y + NODE_H);
    }
    const pad = 40;
    const k = Math.min(2, Math.max(0.25, Math.min((rect.width - pad) / (maxX + pad), (rect.height - pad) / (maxY + pad))));
    setView({ k, x: (rect.width - (maxX + pad) * k) / 2 + (pad * k) / 2, y: (rect.height - (maxY + pad) * k) / 2 + (pad * k) / 2 });
  }

  const countRef = useRef(0);
  useEffect(() => {
    if (map.nodes.length !== countRef.current) {
      countRef.current = map.nodes.length;
      fit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map.nodes.length]);

  // Native wheel listener (React's is passive): zoom anchored at cursor.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      setView((v) => {
        const k = Math.min(2.5, Math.max(0.25, v.k * Math.exp(-e.deltaY * 0.0015)));
        return { k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  function onPointerDown(e: React.PointerEvent) {
    movedRef.current = false;
    const startX = e.clientX;
    const startY = e.clientY;
    let lastX = e.clientX;
    let lastY = e.clientY;
    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 3) movedRef.current = true;
      const dx = ev.clientX - lastX;
      const dy = ev.clientY - lastY;
      lastX = ev.clientX;
      lastY = ev.clientY;
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const accentOf = (id: string): string => {
    const i = project.scenes.findIndex((s) => s.id === id);
    return sceneVar(i < 0 ? 0 : i);
  };
  const startId = project.start;

  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        <p className="font-mono text-[11px] uppercase tracking-widest text-subtext0">
          {t(lang, "events.title")}
        </p>
        <span className="ml-auto inline-flex items-center gap-1">
          <button
            onClick={() => setView((v) => ({ ...v, k: Math.min(2.5, v.k * 1.25) }))}
            title={t(lang, "map.zoom_in")}
            aria-label={t(lang, "map.zoom_in")}
            className="grid size-7 place-items-center rounded-md text-subtext0 transition-colors hover:bg-surface0 hover:text-text"
          >
            <ZoomIn size={14} />
          </button>
          <button
            onClick={() => setView((v) => ({ ...v, k: Math.max(0.25, v.k / 1.25) }))}
            title={t(lang, "map.zoom_out")}
            aria-label={t(lang, "map.zoom_out")}
            className="grid size-7 place-items-center rounded-md text-subtext0 transition-colors hover:bg-surface0 hover:text-text"
          >
            <ZoomOut size={14} />
          </button>
          <button
            onClick={fit}
            title={t(lang, "map.fit")}
            aria-label={t(lang, "map.fit")}
            className="grid size-7 place-items-center rounded-md text-subtext0 transition-colors hover:bg-surface0 hover:text-text"
          >
            <Maximize size={14} />
          </button>
        </span>
      </div>
      <div
        ref={boxRef}
        onPointerDown={onPointerDown}
        className="h-80 cursor-grab overflow-hidden rounded-lg border border-surface0 bg-base active:cursor-grabbing"
      >
        <svg width="100%" height="100%">
          <defs>
            <marker id="map-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="var(--ctp-overlay0)" strokeWidth="1.5" />
            </marker>
          </defs>
          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            {map.edges.map((e, i) => {
              const a = pos.get(e.from);
              const b = pos.get(e.to);
              if (!a || !b) return null;
              if (e.from === e.to) {
                const rx = a.x + NODE_W;
                const ry = a.y + NODE_H / 2;
                return (
                  <g key={i}>
                    <path
                      d={`M ${rx} ${ry - 8} C ${rx + 34} ${ry - 8}, ${rx + 34} ${ry + 8}, ${rx} ${ry + 8}`}
                      fill="none"
                      stroke="var(--ctp-overlay0)"
                      strokeWidth="1.5"
                      markerEnd="url(#map-arrow)"
                    />
                    <text x={rx + 20} y={ry - 12} textAnchor="middle" fontSize="9" fontFamily="monospace" fill="var(--ctp-subtext0)">
                      {e.label}
                    </text>
                  </g>
                );
              }
              const x1 = a.x + NODE_W;
              const y1 = a.y + NODE_H / 2;
              const x2 = b.x;
              const y2 = b.y + NODE_H / 2;
              return (
                <g key={i}>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--ctp-overlay0)" strokeWidth="1.5" markerEnd="url(#map-arrow)" />
                  <text
                    x={(x1 + x2) / 2}
                    y={(y1 + y2) / 2 - 5}
                    textAnchor="middle"
                    fontSize="9"
                    fontFamily="monospace"
                    fill="var(--ctp-subtext0)"
                  >
                    {e.label}
                  </text>
                </g>
              );
            })}
            {map.nodes.map((n) => {
              const p = pos.get(n.id);
              if (!p) return null;
              const accent = accentOf(n.id);
              return (
                <g
                  key={n.id}
                  transform={`translate(${p.x},${p.y})`}
                  onClick={() => {
                    if (!movedRef.current) sceneIdStore.set(n.id);
                  }}
                  className="cursor-pointer"
                >
                  <title>{n.id}</title>
                  <rect
                    width={NODE_W}
                    height={NODE_H}
                    rx="10"
                    fill="var(--ctp-surface0)"
                    stroke={n.broken ? "var(--ctp-red)" : accent}
                    strokeWidth={n.id === startId ? 2.5 : 1.25}
                    strokeDasharray={n.broken ? "5 4" : undefined}
                  />
                  <circle cx="12" cy="14" r="4" fill={accent} />
                  <text x="22" y="18" fontSize="12" fontFamily="monospace" fontWeight="bold" fill="var(--ctp-text)">
                    {n.id.length > 14 ? `${n.id.slice(0, 13)}…` : n.id}
                  </text>
                  <text x="12" y="40" fontSize="10" fontFamily="monospace" fill="var(--ctp-subtext0)">
                    {n.broken ? t(lang, "map.broken") : `${n.leaves} ${t(lang, "map.objects")}`}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      <p className="mt-2 font-mono text-[10px] leading-relaxed text-overlay0">{t(lang, "events.hint")}</p>
    </div>
  );
}
