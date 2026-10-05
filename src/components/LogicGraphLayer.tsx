import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@nanostores/react";
import { ArrowDown, ArrowUp, Code2, Plus, Trash2 } from "lucide-react";
import { KIND_ICON } from "./HierarchyPanel";
import { SpriteThumb } from "./SpritePicker";
import { testTone } from "./SoundMixer";
import { t, useLang, type Lang } from "../lib/i18n";
import {
  flattenScene,
  previewOwnerEvent,
  type Block,
  type EventTrigger,
  type FlatLeaf,
  type ObjectEvent,
  type Project,
} from "../lib/project";
import {
  addBlock,
  addEvent,
  addSnippet,
  addSound,
  codeFileStore,
  convertBlockToSnippet,
  currentScene,
  deleteBlock,
  deleteObject,
  moveBlock,
  objectNodePos,
  patchBlock,
  patchDef,
  patchObject,
  projectStore,
  sceneIdStore,
  selectionStore,
  setObjectNodePos,
  snippetSelStore,
  soundSelStore,
  viewStore,
  viewportStore,
  type EventOwner,
} from "../lib/store";

const OPS = ["move", "set_pos", "sprite", "show", "hide", "play", "goto", "destroy", "wait", "run", "button"] as const;
/** Add-palette grouped by what the block does. `code` (legacy
    inline ETAL) is deliberately absent — convert it to a snippet +
    run block instead. Menus are button labels + click/key events +
    goto scene chains (see corpus); no interpreter lives in the ROM. */
export const PALETTE: Array<{ group: string; ops: Array<(typeof OPS)[number]> }> = [
  { group: "ev.cat_move", ops: ["move", "set_pos"] },
  { group: "ev.cat_art", ops: ["sprite", "show", "hide"] },
  { group: "ev.cat_sound", ops: ["play"] },
  { group: "ev.cat_flow", ops: ["goto", "wait", "destroy"] },
  { group: "ev.cat_code", ops: ["run"] },
  { group: "ev.cat_note", ops: ["button"] },
];

/** Valid-by-construction defaults for a fresh block: move nudges a
    tile, set_pos keeps the leaf's place, sprite keeps current art,
    play/run name the first library entry (templating one when
    empty), goto the first scene, wait one beat. Shared by the node
    palette and the inspector. */
export function defaultBlockFor(
  p: Project,
  op: (typeof OPS)[number],
  at?: { x: number; y: number },
  soundName = "sfx",
  snippetName = "snippet",
  spriteId?: string,
): Block {
  if (op === "goto") return { op, scene: p.scenes[0]?.id ?? "" };
  if (op === "play") return { op, sound: p.sounds?.[0]?.id ?? addSound(soundName) };
  if (op === "wait") return { op, ticks: 30 };
  if (op === "run") return { op, snippet: p.snippets?.[0]?.id ?? addSnippet(snippetName) };
  if (op === "move") return { op, dx: 8, dy: 0 };
  if (op === "set_pos") return { op, x: at?.x ?? 8, y: at?.y ?? 8 };
  if (op === "sprite") return { op, sprite: spriteId ?? p.sprites[0]?.id ?? "hero" };
  if (op === "show") return { op };
  if (op === "hide") return { op };
  if (op === "button") return { op, label: "button", action: "" };
  return { op: "destroy" };
}

function triggerLabel(lang: Lang, t_: EventTrigger): string {
  return t(lang, `ev.trigger_${t_}`);
}

export function eventSummary(lang: Lang, e: ObjectEvent): string {
  if (e.trigger === "key") return `${triggerLabel(lang, "key")} ${e.key ?? ""}`;
  if (e.trigger === "collide") return `${triggerLabel(lang, "collide")} ${e.target ?? ""}`;
  return triggerLabel(lang, e.trigger);
}

/* Direction-aware cubic: horizontal tangents when the edge runs
   left-to-right (or right-to-left), vertical tangents when it runs
   mostly up-down. Control points always lean TOWARD the other end,
   so curves never bulge past either block. */
function bezier(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const s = dx >= 0 ? 1 : -1;
    const m = Math.max(24, Math.abs(dx) / 2);
    return `M ${x1} ${y1} C ${x1 + m * s} ${y1}, ${x2 - m * s} ${y2}, ${x2} ${y2}`;
  }
  const s = dy >= 0 ? 1 : -1;
  const m = Math.max(24, Math.abs(dy) / 2);
  return `M ${x1} ${y1} C ${x1} ${y1 + m * s}, ${x2} ${y2 - m * s}, ${x2} ${y2}`;
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

/** Object-to-object relation targets of a collide event: the leaf
    paths it can hit. Broad targets on busy scenes show a count chip
    instead of wires (see the caps in the graph layer). */
function collidePaths(leaves: FlatLeaf[], self: string, target: string): string[] {
  const others = leaves.filter((l) => !l.path.includes("/") && l.path !== self);
  if (target === "any") return others.map((l) => l.path);
  if (target === "player") return others.filter((l) => l.kind === "player").map((l) => l.path);
  if (target === "movable") return others.filter((l) => l.kind === "movable").map((l) => l.path);
  if (target === "solid") return others.filter((l) => l.solid).map((l) => l.path);
  if (target.startsWith("def:")) {
    const id = target.slice(4);
    return others.filter((l) => l.def === id).map((l) => l.path);
  }
  return [];
}

/* One block row: op-specific compact editors + reorder + delete.
   `run` connects a Code-page snippet (the replacement for inline
   ETAL); legacy `code` renders read-only with a convert button.
   `play` shows its trigger context (the event IS the condition —
   a play in a key event fires on that key) plus audition + jump.
   `button` is a labeled annotation (comment-only; menus are button
   labels + click/key events + goto scene chains). */
function BlockRow({
  owner,
  eventId,
  index,
  block,
  path,
  eventLabel,
}: {
  owner: EventOwner;
  eventId: string;
  index: number;
  block: Block;
  path: string;
  eventLabel: string;
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
  const set = (patch: Record<string, number | string | undefined>) => patchBlock(owner, eventId, index, patch);
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
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span title={eventLabel} className="max-w-28 shrink-0 truncate rounded-md bg-surface0 px-1.5 py-1 font-mono text-[10px] text-teal">
          {eventLabel}
        </span>
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
        {!locked && (
          <>
            <button
              onClick={() => {
                const snd = (project.sounds ?? []).find((s) => s.id === block.sound);
                const v = snd?.voices.find((x) => x.vol > 0);
                if (v) testTone(v.note);
              }}
              title={t(lang, "sound.test")}
              aria-label={t(lang, "sound.test")}
              className="grid size-6 shrink-0 place-items-center rounded-md text-subtext0 transition-colors hover:bg-surface0 hover:text-text"
            >
              ▶
            </button>
            <button
              onClick={() => {
                soundSelStore.set(block.sound);
                viewStore.set("sound");
              }}
              title={t(lang, "studio.open_sound")}
              aria-label={t(lang, "studio.open_sound")}
              className="grid size-6 shrink-0 place-items-center rounded-md font-mono text-[10px] text-subtext0 transition-colors hover:bg-surface0 hover:text-text"
            >
              ♪
            </button>
          </>
        )}
      </span>
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
    ) : block.op === "sprite" ? (
      <select
        value={(project.sprites ?? []).some((s) => s.id === block.sprite) ? block.sprite : ""}
        disabled={locked}
        onChange={(e) => set({ sprite: e.target.value })}
        className="select min-w-0 flex-1"
      >
        {(project.sprites ?? []).map((s) => (
          <option key={s.id} value={s.id}>
            {s.id}
          </option>
        ))}
      </select>
    ) : block.op === "destroy" ? (
      <select
        value={block.target ?? "self"}
        disabled={locked}
        onChange={(e) => set({ target: e.target.value === "self" ? undefined : e.target.value })}
        className="select min-w-0 flex-1"
      >
        {["self", "any", "solid", "player", "movable", ...(project.objectDefs ?? []).map((d) => `def:${d.id}`)].map((tg) => (
          <option key={tg} value={tg}>
            {tg}
          </option>
        ))}
      </select>
    ) : block.op === "wait" ? (
      <>{num(block.ticks, (ticks) => set({ ticks }), 1, 255)}</>
    ) : block.op === "code" ? (
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <pre className="max-h-16 min-w-0 flex-1 overflow-auto rounded-md border border-surface0 bg-crust p-1.5 font-mono text-[10px] leading-relaxed text-subtext0">
          {block.code}
        </pre>
        {!locked && (
          <button
            onClick={() => convertBlockToSnippet(owner, eventId, index)}
            title={t(lang, "ev.convert_snippet")}
            className="shrink-0 rounded-md bg-surface0 px-2 py-1 font-mono text-[10px] transition-colors hover:bg-surface1 hover:text-text"
          >
            {t(lang, "ev.convert_snippet")}
          </button>
        )}
      </span>
    ) : block.op === "run" ? (
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <select
          value={(project.snippets ?? []).some((s) => s.id === block.snippet) ? block.snippet : ""}
          disabled={locked}
          onChange={(e) => set({ snippet: e.target.value })}
          className="select min-w-0 flex-1"
        >
          {(project.snippets ?? []).length === 0 && <option value="">{t(lang, "ev.no_snippets")}</option>}
          {(project.snippets ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.id}
            </option>
          ))}
        </select>
        {!locked && (
          <>
            <button
              onClick={() => {
                const id = addSnippet("snippet");
                set({ snippet: id });
              }}
              title={t(lang, "ev.new_snippet")}
              aria-label={t(lang, "ev.new_snippet")}
              className="grid size-6 shrink-0 place-items-center rounded-md text-subtext0 transition-colors hover:bg-surface0 hover:text-text"
            >
              <Plus size={12} />
            </button>
            <button
              onClick={() => {
                snippetSelStore.set(block.snippet);
                codeFileStore.set("main.ux");
                viewStore.set("code");
              }}
              title={t(lang, "studio.open_code")}
              aria-label={t(lang, "studio.open_code")}
              className="grid size-6 shrink-0 place-items-center rounded-md text-subtext0 transition-colors hover:bg-surface0 hover:text-text"
            >
              <Code2 size={12} />
            </button>
          </>
        )}
      </span>
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
      <span className="font-mono text-[11px] text-subtext0">{t(lang, block.op === "show" ? "ev.show_self" : block.op === "hide" ? "ev.hide_self" : "ev.destroy_self")}</span>
    );
  return (
    <div
      data-bidx={index}
      draggable={!locked}
      onDragStart={(e) => {
        if ((e.target as HTMLElement).closest("input,select,textarea,button")) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("application/x-block-move", JSON.stringify({ owner, eventId, index, block }));
      }}
      className="relative flex items-center gap-1.5 rounded-lg border border-surface0 bg-crust/70 px-2 py-1.5"
    >
      <span
        data-anchor={`bin:${path}:${eventId}:${index}`}
        className="grid size-3 shrink-0 place-items-center rounded-full bg-teal/60"
      />
      <span title={t(lang, "logic.drag_block")} className="shrink-0 cursor-grab font-mono text-[10px] text-overlay0 active:cursor-grabbing">
        ⋮⋮
      </span>
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

/* One object = one dark node: header (art + kind + count, with
   delete for top-level inline leaves), event ports with child block
   stacks wired by beziers, then collapsed legacy scripts. Events
   and blocks are created in the Blocks inspector — nodes display
   and edit what exists. Def instances edit the template's events;
   nested leaves are read-only with a jump home. */
function ObjectNode({ leaf, pos }: { leaf: FlatLeaf; pos: { x: number; y: number } }) {
  const lang = useLang();
  const project = useStore(projectStore);
  const sceneId = useStore(sceneIdStore);
  const selection = useStore(selectionStore);

  const locked = !!project.locked;
  const topLevel = !leaf.path.includes("/");
  const def = leaf.def ? (project.objectDefs ?? []).find((d) => d.id === leaf.def) : undefined;
  const owner: EventOwner | null = !topLevel ? null : leaf.def ? { def: leaf.def } : { leaf: leaf.id };
  const events: ObjectEvent[] = leaf.events ?? [];
  const Icon = KIND_ICON[leaf.kind] ?? KIND_ICON.static;
  const selected = selection === leaf.path;
  const previewOwner = leaf.def ? { def: leaf.def } : { leaf: leaf.path };
  const [drop, setDrop] = useState<{ eventId: string; index: number | null } | null>(null);
  useEffect(() => {
    const clear = () => setDrop(null);
    window.addEventListener("dragend", clear);
    return () => window.removeEventListener("dragend", clear);
  }, []);

  /** Drop position inside an event stack: the row under the cursor
      (insert before it) or the end. Reads HTML5 payloads from block
      rows (move) and the inspector palette (new). */
  function dropPayload(e: React.DragEvent): { kind: "move"; owner: EventOwner; eventId: string; index: number; block: Block } | { kind: "new"; op: string } | null {
    const types = e.dataTransfer.types;
    try {
      if (types.includes("application/x-block-move")) {
        const raw = JSON.parse(e.dataTransfer.getData("application/x-block-move")) as {
          owner: EventOwner;
          eventId: string;
          index: number;
          block: Block;
        };
        if (raw && raw.block && typeof raw.index === "number") return { kind: "move", ...raw };
      }
      if (types.includes("application/x-block-new")) {
        const raw = JSON.parse(e.dataTransfer.getData("application/x-block-new")) as { op: string };
        if (raw && typeof raw.op === "string") return { kind: "new", op: raw.op };
      }
    } catch {
      /* malformed payload — ignore */
    }
    return null;
  }

  function dropIndex(e: React.DragEvent, el: HTMLElement): number | null {
    const row = (e.target as HTMLElement).closest("[data-bidx]");
    if (row && el.contains(row)) {
      const n = Number(row.getAttribute("data-bidx"));
      if (Number.isInteger(n)) return n;
    }
    return null;
  }

  function commitDrop(e: React.DragEvent, eventId: string) {
    e.preventDefault();
    setDrop(null);
    if (!owner || locked) return;
    const payload = dropPayload(e);
    if (!payload) return;
    if (payload.kind === "new") {
      if (!(["move", "set_pos", "sprite", "show", "hide", "play", "goto", "destroy", "wait", "run", "button"] as string[]).includes(payload.op)) return;
      addBlock(owner, eventId, defaultBlockFor(project, payload.op as Parameters<typeof defaultBlockFor>[1], { x: leaf.x, y: leaf.y }, t(lang, "sound.default_name"), "snippet", leaf.sprite));
      return;
    }
    const at = dropIndex(e, e.currentTarget as HTMLElement);
    const dst = at ?? events.find((x) => x.id === eventId)?.blocks.length ?? 0;
    const same =
      ("def" in payload.owner && owner && "def" in owner && payload.owner.def === owner.def) ||
      ("leaf" in payload.owner && owner && "leaf" in owner && payload.owner.leaf === owner.leaf);
    if (same && payload.eventId === eventId) {
      if (payload.index === dst || payload.index + 1 === dst) return;
      const shifted = payload.index < dst ? dst - 1 : dst;
      deleteBlock(payload.owner, payload.eventId, payload.index);
      addBlock(owner, eventId, payload.block, shifted);
    } else {
      addBlock(owner, eventId, payload.block, dst);
      deleteBlock(payload.owner, payload.eventId, payload.index);
    }
  }

  const tickText = leaf.tick ?? "";
  const initText = leaf.initCode ?? "";

  /** Object-to-object relation targets of a collide event: the leaf
      paths it can hit. Capped — broad targets on busy scenes show a
      count chip on the port instead of spaghetti. */
  function collideHitCount(self: string, target: string): number {
    try {
      return collidePaths(flattenScene(project, sceneId), self, target).length;
    } catch {
      return 0;
    }
  }

  /** Move a legacy script (tick/initCode text) into the snippet
      library + a run block on the matching event (step/create),
      keeping the emitted bytes identical. */
  function convertLegacy(which: "tick" | "init") {
    if (!owner) return;
    const text = which === "tick" ? tickText : initText;
    if (!text.trim()) return;
    const id = addSnippet(which === "tick" ? "tick" : "spawn", text);
    const trigger = which === "tick" ? "step" : "create";
    let ev = events.find((e) => e.trigger === trigger)?.id ?? null;
    if (!ev) ev = addEvent(owner, trigger as EventTrigger);
    if (!ev) return;
    if (!addBlock(owner, ev, { op: "run", snippet: id })) return;
    if (which === "tick") {
      if (leaf.def) patchDef(leaf.def, { tick: undefined });
      else patchObject(leaf.id, { tick: undefined });
    } else {
      patchObject(leaf.id, { initCode: undefined });
    }
  }

  /** Free-canvas drag: the node follows the pointer (zoom-aware) and
      commits its block position on release — it stays where left. */
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const nodeDrag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const at = dragPos ?? pos;
  function onNodeDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button,[role='button'],select,input,textarea,a")) return;
    nodeDrag.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onNodeMove(e: React.PointerEvent) {
    const d = nodeDrag.current;
    if (!d) return;
    const k = viewportStore.get().k;
    setDragPos({ x: d.ox + (e.clientX - d.sx) / k, y: d.oy + (e.clientY - d.sy) / k });
  }
  function onNodeUp() {
    const d = nodeDrag.current;
    nodeDrag.current = null;
    if (!d) return;
    if (dragPos) setObjectNodePos(sceneId, leaf.path, dragPos.x, dragPos.y);
    setDragPos(null);
  }

  /** Quick-add: first unused trigger moment for this object (key
      takes the first named input, collide matches anything). */
  function quickAddEvent() {
    if (!owner || locked) return;
    const used = new Set(events.map((e) => e.trigger));
    const next = (["create", "step", "destroy", "key", "collide", "click", "alarm"] as EventTrigger[]).find(
      (tr) => !used.has(tr),
    );
    if (!next) return;
    addEvent(
      owner,
      next,
      next === "key" ? { key: project.inputs[0]?.id } : next === "collide" ? { target: "any" } : undefined,
    );
  }
  const canQuickAdd = !!owner && !locked && events.length < 7;

  return (
    <div
      data-nopan
      className="absolute"
      style={{ left: at.x, top: at.y, width: 400, touchAction: "none" }}
      onPointerDown={onNodeDown}
      onPointerMove={onNodeMove}
      onPointerUp={onNodeUp}
    >
    <div
      className={`node-card relative cursor-grab rounded-2xl p-2.5 active:cursor-grabbing ${selected ? "border-white/70" : ""}`}
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
        <span data-anchor={`node:${leaf.path}`} className="w-8 shrink-0">
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
        {topLevel && !locked && !leaf.def && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              deleteObject(leaf.id);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                deleteObject(leaf.id);
              }
            }}
            title={t(lang, "hier.delete")}
            aria-label={`${t(lang, "hier.delete")} ${leaf.id}`}
            className="grid size-6 shrink-0 place-items-center rounded-md text-subtext0 transition-colors hover:bg-surface0 hover:text-red"
          >
            <Trash2 size={12} />
          </span>
        )}
        {canQuickAdd && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              quickAddEvent();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                quickAddEvent();
              }
            }}
            title={t(lang, "ev.add_event")}
            aria-label={t(lang, "ev.add_event")}
            className="grid size-6 shrink-0 place-items-center rounded-md text-subtext0 transition-colors hover:bg-surface0 hover:text-text"
          >
            <Plus size={12} />
          </span>
        )}
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
                  {e.trigger === "collide" && e.target && (
                    <span title={t(lang, "logic.hits")} className="shrink-0 rounded-full bg-sky/15 px-1.5 py-0.5 font-mono text-[10px] text-sky">
                      → {collideHitCount(leaf.path, e.target)}
                    </span>
                  )}
                </div>
                <div
                  className="space-y-1"
                  onDragOver={(ev) => {
                    if (!locked && (ev.dataTransfer.types.includes("application/x-block-move") || ev.dataTransfer.types.includes("application/x-block-new"))) {
                      ev.preventDefault();
                      ev.dataTransfer.dropEffect = "move";
                      setDrop({ eventId: e.id, index: dropIndex(ev, ev.currentTarget as HTMLElement) });
                    }
                  }}
                  onDragLeave={() => setDrop((d) => (d && d.eventId === e.id ? null : d))}
                  onDrop={(ev) => commitDrop(ev, e.id)}
                >
                  {drop && drop.eventId === e.id && drop.index === 0 && e.blocks.length > 0 && (
                    <div className="h-0.5 rounded bg-teal" />
                  )}
                  {e.blocks.map((b, i) => (
                    <div key={i}>
                      {drop && drop.eventId === e.id && drop.index === i && <div className="mb-1 h-0.5 rounded bg-teal" />}
                      <BlockRow owner={owner as EventOwner} eventId={e.id} index={i} block={b} path={leaf.path} eventLabel={eventSummary(lang, e)} />
                    </div>
                  ))}
                  {drop && drop.eventId === e.id && (drop.index === null || drop.index >= e.blocks.length) && (
                    <div className="h-0.5 rounded bg-teal" />
                  )}
                  {e.blocks.length === 0 && !locked && (
                    <p className={`rounded-md border border-dashed px-2 py-1.5 text-center font-mono text-[10px] ${drop && drop.eventId === e.id ? "border-teal text-teal" : "border-surface1 text-overlay0"}`}>
                      {t(lang, "ev.drop_block")}
                    </p>
                  )}
                </div>
                {preview && (
                  <pre className="mt-1.5 max-h-28 overflow-auto rounded-md border border-surface0 bg-crust p-1.5 font-mono text-[10px] leading-relaxed text-subtext0">
                    {preview.join("\n") || t(lang, "ev.no_blocks")}
                  </pre>
                )}
              </div>
            );
          })}
          {!locked && events.length === 0 && (
            <p className="rounded-lg border border-dashed border-surface1 px-2.5 py-2 text-center font-mono text-[11px] text-subtext0">
              {t(lang, "ev.none")}
            </p>
          )}
          {(tickText || initText) && (
            <details className="rounded-lg border border-surface0/70 p-1.5">
              <summary className="cursor-pointer px-0.5 font-mono text-[10px] uppercase tracking-widest text-subtext0">
                {t(lang, "logic.legacy")} ({[tickText && "tick", initText && "init"].filter(Boolean).join(" + ")})
              </summary>
              <p className="px-0.5 py-1 font-mono text-[10px] leading-relaxed text-overlay0">
                {t(lang, "logic.legacy_hint")}
              </p>
              {tickText && (
                <div className="mb-1.5">
                  <pre className="max-h-20 overflow-auto rounded-md border border-surface0 bg-crust p-1.5 font-mono text-[10px] leading-relaxed text-subtext0">
                    {tickText}
                  </pre>
                  {!locked && owner && (
                    <button
                      onClick={() => convertLegacy("tick")}
                      className="mt-1 rounded-md bg-surface0 px-2 py-1 font-mono text-[10px] transition-colors hover:bg-surface1 hover:text-text"
                    >
                      {t(lang, "ev.convert_snippet")}
                    </button>
                  )}
                </div>
              )}
              {initText && (
                <div>
                  <pre className="max-h-20 overflow-auto rounded-md border border-surface0 bg-crust p-1.5 font-mono text-[10px] leading-relaxed text-subtext0">
                    {initText}
                  </pre>
                  {!locked && owner && (
                    <button
                      onClick={() => convertLegacy("init")}
                      className="mt-1 rounded-md bg-surface0 px-2 py-1 font-mono text-[10px] transition-colors hover:bg-surface1 hover:text-text"
                    >
                      {t(lang, "ev.convert_snippet")}
                    </button>
                  )}
                </div>
              )}
            </details>
          )}
          {def && <p className="px-0.5 font-mono text-[10px] text-teal/80">{t(lang, "ev.instance_note")}</p>}
        </div>
      )}
    </div>
    </div>
  );
}

/* Objects level of the Blocks canvas: every object of the drilled
   scene is a free block you drag anywhere — it stays where left
   (project.layout). Chain wires run port → blocks inside each node;
   collide events draw dashed edges to the nodes they can hit.
   Creation lives in the Blocks inspector; nodes display and edit. */
export default function LogicGraphLayer() {
  const lang = useLang();
  const project = useStore(projectStore);
  const sceneId = useStore(sceneIdStore);
  const contentRef = useRef<HTMLDivElement>(null);
  const [wires, setWires] = useState<Array<{ d: string; kind: "chain" | "collide" }>>([]);

  const scene = currentScene(project, sceneId);
  const leaves: FlatLeaf[] = (() => {
    try {
      return flattenScene(project, scene.id);
    } catch {
      return [];
    }
  })();
  const top = useMemo(() => leaves.filter((o) => !o.path.includes("/")), [leaves]);
  const positions = useMemo(() => {
    const out = new Map<string, { x: number; y: number }>();
    top.forEach((o, i) => out.set(o.path, objectNodePos(project, sceneId, o.path, i)));
    return out;
  }, [project, sceneId, top]);
  const size = useMemo(() => {
    let w = 900;
    let h = 600;
    for (const p of positions.values()) {
      w = Math.max(w, p.x + 620);
      h = Math.max(h, p.y + 620);
    }
    return { w, h };
  }, [positions]);

  // Wire pairs, derived purely from data; measured after paint.
  const pairs: Array<{ from: string; to: string; kind: "chain" | "collide" }> = [];
  let collideCount = 0;
  for (const o of leaves) {
    if (o.path.includes("/")) continue;
    for (const e of o.events) {
      e.blocks.forEach((_, i) => {
        pairs.push({
          from: i === 0 ? `port:${o.path}:${e.id}` : `bin:${o.path}:${e.id}:${i - 1}`,
          to: `bin:${o.path}:${e.id}:${i}`,
          kind: "chain",
        });
      });
      if (e.trigger === "collide" && e.target) {
        const hits = collidePaths(leaves, o.path, e.target);
        if (hits.length <= 6) {
          for (const h of hits) {
            if (collideCount++ > 24) break;
            pairs.push({ from: `port:${o.path}:${e.id}`, to: `node:${h}`, kind: "collide" });
          }
        }
      }
    }
  }

  useLayoutEffect(() => {
    const top = contentRef.current;
    if (!top) return;
    const out: Array<{ d: string; kind: "chain" | "collide" }> = [];
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
      <p className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] uppercase tracking-widest text-subtext0">
        <span>{t(lang, "logic.objects")} · <span className="text-mauve">{sceneId}</span></span>
        <span className="ml-auto flex items-center gap-2 normal-case tracking-normal">
          <span className="inline-flex items-center gap-1 text-[10px] text-overlay0"><span className="inline-block h-0.5 w-4 bg-teal" /> chain</span>
          <span className="inline-flex items-center gap-1 text-[10px] text-overlay0"><span className="inline-block h-0.5 w-4 bg-sky" /> collide</span>
        </span>
      </p>
      {leaves.length === 0 ? (
        <p className="rounded-lg border border-dashed border-surface1 px-3 py-4 text-center text-[13px] text-subtext0">
          {t(lang, "logic.empty")}
        </p>
      ) : (
        <div ref={contentRef} className="relative" style={{ width: size.w, height: size.h }}>
          <svg width={size.w} height={size.h} className="pointer-events-none absolute inset-0 z-0">
            {wires.map((w, i) => (
              <path
                key={i}
                d={w.d}
                fill="none"
                stroke={w.kind === "collide" ? "#89dceb" : "var(--ctp-teal)"}
                strokeOpacity={w.kind === "chain" ? 0.45 : 0.8}
                strokeWidth="1.5"
                strokeDasharray={w.kind === "collide" ? "5 3" : undefined}
              />
            ))}
          </svg>
          <div className="absolute inset-0 z-10">
            {top.map((o) => (
              <ObjectNode key={o.path} leaf={o} pos={positions.get(o.path) ?? { x: 60, y: 60 }} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
