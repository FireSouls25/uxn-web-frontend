import { useState } from "react";
import { useStore } from "@nanostores/react";
import { Plus, X } from "lucide-react";
import { t, useLang } from "../lib/i18n";
import {
  addBinding,
  currentScene,
  patchObject,
  projectStore,
  removeBinding,
  sceneIdStore,
  selectionStore,
  setObjectPos,
} from "../lib/store";

/* Inspector bound to the store selection: numeric X/Y, physics flags
   (solid / movable / player / controls) and the object's scene
   transitions, with add/remove. Canvas drags and typed values share
   the same clamping, so they can never disagree. */
export default function InspectorPanel() {
  const lang = useLang();
  const project = useStore(projectStore);
  const sceneId = useStore(sceneIdStore);
  const selection = useStore(selectionStore);
  const [newKind, setNewKind] = useState<"click" | "key">("click");
  const [newGoto, setNewGoto] = useState(project.scenes[0]?.id ?? "");
  const [newKey, setNewKey] = useState(32);

  const scene = currentScene(project, sceneId);
  const obj = scene.objects.find((o) => o.id === selection) ?? null;
  const clickIdx = scene.clicks
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => obj && c.object === obj.id);
  const keyIdx = scene.keys.map((k, i) => ({ k, i }));

  function commit(field: "x" | "y", raw: number) {
    if (!obj || Number.isNaN(raw)) return;
    const next = { x: obj.x, y: obj.y, [field]: Math.round(raw) };
    setObjectPos(obj.id, next.x, next.y);
  }

  function toggle(field: "solid" | "movable" | "player" | "controls") {
    if (!obj) return;
    if (field === "movable" && !obj.solid && !obj.movable) {
      patchObject(obj.id, { solid: true, movable: true });
    } else if (field === "controls" && !obj.player && !obj.controls) {
      patchObject(obj.id, { player: true, controls: true });
    } else {
      patchObject(obj.id, { [field]: !obj[field] });
    }
  }

  const toggleRow = (field: "solid" | "movable" | "player" | "controls", label: string) => (
    <button
      onClick={() => toggle(field)}
      className="flex w-full items-center justify-between rounded-lg border border-surface0 px-3 py-2 text-left"
    >
      <span className="text-[13px]">{label}</span>
      <span
        className={`relative h-5 w-9 rounded-full transition-colors ${obj?.[field] ? "bg-green" : "bg-surface1"}`}
      >
        <span
          className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${obj?.[field] ? "left-[18px]" : "left-0.5"}`}
        />
      </span>
    </button>
  );

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-widest text-subtext0">
          {t(lang, "insp.title")}
        </p>
        {obj && (
          <span className="rounded-full bg-mauve/15 px-2 py-0.5 font-mono text-[10px] text-mauve">
            {obj.id}
          </span>
        )}
      </div>
      {!obj ? (
        <p className="mt-3 rounded-lg border border-dashed border-surface1 px-3 py-4 text-center text-[13px] text-subtext0">
          {t(lang, "insp.none")}
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          {(["x", "y"] as const).map((field) => (
            <div
              key={field}
              className="flex items-center justify-between rounded-lg border border-surface0 px-3 py-2"
            >
              <span className="font-mono text-[11px] text-subtext0">
                {t(lang, field === "x" ? "insp.x" : "insp.y")}
              </span>
              <input
                type="number"
                value={field === "x" ? obj.x : obj.y}
                min={0}
                max={field === "x" ? project.width - 8 : project.height - 8}
                onChange={(e) => commit(field, e.target.valueAsNumber)}
                className="w-20 rounded-md border border-surface1 bg-base px-2 py-1 text-right font-mono text-xs outline-none focus:border-mauve"
              />
            </div>
          ))}
          {toggleRow("solid", t(lang, "insp.solid"))}
          {toggleRow("movable", t(lang, "insp.movable"))}
          {toggleRow("player", t(lang, "insp.player"))}
          {toggleRow("controls", t(lang, "insp.controls"))}

          <div className="rounded-lg border border-surface0 p-3">
            <p className="font-mono text-[11px] uppercase tracking-widest text-subtext0">
              {t(lang, "insp.bindings")}
            </p>
            <div className="mt-2 space-y-1.5">
              {clickIdx.length === 0 && keyIdx.length === 0 && (
                <p className="text-[13px] text-subtext0">{t(lang, "insp.no_bindings")}</p>
              )}
              {clickIdx.map(({ c, i }) => (
                <div key={`c${i}`} className="flex items-center gap-2 font-mono text-[11px]">
                  <span className="text-sky">{t(lang, "events.click")}</span>
                  <span className="text-mauve">→ {c.goto}</span>
                  <button
                    onClick={() => removeBinding("click", i)}
                    aria-label={t(lang, "insp.remove")}
                    className="ml-auto text-subtext0 hover:text-red"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
              {keyIdx.map(({ k, i }) => (
                <div key={`k${i}`} className="flex items-center gap-2 font-mono text-[11px]">
                  <span className="text-sky">{t(lang, "events.key")} {k.key}</span>
                  <span className="text-mauve">→ {k.goto}</span>
                  <button
                    onClick={() => removeBinding("key", i)}
                    aria-label={t(lang, "insp.remove")}
                    className="ml-auto text-subtext0 hover:text-red"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <select
                aria-label={t(lang, "insp.event")}
                value={newKind}
                onChange={(e) => setNewKind(e.target.value as "click" | "key")}
                className="select"
              >
                <option value="click">{t(lang, "events.click")}</option>
                <option value="key">{t(lang, "events.key")}</option>
              </select>
              {newKind === "key" && (
                <input
                  type="number"
                  aria-label={t(lang, "events.key")}
                  value={newKey}
                  min={0}
                  max={255}
                  onChange={(e) => setNewKey(Math.min(255, Math.max(0, Math.round(e.target.valueAsNumber || 0))))}
                  className="w-14 rounded-md border border-surface1 bg-base px-1.5 py-1 font-mono text-[11px] outline-none"
                />
              )}
              <select
                aria-label={t(lang, "insp.goto")}
                value={newGoto}
                onChange={(e) => setNewGoto(e.target.value)}
                className="select"
              >
                {project.scenes.map((s) => (
                  <option key={s.id} value={s.id}>
                    → {s.id}
                  </option>
                ))}
              </select>
              <button
                onClick={() => {
                  if (newKind === "click" && obj) addBinding("click", obj.id, newGoto);
                  else if (newKind === "key") addBinding("key", null, newGoto, newKey);
                }}
                className="inline-flex items-center gap-1 rounded-md bg-surface0 px-2 py-1 font-mono text-[11px] transition-colors hover:bg-surface1"
              >
                <Plus size={12} /> {t(lang, "insp.add_binding")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
