import { useMemo, useState } from "react";
import { useStore } from "@nanostores/react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { previewOwnerEvent, type Block, type EventTrigger, type ObjectEvent } from "../lib/project";
import {
  addBlock,
  addEvent,
  currentScene,
  deleteBlock,
  deleteEvent,
  moveBlock,
  patchBlock,
  patchDef,
  patchObject,
  projectStore,
  sceneIdStore,
  type EventOwner,
} from "../lib/store";
import { t, useLang } from "../lib/i18n";
import KeyPicker from "./KeyPicker";

const TRIGGERS: EventTrigger[] = ["create", "step", "destroy", "key", "collide", "click", "alarm"];
const OPS = ["move", "set_pos", "play", "goto", "destroy", "wait"] as const;

function triggerLabel(lang: ReturnType<typeof useLang>, t_: EventTrigger): string {
  return t(lang, `ev.trigger_${t_}`);
}

function eventSummary(lang: ReturnType<typeof useLang>, e: ObjectEvent): string {
  if (e.trigger === "key") return `${triggerLabel(lang, "key")} ${e.key ?? ""}`;
  if (e.trigger === "collide") return `${triggerLabel(lang, "collide")} ${e.target ?? ""}`;
  return triggerLabel(lang, e.trigger);
}

/* One block row: op-specific compact editors + reorder + delete.
   No forks in v1 (no if blocks) — a straight vertical stack. */
function BlockRow({
  owner,
  eventId,
  index,
  block,
}: {
  owner: EventOwner;
  eventId: string;
  index: number;
  block: Block;
}) {
  const lang = useLang();
  const project = useStore(projectStore);
  const num = (v: number, fn: (n: number) => void, min?: number, max?: number, w = "w-14") => (
    <input
      type="number"
      value={v}
      min={min}
      max={max}
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
      <>
        {num(block.voice, (voice) => set({ voice }), 0, 3, "w-12")}
        {num(block.note, (note) => set({ note }), 0, 107)}
        {num(block.vol, (vol) => set({ vol }), 0, 255)}
      </>
    ) : block.op === "goto" ? (
      <select
        value={block.scene}
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
    ) : (
      <span className="font-mono text-[11px] text-subtext0">{t(lang, "ev.destroy_self")}</span>
    );
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-surface0 bg-base px-2 py-1.5">
      <span className="w-16 shrink-0 font-mono text-[11px] text-teal">{t(lang, `ev.op_${block.op}`)}</span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5">{fields}</span>
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
    </div>
  );
}

/* Center of the events view: pick an owner (scene leaf or template),
   manage its event list, edit the selected event's block stack with
   a live ETAL preview. The canvas keeps showing the scene — script
   with WYSIWYG beside it. */
export default function EventPanel() {
  const lang = useLang();
  const project = useStore(projectStore);
  const sceneId = useStore(sceneIdStore);
  const [ownerKey, setOwnerKey] = useState("");
  const [eventId, setEventId] = useState<string | null>(null);
  const [newTrigger, setNewTrigger] = useState<EventTrigger>("step");
  const [newKey, setNewKey] = useState("");
  const [newTarget, setNewTarget] = useState("any");

  const scene = currentScene(project, sceneId);
  const leaves = scene.nodes.filter((o) => !o.scene);
  const defs = project.objectDefs ?? [];
  const owner: EventOwner | null = useMemo(() => {
    if (ownerKey.startsWith("def:")) {
      const id = ownerKey.slice(4);
      return defs.some((d) => d.id === id) ? { def: id } : null;
    }
    if (ownerKey.startsWith("leaf:")) {
      const id = ownerKey.slice(5);
      return leaves.some((o) => o.id === id) ? { leaf: id } : null;
    }
    const first = leaves[0]?.id ? `leaf:${leaves[0].id}` : defs[0] ? `def:${defs[0].id}` : "";
    if (first.startsWith("def:")) return { def: first.slice(4) };
    if (first.startsWith("leaf:")) return { leaf: first.slice(5) };
    return null;
  }, [ownerKey, leaves, defs]);
  const resolvedKey =
    owner && "def" in owner
      ? `def:${owner.def}`
      : owner && "leaf" in owner
        ? `leaf:${owner.leaf}`
        : "";

  const events: ObjectEvent[] = useMemo(() => {
    if (!owner) return [];
    if ("def" in owner) return defs.find((d) => d.id === owner.def)?.events ?? [];
    const node = scene.nodes.find((o) => o.id === owner.leaf && !o.scene);
    if (!node || node.def) return [];
    return node.events ?? [];
  }, [owner, defs, scene]);
  const event = events.find((e) => e.id === eventId) ?? null;
  const ownerIsInstance = !!owner && "leaf" in owner && !!scene.nodes.find((o) => o.id === owner.leaf)?.def;

  const preview = useMemo(() => {
    if (!owner || !event) return null;
    return previewOwnerEvent(
      project,
      sceneId,
      "def" in owner ? { def: owner.def } : { leaf: owner.leaf },
      event.id,
    );
  }, [project, sceneId, owner, event]);

  function pickOwner(key: string) {
    setOwnerKey(key);
    setEventId(null);
  }

  function commitAddEvent() {
    if (!owner) return;
    const id = addEvent(
      owner,
      newTrigger,
      newTrigger === "key"
        ? { key: newKey || project.inputs[0]?.id }
        : newTrigger === "collide"
          ? { target: newTarget }
          : undefined,
    );
    if (id) setEventId(id);
  }

  function commitAddBlock(op: (typeof OPS)[number]) {
    if (!owner || !event) return;
    const base: Record<string, number | string> = {};
    if (op === "goto") base["scene"] = project.scenes[0]?.id ?? "";
    if (op === "play") {
      base["voice"] = 0;
      base["note"] = 72;
      base["vol"] = 120;
    }
    if (op === "wait") base["ticks"] = 30;
    addBlock(owner, event.id, { op, ...base } as Block);
  }

  const tickText =
    !owner || !event || event.trigger !== "step"
      ? ""
      : "def" in owner
        ? (defs.find((d) => d.id === owner.def)?.tick ?? "")
        : (scene.nodes.find((o) => o.id === owner.leaf)?.tick ?? "");
  const setTick = (code: string) => {
    if (!owner) return;
    const v = code || undefined;
    if ("def" in owner) patchDef(owner.def, { tick: v });
    else patchObject(owner.leaf, { tick: v });
  };

  return (
    <div>
      <label className="block">
        <span className="mb-1 block font-mono text-[11px] uppercase tracking-widest text-subtext0">
          {t(lang, "ev.owner")} · <span className="text-mauve">{scene.id}</span>
        </span>
        <select value={resolvedKey} onChange={(e) => pickOwner(e.target.value)} className="select w-full">
          <optgroup label={t(lang, "ev.leaves")}>
            {leaves.map((o) => (
              <option key={o.id} value={`leaf:${o.id}`}>
                {o.id}
                {o.def ? ` (${o.def})` : ""}
              </option>
            ))}
          </optgroup>
          {defs.length > 0 && (
            <optgroup label={t(lang, "assets.title")}>
              {defs.map((d) => (
                <option key={d.id} value={`def:${d.id}`}>
                  {d.id}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>

      {!owner ? (
        <p className="mt-2 rounded-lg border border-dashed border-surface1 px-3 py-4 text-center text-[13px] text-subtext0">
          {t(lang, "ev.no_owner")}
        </p>
      ) : ownerIsInstance ? (
        <p className="mt-2 rounded-lg border border-teal/30 bg-teal/5 px-3 py-2.5 text-[13px] text-teal">
          {t(lang, "ev.instance_note")}
        </p>
      ) : (
        <div className="mt-2 space-y-1.5">
          {events.length === 0 && (
            <p className="rounded-lg border border-dashed border-surface1 px-3 py-3 text-center text-[13px] text-subtext0">
              {t(lang, "ev.none")}
            </p>
          )}
          {events.map((e) => (
            <div
              key={e.id}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${
                event?.id === e.id ? "border-mauve/50 bg-mauve/10" : "border-surface0"
              }`}
            >
              <button onClick={() => setEventId(e.id)} className="min-w-0 flex-1 truncate text-left text-[13px]">
                <span className="font-mono text-[11px] text-teal">{eventSummary(lang, e)}</span>{" "}
                <span className="font-mono text-[10px] text-overlay0">
                  {e.blocks.length} · {e.id}
                </span>
              </button>
              <button
                onClick={() => {
                  if (eventId === e.id) setEventId(null);
                  deleteEvent(owner, e.id);
                }}
                aria-label={`${t(lang, "ev.delete_event")} ${e.id}`}
                className="grid size-6 shrink-0 place-items-center rounded text-subtext0 hover:bg-surface0 hover:text-red"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <select
              aria-label={t(lang, "ev.trigger")}
              value={newTrigger}
              onChange={(e) => setNewTrigger(e.target.value as EventTrigger)}
              className="select"
            >
              {TRIGGERS.map((tr) => (
                <option key={tr} value={tr}>
                  {triggerLabel(lang, tr)}
                </option>
              ))}
            </select>
            <span className="min-w-0 flex-1">
              {newTrigger === "key" ? (
                <KeyPicker value={newKey} onChange={setNewKey} />
              ) : newTrigger === "collide" ? (
                <select
                  aria-label={t(lang, "ev.target")}
                  value={newTarget}
                  onChange={(e) => setNewTarget(e.target.value)}
                  className="select w-full"
                >
                  {["any", "solid", "player", "movable", ...defs.map((d) => `def:${d.id}`)].map((t_) => (
                    <option key={t_} value={t_}>
                      {t_}
                    </option>
                  ))}
                </select>
              ) : null}
            </span>
            <button
              onClick={commitAddEvent}
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-surface0 px-2 py-1 font-mono text-[11px] transition-colors hover:bg-surface1"
            >
              <Plus size={12} /> {t(lang, "ev.add_event")}
            </button>
          </div>

          {event && (
            <div className="space-y-1.5 rounded-lg border border-surface0 p-2">
              <p className="font-mono text-[11px] text-subtext0">
                <span className="text-teal">{eventSummary(lang, event)}</span> · {event.id}
              </p>
              {event.blocks.map((b, i) => (
                <BlockRow key={i} owner={owner} eventId={event.id} index={i} block={b} />
              ))}
              <div className="flex flex-wrap items-center gap-1">
                <span className="font-mono text-[10px] text-overlay0">{t(lang, "ev.add_block")}</span>
                {OPS.map((op) => (
                  <button
                    key={op}
                    onClick={() => commitAddBlock(op)}
                    className="rounded-md bg-surface0 px-1.5 py-0.5 font-mono text-[11px] text-subtext0 transition-colors hover:bg-surface1 hover:text-text"
                  >
                    +{t(lang, `ev.op_${op}`)}
                  </button>
                ))}
              </div>
              {preview && (
                <pre className="max-h-40 overflow-auto rounded-lg border border-surface0 bg-crust p-2 font-mono text-[10px] leading-relaxed text-subtext0">
                  {preview.join("\n") || t(lang, "ev.no_blocks")}
                </pre>
              )}
              {event.trigger === "step" && (
                <label className="block">
                  <span className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-subtext0">
                    {t(lang, "ev.code_hatch")}
                  </span>
                  <textarea
                    value={tickText}
                    onChange={(e) => setTick(e.target.value)}
                    spellCheck={false}
                    rows={2}
                    placeholder={t(lang, "insp.tick_ph")}
                    className="w-full resize-y rounded-lg border border-surface1 bg-base p-2 font-mono text-[11px] leading-relaxed outline-none placeholder:text-overlay0 focus:border-mauve"
                  />
                </label>
              )}
            </div>
          )}
        </div>
      )}
      <p className="mt-2 font-mono text-[10px] leading-relaxed text-overlay0">{t(lang, "ev.hint")}</p>
    </div>
  );
}
