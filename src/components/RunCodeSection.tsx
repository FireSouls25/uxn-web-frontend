import { useState } from "react";
import { useStore } from "@nanostores/react";
import { Code2, Plus, Trash2 } from "lucide-react";
import { t, useLang } from "../lib/i18n";
import { projectDefs, type EventTrigger } from "../lib/project";
import {
  addBlock,
  addEvent,
  addSnippet,
  codeFileStore,
  currentScene,
  defSelStore,
  deleteBlock,
  projectStore,
  sceneIdStore,
  selectionStore,
  snippetSelStore,
  viewStore,
  type EventOwner,
} from "../lib/store";

const TRIGGERS: EventTrigger[] = ["create", "step", "destroy", "key", "collide", "click", "alarm"];

/* Inspector "Run code" section: snippets are authored once on the
   Code page and connected here to the selected object's events.
   Lists the object's run blocks (event + snippet + jump to Code)
   plus an attach row (snippet + trigger → new run block). */
export default function RunCodeSection() {
  const lang = useLang();
  const project = useStore(projectStore);
  const defSel = useStore(defSelStore);
  const selection = useStore(selectionStore);
  const sceneId = useStore(sceneIdStore);
  const [snippet, setSnippet] = useState("");
  const [trigger, setTrigger] = useState<EventTrigger>("step");

  const locked = !!project.locked;
  let owner: EventOwner | null = null;
  let ownerLabel = "";
  if (defSel && projectDefs(project).some((d) => d.id === defSel)) {
    owner = { def: defSel };
    ownerLabel = defSel;
  } else if (selection) {
    try {
      const scene = currentScene(project, sceneId);
      const id = selection.split("/")[0];
      const leaf = scene.nodes.find((o) => o.id === id && !o.scene);
      if (leaf && !selection.includes("/")) {
        if (leaf.def) {
          owner = { def: leaf.def };
          ownerLabel = leaf.def;
        } else {
          owner = { leaf: leaf.id };
          ownerLabel = leaf.id;
        }
      }
    } catch {
      owner = null;
    }
  }
  if (!owner) return null;

  const events =
    "def" in owner
      ? (projectDefs(project).find((d) => d.id === owner.def)?.events ?? [])
      : (() => {
          try {
            const scene = currentScene(project, sceneId);
            return scene.nodes.find((o) => o.id === (owner as { leaf: string }).leaf && !o.scene)?.events ?? [];
          } catch {
            return [];
          }
        })();
  const runs: Array<{ eventId: string; trigger: string; index: number; snippet: string }> = [];
  for (const e of events) {
    e.blocks.forEach((b, i) => {
      if (b.op === "run") runs.push({ eventId: e.id, trigger: e.trigger, index: i, snippet: b.snippet });
    });
  }
  const snippets = project.snippets ?? [];

  function attach() {
    if (!owner || locked) return;
    const sid = snippet || snippets[0]?.id || addSnippet("snippet");
    let ev = events.find((e) => e.trigger === trigger)?.id ?? null;
    if (!ev)
      ev = addEvent(
        owner,
        trigger,
        trigger === "key" ? { key: project.inputs[0]?.id } : trigger === "collide" ? { target: "any" } : undefined,
      );
    if (ev) addBlock(owner, ev, { op: "run", snippet: sid });
  }

  return (
    <div className="rounded-lg border border-surface0 p-3">
      <p className="font-mono text-[11px] uppercase tracking-widest text-subtext0">
        {t(lang, "insp.runcode")} · <span className="text-text">{ownerLabel}</span>
      </p>
      {runs.length === 0 ? (
        <p className="mt-1.5 text-[13px] text-subtext0">{t(lang, "insp.runcode_empty")}</p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {runs.map((r, i) => (
            <li key={i} className="flex items-center gap-1.5 font-mono text-[11px]">
              <span className="shrink-0 text-teal">{r.trigger}</span>
              <button
                onClick={() => {
                  snippetSelStore.set(r.snippet);
                  codeFileStore.set("main.ux");
                  viewStore.set("code");
                }}
                title={t(lang, "studio.open_code")}
                className="min-w-0 flex-1 truncate text-left text-text hover:text-teal"
              >
                <Code2 size={11} className="mr-1 inline" />
                {r.snippet}
              </button>
              {!locked && (
                <button
                  onClick={() => deleteBlock(owner as EventOwner, r.eventId, r.index)}
                  aria-label={t(lang, "insp.remove")}
                  className="shrink-0 text-subtext0 hover:text-red"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!locked && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <select
            aria-label={t(lang, "insp.snippet")}
            value={snippet}
            onChange={(e) => setSnippet(e.target.value)}
            className="select min-w-0 flex-1"
          >
            <option value="">{snippets[0]?.id ?? t(lang, "ev.no_snippets")}</option>
            {snippets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id}
              </option>
            ))}
          </select>
          <select
            aria-label={t(lang, "ev.trigger")}
            value={trigger}
            onChange={(e) => setTrigger(e.target.value as EventTrigger)}
            className="select"
          >
            {TRIGGERS.map((tr) => (
              <option key={tr} value={tr}>
                {tr}
              </option>
            ))}
          </select>
          <button
            onClick={attach}
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-surface0 px-2 py-1 font-mono text-[11px] transition-colors hover:bg-surface1"
          >
            <Plus size={12} /> {t(lang, "insp.attach")}
          </button>
        </div>
      )}
    </div>
  );
}
