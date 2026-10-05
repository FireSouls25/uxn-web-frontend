import { useState } from "react";
import { useStore } from "@nanostores/react";
import { Plus } from "lucide-react";
import { PALETTE, defaultBlockFor, eventSummary } from "./LogicGraphLayer";
import KeyPicker from "./KeyPicker";
import RunCodeSection from "./RunCodeSection";
import { t, useLang } from "../lib/i18n";
import { flattenScene, projectDefs, type EventTrigger, type FlatLeaf } from "../lib/project";
import {
  addBlock,
  addEvent,
  addSound,
  codeFileStore,
  currentScene,
  projectStore,
  sceneIdStore,
  selectionStore,
  viewStore,
  type EventOwner,
} from "../lib/store";

const TRIGGERS: EventTrigger[] = ["create", "step", "destroy", "key", "collide", "click", "alarm"];

function topLeaves(): FlatLeaf[] {
  const p = projectStore.get();
  try {
    return flattenScene(p, sceneIdStore.get()).filter((l) => !l.path.includes("/"));
  } catch {
    return [];
  }
}

function ownerOfLeaf(p: ReturnType<typeof projectStore.get>, leaf: FlatLeaf | undefined): EventOwner | null {
  if (!leaf) return null;
  if (leaf.def) {
    if (!projectDefs(p).some((d) => d.id === leaf.def)) return null;
    return { def: leaf.def };
  }
  return { leaf: leaf.id };
}

/* Blocks-view inspector: the block picker. Nodes on the canvas
   display and edit what exists; everything new is connected here —
   pick a target object + event, then add movement, sound, flow,
   code or note blocks. Sound and snippet rows attach library
   entries straight onto the selected event. */
export default function LogicInspector() {
  const lang = useLang();
  const project = useStore(projectStore);
  const sceneId = useStore(sceneIdStore);
  const selection = useStore(selectionStore);
  const [evId, setEvId] = useState<string | null>(null);
  const [newTrigger, setNewTrigger] = useState<EventTrigger>("step");
  const [newKey, setNewKey] = useState("");
  const [newTarget, setNewTarget] = useState("any");
  const sounds = project.sounds ?? [];

  const locked = !!project.locked;
  const leaves = topLeaves();
  const leaf = leaves.find((l) => l.path === selection) ?? leaves[0];
  const owner = ownerOfLeaf(project, leaf);
  const events = leaf?.events ?? [];
  const event = events.find((e) => e.id === evId) ?? events[0] ?? null;

  function pickLeaf(path: string) {
    selectionStore.set(path);
    setEvId(null);
  }

  function commitAddEvent(): string | null {
    if (!owner || locked) return null;
    return (
      addEvent(
        owner,
        newTrigger,
        newTrigger === "key"
          ? { key: newKey || project.inputs[0]?.id }
          : newTrigger === "collide"
            ? { target: newTarget }
            : undefined,
      ) ?? null
    );
  }

  function commitAddBlock(op: Parameters<typeof defaultBlockFor>[1]) {
    if (!owner || locked) return;
    let id: string | null = event?.id ?? null;
    if (!id) {
      id = addEvent(owner, "step");
      if (!id) return;
    }
    addBlock(owner, id, defaultBlockFor(project, op, leaf ? { x: leaf.x, y: leaf.y } : undefined, t(lang, "sound.default_name")));
    setEvId(id);
  }

  function attachPlay() {
    if (!owner || locked) return;
    const sid = sounds[0]?.id ?? addSound(t(lang, "sound.default_name"));
    let id: string | null = event?.id ?? null;
    if (!id) {
      id = addEvent(owner, "step");
      if (!id) return;
    }
    addBlock(owner, id, { op: "play", sound: sid });
    setEvId(id);
  }

  if (leaves.length === 0) {
    return <p className="rounded-lg border border-dashed border-surface1 px-3 py-3 text-center text-[13px] text-subtext0">{t(lang, "logic.empty")}</p>;
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 font-mono text-[11px] uppercase tracking-widest text-subtext0">{t(lang, "events.object")}</p>
        <select
          value={leaf?.path ?? ""}
          onChange={(e) => pickLeaf(e.target.value)}
          className="select w-full"
          aria-label={t(lang, "events.object")}
        >
          {leaves.map((l) => (
            <option key={l.path} value={l.path}>
              {l.id} · {l.kind}
            </option>
          ))}
        </select>
      </div>

      <div>
        <p className="mb-1.5 font-mono text-[11px] uppercase tracking-widest text-subtext0">{t(lang, "ev.trigger")}</p>
        {events.length > 0 && (
          <select
            value={event?.id ?? ""}
            onChange={(e) => setEvId(e.target.value)}
            className="select w-full"
            aria-label={t(lang, "ev.trigger")}
          >
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {eventSummary(lang, e)} · {e.blocks.length}
              </option>
            ))}
          </select>
        )}
        {!locked && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-lg border border-dashed border-surface1 px-2 py-1.5">
            <select
              aria-label={t(lang, "ev.trigger")}
              value={newTrigger}
              onChange={(e) => setNewTrigger(e.target.value as EventTrigger)}
              className="select select-sm min-w-0 flex-1"
            >
              {TRIGGERS.map((tr) => (
                <option key={tr} value={tr}>
                  {tr}
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
                {["any", "solid", "player", "movable", ...(project.objectDefs ?? []).map((d) => `def:${d.id}`)].map((tg) => (
                  <option key={tg} value={tg}>
                    {tg}
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={() => {
                const id = commitAddEvent();
                if (id) setEvId(id);
              }}
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-surface0 px-2 py-1 font-mono text-[11px] transition-colors hover:bg-surface1"
            >
              <Plus size={12} /> {t(lang, "ev.add_event")}
            </button>
          </div>
        )}
      </div>

      <div>
        <p className="mb-1.5 font-mono text-[11px] uppercase tracking-widest text-subtext0">
          {t(lang, "ev.add_block")}
          {event && <span className="text-teal"> · {eventSummary(lang, event)}</span>}
        </p>
        {locked || !leaf ? null : (
          <div className="space-y-1.5">
            {PALETTE.map((cat) => (
              <div key={cat.group}>
                <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-overlay0">{t(lang, cat.group)}</p>
                <div className="flex flex-wrap gap-1">
                  {cat.ops.map((op) => (
                    <button
                      key={op}
                      draggable={!locked}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "copy";
                        e.dataTransfer.setData("application/x-block-new", JSON.stringify({ op }));
                      }}
                      onClick={() => commitAddBlock(op)}
                      title={t(lang, "logic.drag_block")}
                      className="cursor-grab rounded-md bg-surface0 px-2 py-1 font-mono text-[11px] text-subtext0 transition-colors hover:bg-surface1 hover:text-text active:cursor-grabbing"
                    >
                      +{t(lang, `ev.op_${op}`)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-surface0 p-2.5">
        <p className="mb-1.5 font-mono text-[11px] uppercase tracking-widest text-subtext0">
          {t(lang, "ev.cat_sound")}
          {event && <span className="text-teal"> · {eventSummary(lang, event)}</span>}
        </p>
        <p className="mb-1.5 font-mono text-[10px] leading-relaxed text-overlay0">{t(lang, "logic.drag_hint")}</p>
        <div className="flex gap-1.5">
          <button
            draggable={!locked}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "copy";
              e.dataTransfer.setData("application/x-block-new", JSON.stringify({ op: "play" }));
            }}
            onClick={attachPlay}
            disabled={locked}
            className="inline-flex flex-1 cursor-grab items-center justify-center gap-1 rounded-lg bg-white px-3 py-1.5 text-[12px] font-semibold text-black active:cursor-grabbing disabled:opacity-50"
          >
            <Plus size={12} /> {t(lang, "ev.op_play")}
          </button>
          <button
            onClick={() => {
              viewStore.set("sound");
            }}
            title={t(lang, "studio.open_sound")}
            className="rounded-lg bg-surface0 px-3 py-1.5 font-mono text-[11px] text-subtext0 transition-colors hover:bg-surface1 hover:text-text"
          >
            ♪
          </button>
        </div>
      </div>

      <RunCodeSection />
      {!locked && (
        <button
          onClick={() => {
            codeFileStore.set("main.ux");
            viewStore.set("code");
          }}
          className="w-full rounded-lg border border-surface0 px-3 py-2 text-left font-mono text-[11px] text-subtext0 transition-colors hover:border-surface1 hover:text-text"
        >
          {t(lang, "code.snippets")} · {t(lang, "studio.open_code")} →
        </button>
      )}
      <p className="font-mono text-[10px] leading-relaxed text-overlay0">
        {sceneId} · {t(lang, "ev.hint")}
      </p>
    </div>
  );
}
