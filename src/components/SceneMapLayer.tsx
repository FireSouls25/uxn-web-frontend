import { useMemo } from "react";
import { useStore } from "@nanostores/react";
import { t, useLang } from "../lib/i18n";
import { sceneVar } from "../lib/scene-ui";
import { buildSceneMap } from "../lib/project";
import { projectStore, sceneIdStore } from "../lib/store";

const NODE_W = 148;
const NODE_H = 54;
const GAP_X = 90;
const GAP_Y = 26;

/* Scene-map layer of the logic canvas: the EventsGraph overview
   (same buildSceneMap + BFS-depth columns) restyled as dark cards
   with cubic bezier edges. Click a node to jump the studio there.
   Pan/zoom belong to the parent viewport — this layer only lays out
   content-sized SVG. */
export default function SceneMapLayer() {
  const lang = useLang();
  const project = useStore(projectStore);
  const sceneId = useStore(sceneIdStore);
  const map = useMemo(() => buildSceneMap(project), [project]);

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

  const size = useMemo(() => {
    let w = NODE_W;
    let h = NODE_H;
    for (const p of pos.values()) {
      w = Math.max(w, p.x + NODE_W);
      h = Math.max(h, p.y + NODE_H);
    }
    return { w, h };
  }, [pos]);

  const accentOf = (id: string): string => {
    const i = project.scenes.findIndex((s) => s.id === id);
    return sceneVar(i < 0 ? 0 : i);
  };
  const startId = project.start;

  /** Cubic bezier from the source's right edge to the target's left. */
  function edgePath(x1: number, y1: number, x2: number, y2: number): string {
    const dx = Math.max(30, Math.abs(x2 - x1) / 2);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  }

  return (
    <div data-nopan>
      <p className="mb-2 font-mono text-[11px] uppercase tracking-widest text-subtext0">
        {t(lang, "events.title")} · <span className="text-mauve">{sceneId}</span>
      </p>
      <div className="node-card overflow-hidden rounded-2xl p-3">
        <svg width={size.w} height={size.h} className="block max-w-none">
          <defs>
            <marker id="scenemap-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="#e4e4e7" strokeWidth="1.5" />
            </marker>
          </defs>
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
                    d={`M ${rx} ${ry - 9} C ${rx + 36} ${ry - 9}, ${rx + 36} ${ry + 9}, ${rx} ${ry + 9}`}
                    fill="none"
                    stroke="#e4e4e7"
                    strokeWidth="1.5"
                    markerEnd="url(#scenemap-arrow)"
                  />
                  <text x={rx + 20} y={ry - 13} textAnchor="middle" fontSize="9" fontFamily="monospace" fill="var(--ctp-subtext0)">
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
                <path d={edgePath(x1, y1, x2, y2)} fill="none" stroke="#e4e4e7" strokeWidth="1.5" markerEnd="url(#scenemap-arrow)" />
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
            const active = n.id === sceneId;
            return (
              <g
                key={n.id}
                transform={`translate(${p.x},${p.y})`}
                onClick={() => sceneIdStore.set(n.id)}
                className="cursor-pointer"
              >
                <title>{n.id}</title>
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx="10"
                  fill={active ? "#1d1d21" : "#131316"}
                  stroke={n.broken ? "var(--ctp-red)" : active ? "#ffffff" : "#2a2b31"}
                  strokeWidth={n.id === startId ? 2.5 : 1.25}
                  strokeDasharray={n.broken ? "5 4" : undefined}
                  opacity={active ? 1 : 0.9}
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
        </svg>
      </div>
      <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-overlay0">{t(lang, "events.hint")}</p>
    </div>
  );
}
