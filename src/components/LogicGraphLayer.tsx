import { useLayoutEffect, useRef, useState } from "react";
import { useStore } from "@nanostores/react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { KIND_ICON } from "./HierarchyPanel";
import { SpriteThumb } from "./SpritePicker";
import KeyPicker from "./KeyPicker";
import { t, useLang, type Lang } from "../lib/i18n";
import {
  flattenScene,
  previewBlocks,
  previewOwnerEvent,
  soundMap,
  type Block,
  type EventTrigger,
  type FlatLeaf,
  type ObjectEvent,
} from "../lib/project";
import {
  addBlock,
  addEvent,
  addSound,
  currentScene,
  deleteBlock,
  moveBlock,
  patchBlock,
  patchDef,
  patchObject,
  projectStore,
  sceneIdStore,
  selectionStore,
  type EventOwner,
} from "../lib/store";

const TRIGGERS: EventTrigger[] = ["create", "step", "destroy", "key", "collide", "click", "alarm"];
const OPS = ["move", "set_pos", "play", "goto", "destroy", "wait", "code", "button"] as const;

function triggerLabel(lang: Lang, t_: EventTrigger): string {
  return t(lang, `ev.trigger_${t_}`);
}

function eventSummary(lang: Lang, e: ObjectEvent): string {
  if (e.trigger === "key") return `${triggerLabel(lang, "key")} ${e.key ?? ""}`;
  if (e.trigger === "collide") return `${triggerLabel(lang, "collide")} ${e.target ?? ""}`;
  return triggerLabel(lang, e.trigger);
}

function bezier(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(24, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function anchorCenter(el: HTMLElement, top: HTMLElement): [number, number] {
  let x = el.offsetWidth / 2;
  let y = el.offsetHeight / 2;
  let cur: HTMLElement | null = el;
  while (cur && cur !== top) {
    x += cur.offsetLeft;
    y += cur.offsetTop;
    cur = cur.offsetParent as HTMLElement | null;
  }
  return [x, y];
}

/* One block row: op-specific compact editors + reorder + delete.
   `code` is the Execute-ETAL hatch (raw statements, same gate as
   tick text); `button` is a labeled annotation (comment-only). */
function BlockRow({
  owner,
  eventId,
  index,
  block,
  path,
}: {
  owner: EventOwner;
  eventId: string;
  index: number;
  block: Block;
  path: string;
}) {
  const lang = useLang();
  const project = useStore(projectStore);
  const locked = !!project.locked;
  const num = (v: number, fn: (n: number) => void, min?: number, max?: number, w = "w-14") => (
    <input
      type="number"
      value={v}
      min={min}
      max={max}
      disabled={locked}
      onChange={(e) => {
        const n = Math.round(e.target.valueAsNumber);
        if (!Number.isNaN(n)) fn(n);
      }}
      className={`${w} rounded-md border border-surface1 bg-base px-1.5 py-1 font-mono text-[11px] outline-none focus:border-mauve`}
    />
  );
  const set = (patch: Record<string, number | string>) => patchBlock(owner, eventId, index, patch);
  const fields =
    block.op === "move" ? (
      <>
        {num(block.dx, (dx) => set({ dx }))}
        {num(block.dy, (dy) => set({ dy }))}
      </>
    ) : block.op === "set_pos" ? (
      <>
        {num(block.x, (x) => set({ x }))}
        {num(block.y, (y) => set({ y }))}
      </>
    ) : block.op === "play" ? (
      <select
        value={(project.sounds ?? []).some((s) => s.id === block.sound) ? block.sound : ""}
        disabled={locked}
        onChange={(e) => set({ sound: e.target.value })}
        className="select min-w-0 flex-1"
      >
        {(project.sounds ?? []).length === 0 && <option value="">{t(lang, "ev.no_sounds")}</option>}
        {(project.sounds ?? []).map((s) => (
          <option key={s.id} value={s.id}>
            {s.id}
          </option>
        ))}
      </select>
    ) : block.op === "goto" ? (
      <select
        value={block.scene}
        disabled={locked}
        onChange={(e) => set({ scene: e.target.value })}
        className="select min-w-0 flex-1"
      >
        {project.scenes.map((s) => (
          <option key={s.id} value={s.id}>
            → {s.id}
          </option>
        ))}
      </select>
    ) : block.op === "wait" ? (
      <>{num(block.ticks, (ticks) => set({ ticks }), 1, 255)}</>
    ) : block.op === "code" ? (
      <textarea
        value={block.code}
        disabled={locked}
        onChange={(e) => set({ code: e.target.value })}
        spellCheck={false}
        rows={2}
        placeholder={t(lang, "ev.code_ph")}
        className="min-w-0 flex-1 resize-y rounded-md border border-surface1 bg-base p-1.5 font-mono text-[11px] leading-relaxed outline-none placeholder:text-overlay0 focus:border-mauve"
      />
    ) : block.op === "button" ? (
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <input
          value={block.label}
          disabled={locked}
          maxLength={32}
          aria-label={t(lang, "ev.label")}
          placeholder={t(lang, "ev.label")}
          onChange={(e) => set({ label: e.target.value })}
          className="min-w-0 flex-1 rounded-md border border-surface1 bg-base px-1.5 py-1 text-[12px] outline-none placeholder:text-overlay0 focus:border-mauve"
        />
        <input
          value={block.action}
          disabled={locked}
          maxLength={64}
          aria-label={t(lang, "ev.action")}
          placeholder={t(lang, "ev.action_ph")}
          onChange={(e) => set({ action: e.target.value })}
          className="min-w-0 flex-1 rounded-md border border-surface1 bg-base px-1.5 py-1 font-mono text-[11px] outline-none placeholder:text-overlay0 focus:border-mauve"
        />
      </span>
    ) : (
      <span className="font-mono text-[11px] text-subtext0">{t(lang, "ev.destroy_self")}</span>
    );
  return (
    <div className="relative flex items-center gap-1.5 rounded-lg border border-surface0 bg-crust/70 px-2 py-1.5">
      <span
        data-anchor={`bin:${path}:${eventId}:${index}`}
        className="grid size-3 shrink-0 place-items-center rounded-full bg-teal/60"
      />
      <span className="w-[52px] shrink-0 font-mono text-[10px] text-teal">{t(lang, `ev.op_${block.op}`)}</span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5">{fields}</span>
      {!locked && (
        <span className="flex shrink-0 items-center">
          <button
            onClick={() => moveBlock(owner, eventId, index, index - 1)}
            disabled={index === 0}
            aria-label={t(lang, "ev.move_up")}
            className="grid size-6 place-items-center rounded text-subtext0 hover:bg-surface0 hover:text-text disabled:opacity-30"
          >
            <ArrowUp size={12} />
          </button>
          <button
            onClick={() => moveBlock(owner, eventId, index, index + 1)}
            aria-label={t(lang, "ev.move_down")}
            className="grid size-6 place-items-center rounded text-subtext0 hover:bg-surface0 hover:text-text"
          >
            <ArrowDown size={12} />
          </button>
          <button
            onClick={() => deleteBlock(owner, eventId, index)}
            aria-label={t(lang, "ev.delete_block")}
            className="grid size-6 place-items-center rounded text-subtext0 hover:bg-surface0 hover:text-red"
          >
            <Trash2 size={12} />
          </button>
        </span>
      )}
    </div>
  );
}

/* One object = one dark node: header (art + kind + count), event
   ports with child block stacks wired by beziers, then Execute-ETAL
   sections for the tick/creation-code hatches (same previewBlocks
   the emitter calls). Def instances edit the template's events;
   nested leaves are read-only with a jump home. */
function ObjectNode({ leaf }: { leaf: FlatLeaf }) {
  const lang = useLang();
  const project = useStore(projectStore);
  const sceneId = useStore(sceneIdStore);
  const selection = useStore(selectionStore);
  const [newTrigger, setNewTrigger] = useState<EventTrigger>("step");
  const [newKey, setNewKey] = useState("");
  const [newTarget, setNewTarget] = useState("any");

  const locked = !!project.locked;
  const topLevel = !leaf.path.includes("/");
  const def = leaf.def ? (project.objectDefs ?? []).find((d) => d.id === leaf.def) : undefined;
  const owner: EventOwner | null = !topLevel ? null : leaf.def ? { def: leaf.def } : { leaf: leaf.id };
  const events: ObjectEvent[] = leaf.events ?? [];
  const Icon = KIND_ICON[leaf.kind] ?? KIND_ICON.static;
  const selected = selection === leaf.path;
  const previewOwner = leaf.def ? { def: leaf.def } : { leaf: leaf.path };

  function commitAddBlock(eventId: string, op: (typeof OPS)[number]) {
    if (!owner) return;
    const base: Record<string, number | string> = {};
    if (op === "goto") base["scene"] = project.scenes[0]?.id ?? "";
    // A play action always names a sound: template one on first use
    // so the new block is valid immediately.
    if (op === "play") base["sound"] = project.sounds?.[0]?.id ?? addSound(t(lang, "sound.default_name"));
    if (op === "wait") base["ticks"] = 30;
    if (op === "code") base["code"] = "ox[slot] = ox[slot];";
    if (op === "button") {
      base["label"] = "button";
      base["action"] = "";
    }
    addBlock(owner, eventId, { op, ...base } as Block);
  }

  function commitAddEvent() {
    if (!owner) return;
    addEvent(
      owner,
      newTrigger,
      newTrigger === "key"
        ? { key: newKey || project.inputs[0]?.id }
        : newTrigger === "collide"
          ? { target: newTarget }
          : undefined,
    );
  }

  const tickText = leaf.tick ?? "";
  const setTick = (code: string) => {
    const v = code || undefined;
    if (leaf.def) patchDef(leaf.def, { tick: v });
    else patchObject(leaf.id, { tick: v });
  };
  const initText = leaf.initCode ?? "";
  const setInit = (code: string) => patchObject(leaf.id, { initCode: code || undefined });

  return (
    <div
      data-nopan
      className={`node-card relative rounded-2xl p-2.5 ${selected ? "border-white/70" : ""}`}
    >
      <button
        onClick={() => {
          if (topLevel) {
            selectionStore.set(leaf.path);
            sceneIdStore.set(sceneId);
          }
        }}
        className="flex w-full items-center gap-2 text-left"
      >
        <span className="w-8 shrink-0">
          <SpriteThumb id={leaf.sprite} dim={32} />
        </span>
        <Icon size={14} className="shrink-0 text-mauve" />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-bold">
          {leaf.id}
          {!topLevel && <span className="font-normal text-overlay0"> · {leaf.path}</span>}
        </span>
        <span className="shrink-0 rounded-full bg-surface0 px-2 py-0.5 font-mono text-[10px] text-subtext0">
          {t(lang, `kind.${leaf.kind}`)} · {events.length}
        </span>
      </button>

      {!topLevel ? (
        <p className="mt-2 rounded-lg border border-surface0 px-2.5 py-2 text-[12px] text-subtext0">
          {t(lang, "logic.nested")}
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          {events.map((e) => {
            const preview = previewOwnerEvent(project, sceneId, previewOwner, e.id);
            return (
              <div key={e.id} className="rounded-lg border border-surface0/70 p-1.5">
                <div className="flex items-center gap-1.5 px-0.5 pb-1.5">
                  <span
                    data-anchor={`port:${leaf.path}:${e.id}`}
                    className="grid size-3 shrink-0 place-items-center rounded-full bg-mauve/70"
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-teal">
                    {eventSummary(lang, e)}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-overlay0">
                    {e.blocks.length} · {e.id}
                  </span>
                </div>
                <div className="space-y-1">
                  {e.blocks.map((b, i) => (
                    <BlockRow key={i} owner={owner as EventOwner} eventId={e.id} index={i} block={b} path={leaf.path} />
                  ))}
                </div>
                {!locked && (
                  <div className="flex flex-wrap items-center gap-1 px-0.5 pt-1.5">
                    <span className="font-mono text-[10px] text-overlay0">{t(lang, "ev.add_block")}</span>
                    {OPS.map((op) => (
                      <button
                        key={op}
                        onClick={() => commitAddBlock(e.id, op)}
                        className="rounded-md bg-surface0 px-1.5 py-0.5 font-mono text-[10px] text-subtext0 transition-colors hover:bg-surface1 hover:text-text"
                      >
                        +{t(lang, `ev.op_${op}`)}
                      </button>
                    ))}
                  </div>
                )}
                {preview && (
                  <pre className="mt-1.5 max-h-28 overflow-auto rounded-md border border-surface0 bg-crust p-1.5 font-mono text-[10px] leading-relaxed text-subtext0">
                    {preview.join("\n") || t(lang, "ev.no_blocks")}
                  </pre>
                )}
              </div>
            );
          })}
          {!locked && (
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-dashed border-surface1 px-2 py-1.5">
              <select
                aria-label={t(lang, "ev.trigger")}
                value={newTrigger}
                onChange={(e) => setNewTrigger(e.target.value as EventTrigger)}
                className="select select-sm"
              >
                {TRIGGERS.map((tr) => (
                  <option key={tr} value={tr}>
                    {triggerLabel(lang, tr)}
                  </option>
                ))}
              </select>
              {newTrigger === "key" && (
                <span className="min-w-0 flex-1">
                  <KeyPicker value={newKey} onChange={setNewKey} />
                </span>
              )}
              {newTrigger === "collide" && (
                <select
                  aria-label={t(lang, "ev.target")}
                  value={newTarget}
                  onChange={(e) => setNewTarget(e.target.value)}
                  className="select select-sm min-w-0 flex-1"
                >
                  {["any", "solid", "player", "movable", ...(project.objectDefs ?? []).map((d) => `def:${d.id}`)].map(
                    (tg) => (
                      <option key={tg} value={tg}>
                        {tg}
                      </option>
                    ),
                  )}
                </select>
              )}
              <button
                onClick={commitAddEvent}
                className="inline-flex shrink-0 items-center gap-1 rounded-md bg-surface0 px-2 py-1 font-mono text-[11px] transition-colors hover:bg-surface1"
              >
                <Plus size={12} /> {t(lang, "ev.add_event")}
              </button>
            </div>
          )}
          {!locked && (
            <div className="space-y-1.5 rounded-lg border border-surface0/70 p-1.5">
              <p className="px-0.5 font-mono text-[10px] uppercase tracking-widest text-subtext0">
                {t(lang, "logic.exec")}
              </p>
              <label className="block">
                <span className="mb-0.5 block font-mono text-[10px] text-subtext0">
                  tick{leaf.def ? ` · ${leaf.def}` : ""}
                </span>
                <textarea
                  value={tickText}
                  onChange={(e) => setTick(e.target.value)}
                  spellCheck={false}
                  rows={2}
                  placeholder={t(lang, "insp.tick_ph")}
                  className="w-full resize-y rounded-md border border-surface1 bg-base p-1.5 font-mono text-[11px] leading-relaxed outline-none placeholder:text-overlay0 focus:border-mauve"
                />
              </label>
              <label className="block">
                <span className="mb-0.5 block font-mono text-[10px] text-subtext0">
                  {t(lang, "insp.init")}
                </span>
                <textarea
                  value={initText}
                  onChange={(e) => setInit(e.target.value)}
                  spellCheck={false}
                  rows={2}
                  placeholder={t(lang, "insp.init_ph")}
                  className="w-full resize-y rounded-md border border-surface1 bg-base p-1.5 font-mono text-[11px] leading-relaxed outline-none placeholder:text-overlay0 focus:border-mauve"
                />
              </label>
              <pre className="max-h-20 overflow-auto rounded-md border border-surface0 bg-crust p-1.5 font-mono text-[10px] leading-relaxed text-subtext0">
                {previewBlocks(
                  [
                    ...(tickText ? [{ op: "code", code: tickText } as Block] : []),
                    ...(initText ? [{ op: "code", code: initText } as Block] : []),
                  ],
                  { slot: "slot", w: project.width, h: project.height, sounds: soundMap(project) },
                ).join("\n") || t(lang, "ev.no_blocks")}
              </pre>
            </div>
          )}
          {def && <p className="px-0.5 font-mono text-[10px] text-teal/80">{t(lang, "ev.instance_note")}</p>}
        </div>
      )}
    </div>
  );
}

/* Logic-graph layer: every object of the current scene as a dark
   node (left), every scene as a jump chip (right), event ports and
   child blocks wired with measured cubic beziers. Goto blocks draw
   edges to their target scene chips. */
export default function LogicGraphLayer() {
  const lang = useLang();
  const project = useStore(projectStore);
  const sceneId = useStore(sceneIdStore);
  const contentRef = useRef<HTMLDivElement>(null);
  const [wires, setWires] = useState<Array<{ d: string; kind: "chain" | "goto" }>>([]);

  const scene = currentScene(project, sceneId);
  const leaves: FlatLeaf[] = (() => {
    try {
      return flattenScene(project, scene.id);
    } catch {
      return [];
    }
  })();

  // Wire pairs, derived purely from data; measured after paint.
  const pairs: Array<{ from: string; to: string; kind: "chain" | "goto" }> = [];
  for (const o of leaves) {
    if (o.path.includes("/")) continue;
    for (const e of o.events) {
      e.blocks.forEach((b, i) => {
        pairs.push({
          from: i === 0 ? `port:${o.path}:${e.id}` : `bin:${o.path}:${e.id}:${i - 1}`,
          to: `bin:${o.path}:${e.id}:${i}`,
          kind: "chain",
        });
        if (b.op === "goto") pairs.push({ from: `bin:${o.path}:${e.id}:${i}`, to: `scene:${b.scene}`, kind: "goto" });
      });
    }
  }

  useLayoutEffect(() => {
    const top = contentRef.current;
    if (!top) return;
    const out: Array<{ d: string; kind: "chain" | "goto" }> = [];
    for (const p of pairs) {
      const a = top.querySelector(`[data-anchor="${CSS.escape(p.from)}"]`) as HTMLElement | null;
      const b = top.querySelector(`[data-anchor="${CSS.escape(p.to)}"]`) as HTMLElement | null;
      if (!a || !b) continue;
      const [x1, y1] = anchorCenter(a, top);
      const [x2, y2] = anchorCenter(b, top);
      out.push({ d: bezier(x1, y1, x2, y2), kind: p.kind });
    }
    setWires(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, sceneId]);

  return (
    <div>
      <p className="mb-2 font-mono text-[11px] uppercase tracking-widest text-subtext0">
        {t(lang, "logic.objects")} · <span className="text-mauve">{sceneId}</span>
      </p>
      {leaves.length === 0 ? (
        <p className="rounded-lg border border-dashed border-surface1 px-3 py-4 text-center text-[13px] text-subtext0">
          {t(lang, "logic.empty")}
        </p>
      ) : (
        <div ref={contentRef} className="relative">
          <svg className="pointer-events-none absolute inset-0 z-0 size-full">
            {wires.map((w, i) => (
              <path
                key={i}
                d={w.d}
                fill="none"
                stroke={w.kind === "goto" ? "var(--ctp-mauve)" : "var(--ctp-teal)"}
                strokeOpacity={w.kind === "goto" ? 0.8 : 0.45}
                strokeWidth="1.5"
              />
            ))}
          </svg>
          <div className="relative z-10 flex items-start gap-4">
            <div className="min-w-0 max-w-2xl flex-1 space-y-3">
              {leaves.map((o) => (
                <ObjectNode key={o.path} leaf={o} />
              ))}
            </div>
            <div data-nopan className="w-40 shrink-0 space-y-1.5">
              <p className="font-mono text-[10px] uppercase tracking-widest text-subtext0">
                {t(lang, "logic.scenes")}
              </p>
              {project.scenes.map((s) => (
                <button
                  key={s.id}
                  onClick={() => sceneIdStore.set(s.id)}
                  className={`flex w-full items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-left font-mono text-[11px] transition-colors ${
                    s.id === sceneId
                      ? "border-mauve/50 bg-mauve/10 text-mauve"
                      : "border-surface0 bg-mantle/90 text-subtext0 hover:text-text"
                  }`}
                >
                  <span data-anchor={`scene:${s.id}`} className="grid size-2.5 shrink-0 place-items-center rounded-full bg-mauve/70" />
                  <span className="truncate">{s.id}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
