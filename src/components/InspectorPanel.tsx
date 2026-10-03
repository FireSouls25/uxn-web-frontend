import { useState } from "react";
import { useStore } from "@nanostores/react";
import { Box, Gamepad2, Move, Plus, X } from "lucide-react";
import { t, useLang } from "../lib/i18n";
import { spritePxOf, spriteTiles, type ObjectKind } from "../lib/project";
import { keyLabel } from "../lib/keys";
import {
  addBinding,
  addInput,
  currentScene,
  defSelStore,
  extractObject,
  patchObject,
  projectStore,
  removeBinding,
  renameObject,
  sceneIdStore,
  selectionStore,
  setObjectPos,
} from "../lib/store";
import KeyPicker from "./KeyPicker";
import MaskEditor from "./MaskEditor";
import SpritePicker, { SpriteThumb } from "./SpritePicker";

const KIND_META: Record<ObjectKind, { icon: typeof Box; key: string }> = {
  player: { icon: Gamepad2, key: "kind.player" },
  static: { icon: Box, key: "kind.static" },
  movable: { icon: Move, key: "kind.movable" },
};

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
  const [newInput, setNewInput] = useState("");

  const scene = currentScene(project, sceneId);
  const segs = (selection ?? "").split("/").filter(Boolean);
  const nested = segs.length > 1;
  // Nested instances are viewed here but edited in their home scene.
  const homeId = nested
    ? (() => {
        let cur = scene.id;
        for (const seg of segs.slice(0, -1)) {
          const next = project.scenes.find((s) => s.id === cur)?.nodes.find((n) => n.id === seg);
          if (!next?.scene) return null;
          cur = next.scene;
        }
        return cur;
      })()
    : null;
  const homeScene = homeId ? (project.scenes.find((s) => s.id === homeId) ?? null) : null;
  const nestedNode = homeScene?.nodes.find((n) => n.id === segs[segs.length - 1]) ?? null;
  const obj = nested ? null : (scene.nodes.find((o) => o.id === selection) ?? null);
  const clickIdx = scene.clicks
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => obj && c.object === obj.id);
  const keyIdx = scene.keys.map((k, i) => ({ k, i }));
  const [rename, setRename] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  // Def instances edit effective values: the def supplies defaults,
  // local fields override. Toggles flip the effective value (adding
  // a local override); Reset clears every local behavior field.
  const def = obj?.def ? (project.objectDefs ?? []).find((d) => d.id === obj.def) : undefined;
  const eff = obj
    ? {
        sprite: obj.sprite ?? def?.sprite ?? "",
        kind: obj.kind ?? def?.kind ?? "static",
        solid: obj.solid ?? def?.solid ?? false,
        controls: obj.controls ?? def?.controls ?? false,
        anim: obj.anim ?? def?.anim,
        tick: obj.tick ?? def?.tick,
        mask: obj.mask ?? def?.mask,
      }
    : null;
  const overridden =
    !!obj &&
    !!def &&
    (obj.sprite !== undefined ||
      obj.kind !== undefined ||
      obj.solid !== undefined ||
      obj.controls !== undefined ||
      obj.anim !== undefined ||
      obj.tick !== undefined);

  function commit(field: "x" | "y", raw: number) {
    if (!obj || Number.isNaN(raw)) return;
    const next = { x: obj.x, y: obj.y, [field]: Math.round(raw) };
    setObjectPos(obj.id, next.x, next.y);
  }

  function toggle(field: "solid" | "controls") {
    if (!obj || !eff) return;
    patchObject(obj.id, { [field]: !eff[field] });
  }

  function resetOverrides() {
    if (!obj) return;
    patchObject(obj.id, {
      sprite: undefined,
      kind: undefined,
      solid: undefined,
      controls: undefined,
      anim: undefined,
      tick: undefined,
    });
  }

  function changeKind(kind: ObjectKind) {
    if (!obj) return;
    if (kind === "movable") patchObject(obj.id, { kind, solid: true });
    else if (kind === "player") patchObject(obj.id, { kind });
    else patchObject(obj.id, { kind, controls: false });
  }

  const toggleRow = (field: "solid" | "controls", label: string) => (
    <button
      onClick={() => toggle(field)}
      className="flex w-full items-center justify-between rounded-lg border border-surface0 px-3 py-2 text-left"
    >
      <span className="text-[13px]">
        {label}
        {obj && def && obj[field] !== undefined && (
          <span className="ml-1 font-mono text-[10px] text-teal">●</span>
        )}
      </span>
      <span
        className={`relative h-5 w-9 rounded-full transition-colors ${eff?.[field] ? "bg-green" : "bg-surface1"}`}
      >
        <span
          className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${eff?.[field] ? "left-[18px]" : "left-0.5"}`}
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
        nested && nestedNode && homeScene ? (
          <div className="mt-3 rounded-lg border border-surface0 p-3">
            <p className="font-mono text-[11px] text-subtext0">
              {t(lang, "insp.nested")} <span className="text-mauve">{homeScene.id}/{nestedNode.id}</span>
            </p>
            <button
              onClick={() => {
                sceneIdStore.set(homeScene.id);
                selectionStore.set(nestedNode.id);
              }}
              className="mt-2 w-full rounded-lg bg-surface0 px-3 py-2 text-[13px] font-medium transition-colors hover:bg-surface1"
            >
              {t(lang, "insp.edit_home")}
            </button>
          </div>
        ) : (
          <p className="mt-3 rounded-lg border border-dashed border-surface1 px-3 py-4 text-center text-[13px] text-subtext0">
            {t(lang, "insp.none")}
          </p>
        )
      ) : (
        <fieldset disabled={!!project.locked} className="mt-2 space-y-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-surface0 px-3 py-2">
            {(() => {
              const Icon = KIND_META[eff?.kind ?? "static"].icon;
              return <Icon size={14} className="shrink-0 text-mauve" />;
            })()}
            {rename === null ? (
              <button
                onClick={() => {
                  setRename(obj.id);
                  setRenameError(null);
                }}
                title={t(lang, "insp.rename")}
                className="flex-1 truncate text-left text-[13px] font-semibold hover:text-mauve"
              >
                {obj.id}
              </button>
            ) : (
              <input
                autoFocus
                value={rename}
                onChange={(e) => setRename(e.target.value)}
                onBlur={() => setRename(null)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const err = renameObject(obj.id, rename);
                    setRenameError(err);
                    if (!err) setRename(null);
                  }
                  if (e.key === "Escape") setRename(null);
                }}
                maxLength={24}
                className="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none"
              />
            )}
            <select
              aria-label={t(lang, "hier.kind")}
              value={eff?.kind ?? "static"}
              onChange={(e) => changeKind(e.target.value as ObjectKind)}
              className="select select-sm"
            >
              {(Object.keys(KIND_META) as ObjectKind[]).map((k) => (
                <option key={k} value={k}>
                  {t(lang, KIND_META[k].key)}
                </option>
              ))}
            </select>
          </div>
          {renameError && <p className="text-[12px] text-red">{t(lang, "insp.rename_err")}</p>}
          {def ? (
            <div className="flex items-center gap-1.5 rounded-lg border border-teal/30 bg-teal/5 px-3 py-2">
              <span className="flex-1 truncate font-mono text-[11px] text-teal">
                {t(lang, "insp.instance_of")} {def.id}
              </span>
              {overridden && (
                <button
                  onClick={resetOverrides}
                  title={t(lang, "insp.reset_overrides")}
                  className="rounded-md px-1.5 py-0.5 font-mono text-[11px] text-subtext0 transition-colors hover:bg-surface0 hover:text-text"
                >
                  {t(lang, "insp.reset")}
                </button>
              )}
              <button
                onClick={() => defSelStore.set(def.id)}
                className="rounded-md bg-teal/15 px-1.5 py-0.5 font-mono text-[11px] text-teal transition-colors hover:bg-teal/25"
              >
                {t(lang, "insp.open_object")}
              </button>
            </div>
          ) : (
            <button
              onClick={() => extractObject(obj.id)}
              title={t(lang, "insp.extract_hint")}
              className="w-full rounded-lg border border-dashed border-surface1 px-3 py-2 text-[13px] text-subtext0 transition-colors hover:border-teal/40 hover:text-text"
            >
              {t(lang, "insp.extract")}
            </button>
          )}
          <button
            type="button"
            onClick={() => setPicking(true)}
            title={t(lang, "insp.change_sprite")}
            className="flex w-full items-center gap-2.5 rounded-lg border border-surface0 px-3 py-2 text-left transition-colors hover:border-mauve/40"
          >
            <span className="w-12 shrink-0">
              <SpriteThumb id={eff?.sprite ?? ""} dim={48} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-mono text-[11px] uppercase tracking-widest text-subtext0">
                {t(lang, "insp.sprite")}
                {obj.sprite !== undefined && def && <span className="ml-1 text-teal">●</span>}
              </span>
              <span className="block truncate text-[13px] font-medium">
                {eff?.sprite}{" "}
                {(() => {
                  const s = project.sprites.find((x) => x.id === eff?.sprite);
                  const [w, h] = s ? spriteTiles(s) : [1, 1];
                  return (
                    <span className="font-mono text-[11px] text-subtext0">
                      · {w}×{h}
                    </span>
                  );
                })()}
              </span>
            </span>
          </button>
          <SpritePicker
            open={picking}
            onPick={(id) => patchObject(obj.id, { sprite: id })}
            onClose={() => setPicking(false)}
          />
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
                max={
                  field === "x"
                    ? project.width - spritePxOf(project, eff?.sprite ?? "")[0]
                    : project.height - spritePxOf(project, eff?.sprite ?? "")[1]
                }
                onChange={(e) => commit(field, e.target.valueAsNumber)}
                className="w-20 rounded-md border border-surface1 bg-base px-2 py-1 text-right font-mono text-xs outline-none focus:border-mauve"
              />
            </div>
          ))}
          {toggleRow("solid", t(lang, "insp.solid"))}
          {eff?.kind === "player" && toggleRow("controls", t(lang, "insp.controls"))}
          <div className="rounded-lg border border-surface0 px-3 py-2">
            <MaskEditor
              value={obj.mask}
              full={spritePxOf(project, eff?.sprite ?? "")}
              custom={obj.mask !== undefined && !!def}
              onChange={(mask) => patchObject(obj.id, { mask })}
            />
          </div>
          <label className="block">
            <span className="mb-1 block font-mono text-[11px] uppercase tracking-widest text-subtext0">
              {t(lang, "insp.anim")}
              {obj.anim !== undefined && def && <span className="ml-1 text-teal">●</span>}
            </span>
            <select
              value={eff?.anim ?? ""}
              onChange={(e) => patchObject(obj.id, { anim: e.target.value || undefined })}
              className="select w-full"
            >
              <option value="">—</option>
              {project.anims.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id} ({a.frames.length}f)
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block font-mono text-[11px] uppercase tracking-widest text-subtext0">
              {t(lang, "insp.tick")}
              {obj.tick !== undefined && def && <span className="ml-1 text-teal">●</span>}
            </span>
            <textarea
              value={eff?.tick ?? ""}
              onChange={(e) => patchObject(obj.id, { tick: e.target.value || undefined })}
              spellCheck={false}
              rows={3}
              placeholder={t(lang, "insp.tick_ph")}
              className="w-full resize-y rounded-lg border border-surface1 bg-base p-2 font-mono text-[11px] leading-relaxed outline-none placeholder:text-overlay0 focus:border-mauve"
            />
          </label>
          <label className="block">
            <span className="mb-1 block font-mono text-[11px] uppercase tracking-widest text-subtext0">
              {t(lang, "insp.init")}
            </span>
            <textarea
              value={obj.initCode ?? ""}
              onChange={(e) => patchObject(obj.id, { initCode: e.target.value || undefined })}
              spellCheck={false}
              rows={2}
              placeholder={t(lang, "insp.init_ph")}
              className="w-full resize-y rounded-lg border border-surface1 bg-base p-2 font-mono text-[11px] leading-relaxed outline-none placeholder:text-overlay0 focus:border-mauve"
            />
          </label>

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
                  <span className="text-sky">
                    {t(lang, "events.key")} {k.input ?? keyLabel(k.key, (kk) => t(lang, kk))}
                  </span>
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
              {newKind === "key" && <KeyPicker value={newInput} onChange={setNewInput} />}
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
                  else if (newKind === "key")
                    addBinding("key", null, newGoto, undefined, newInput || project.inputs[0]?.id || addInput(32));
                }}
                className="inline-flex items-center gap-1 rounded-md bg-surface0 px-2 py-1 font-mono text-[11px] transition-colors hover:bg-surface1"
              >
                <Plus size={12} /> {t(lang, "insp.add_binding")}
              </button>
            </div>
          </div>
        </fieldset>
      )}
    </div>
  );
}
