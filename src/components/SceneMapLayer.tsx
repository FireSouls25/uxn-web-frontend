import { useMemo, useRef, useState } from "react";
import { useStore } from "@nanostores/react";
import { t, useLang } from "../lib/i18n";
import { sceneVar } from "../lib/scene-ui";
import { buildSceneMap } from "../lib/project";
import {
  mapLevelStore,
  projectStore,
  sceneIdStore,
  sceneNodePos,
  selectionStore,
  setSceneNodePos,
  viewportStore,
} from "../lib/store";

const NODE_W = 184;
const NODE_H = 64;

/* Scene-map level of the Blocks canvas: every scene is a free block
   you drag anywhere — it stays where left (project.layout) — with
   bezier lines for every transition edge (bindings AND goto
   blocks). Single click selects, double-click drills into the
   scene's objects. Read-only flow: switching scenes from here is
   the dock's job, so nodes never navigate on single click. */
export default function SceneMapLayer() {
  const lang = useLang();
  const project = useStore(projectStore);
  const sceneId = useStore(sceneIdStore);
  const map = useMemo(() => buildSceneMap(project), [project]);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const dragRef = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);

  const pos = useMemo(() => {
    const out = new Map<string, { x: number; y: number }>();
    map.nodes.forEach((n, i) => out.set(n.id, sceneNodePos(project, n.id, i)));
    if (drag) out.set(drag.id, { x: drag.x, y: drag.y });
    return out;
  }, [map, project, drag]);

  const size = useMemo(() => {
    let w = 900;
    let h = 600;
    for (const p of pos.values()) {
      w = Math.max(w, p.x + NODE_W + 220);
      h = Math.max(h, p.y + NODE_H + 220);
    }
    return { w, h };
  }, [pos]);

  const accentOf = (id: string): string => {
    const i = project.scenes.findIndex((s) => s.id === id);
    return sceneVar(i < 0 ? 0 : i);
  };
  const startId = project.start;

  /* Direction-aware cubic: control points lean toward the other
     end (never bulge past either block); k spreads parallel edges
     apart along the perpendicular. */
  function edgePath(x1: number, y1: number, x2: number, y2: number, k = 0): string {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const px = (-dy / len) * k;
    const py = (dx / len) * k;
    if (Math.abs(dx) >= Math.abs(dy)) {
      const s = dx >= 0 ? 1 : -1;
      const m = Math.max(30, Math.abs(dx) / 2);
      return `M ${x1} ${y1} C ${x1 + m * s + px} ${y1 + py}, ${x2 - m * s + px} ${y2 + py}, ${x2} ${y2}`;
    }
    const s = dy >= 0 ? 1 : -1;
    const m = Math.max(30, Math.abs(dy) / 2);
    return `M ${x1} ${y1} C ${x1 + px} ${y1 + m * s + py}, ${x2 + px} ${y2 - m * s + py}, ${x2} ${y2}`;
  }

  /* Edge geometry with parallel-edge fanning: edges sharing a
     pair spread perpendicular so their lines AND labels never sit
     on top of each other. Short edges skip their label (hover the
     line for it) so text can't land inside a block. */
  const drawn = useMemo(() => {
    const groups = new Map<string, number>();
    return map.edges.flatMap((e, i) => {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      if (!a || !b) return [];
      if (e.from === e.to) {
        const rx = a.x + NODE_W;
        const ry = a.y + NODE_H / 2;
        return [{
          key: `self-${i}`,
          d: `M ${rx} ${ry - 9} C ${rx + 36} ${ry - 9}, ${rx + 36} ${ry + 9}, ${rx} ${ry + 9}`,
          lx: rx + 20,
          ly: ry - 13,
          show: true,
          label: e.label,
        }];
      }
      const x1 = a.x + NODE_W;
      const y1 = a.y + NODE_H / 2;
      const x2 = b.x;
      const y2 = b.y + NODE_H / 2;
      const gkey = `${e.from}→${e.to}`;
      const gi = groups.get(gkey) ?? 0;
      groups.set(gkey, gi + 1);
      const total = map.edges.filter((o) => o.from === e.from && o.to === e.to).length;
      const k = (gi - (total - 1) / 2) * 14;
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const px = (-(y2 - y1) / len) * k;
      const py = ((x2 - x1) / len) * k;
      return [{
        key: `${gkey}-${i}`,
        d: edgePath(x1, y1, x2, y2, k),
        lx: (x1 + x2) / 2 + px,
        ly: (y1 + y2) / 2 + py - 5,
        show: len > 150,
        label: e.label,
      }];
    });
  }, [map, pos]);

  function onNodeDown(e: React.PointerEvent, id: string) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    const p = pos.get(id);
    if (!p) return;
    const k = viewportStore.get().k;
    dragRef.current = { id, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onNodeMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const k = viewportStore.get().k;
    const nx = d.ox + (e.clientX - d.sx) / k;
    const ny = d.oy + (e.clientY - d.sy) / k;
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 4) d.moved = true;
    setDrag({ id: d.id, x: nx, y: ny });
  }
  function onNodeUp(id: string) {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (d.moved && drag && drag.id === id) setSceneNodePos(id, drag.x, drag.y);
    else sceneIdStore.set(id);
    setDrag((cur) => (cur && cur.id === id ? null : cur));
  }

  return (
    <div>
      <p className="mb-2 font-mono text-[11px] uppercase tracking-widest text-subtext0">
        {t(lang, "logic.map")} · {map.nodes.length}
      </p>
      <div className="relative" style={{ width: size.w, height: size.h }}>
        <svg width={size.w} height={size.h} className="absolute inset-0 block">
          <defs>
            <marker id="scenemap-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="var(--wire)" strokeWidth="1.5" />
            </marker>
          </defs>
          {drawn.map((e) => (
            <g key={e.key}>
              <path d={e.d} fill="none" stroke="var(--wire)" strokeWidth="1.5" markerEnd="url(#scenemap-arrow)">
                <title>{e.label}</title>
              </path>
              {e.show && (
                <text
                  x={e.lx}
                  y={e.ly}
                  textAnchor="middle"
                  fontSize="9"
                  fontFamily="monospace"
                  fill="var(--ctp-subtext0)"
                  stroke="var(--canvas-bg)"
                  strokeWidth={3}
                  paintOrder="stroke"
                >
                  {e.label}
                </text>
              )}
            </g>
          ))}
        </svg>
        {map.nodes.map((n) => {
          const p = pos.get(n.id);
          if (!p) return null;
          const accent = accentOf(n.id);
          const active = n.id === sceneId;
          return (
            <div
              key={n.id}
              data-nopan
              onPointerDown={(e) => onNodeDown(e, n.id)}
              onPointerMove={onNodeMove}
              onPointerUp={() => onNodeUp(n.id)}
              onDoubleClick={() => {
                sceneIdStore.set(n.id);
                selectionStore.set(null);
                mapLevelStore.set("objects");
              }}
              title={t(lang, "logic.drill")}
              className="node-card absolute cursor-grab rounded-2xl p-3 active:cursor-grabbing"
              style={{
                left: p.x,
                top: p.y,
                width: NODE_W,
                minHeight: NODE_H,
                borderColor: n.broken ? "var(--ctp-red)" : active ? "var(--ctp-text)" : undefined,
                borderWidth: n.id === startId ? 2.5 : undefined,
                opacity: active ? 1 : 0.92,
                touchAction: "none",
              }}
            >
              <div className="flex items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: accent }} />
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-bold">
                  {n.id.length > 16 ? `${n.id.slice(0, 15)}…` : n.id}
                </span>
                {n.id === startId && (
                  <span className="shrink-0 rounded-full bg-green/15 px-1.5 py-0.5 font-mono text-[9px] text-green">start</span>
                )}
              </div>
              <p className="mt-1 font-mono text-[10px] text-subtext0">
                {n.broken ? t(lang, "map.broken") : `${n.leaves} ${t(lang, "map.objects")}`}
              </p>
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-overlay0">{t(lang, "events.hint")}</p>
    </div>
  );
}
