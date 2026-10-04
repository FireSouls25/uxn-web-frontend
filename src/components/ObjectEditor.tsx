import { useState } from "react";
import { useStore } from "@nanostores/react";
import { Box, Gamepad2, Move, Trash2 } from "lucide-react";
import { t, useLang } from "../lib/i18n";
import { spritePxOf, spriteTiles, type ObjectKind } from "../lib/project";
import MaskEditor from "./MaskEditor";
import {
  canvasModeStore,
  defSelStore,
  deleteDef,
  patchDef,
  projectStore,
  renameDef,
} from "../lib/store";
import SpritePicker, { SpriteThumb } from "./SpritePicker";

const KIND_META: Record<ObjectKind, { icon: typeof Box; key: string }> = {
  player: { icon: Gamepad2, key: "kind.player" },
  static: { icon: Box, key: "kind.static" },
  movable: { icon: Move, key: "kind.movable" },
};

/* Right panel when an object template is selected: the GameMaker
   object editor minus physics — default art, kind, flags, animation
   and tick script. Instances inherit all of it; editing here updates
   every placement at once. With hideCode (the canvas overlay), the
   tick textarea collapses into a Logic summary — code lives in the
   logic graph. */
export default function ObjectEditor({ id, hideCode = false }: { id: string; hideCode?: boolean }) {
  const lang = useLang();
  const project = useStore(projectStore);
  const [rename, setRename] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const def = (project.objectDefs ?? []).find((d) => d.id === id);
  if (!def) return null;
  const usedBy: string[] = [];
  for (const s of project.scenes) {
    for (const o of s.nodes) if (o.def === id) usedBy.push(`${s.id}/${o.id}`);
  }

  function changeKind(kind: ObjectKind) {
    if (kind === "movable") patchDef(id, { kind, solid: true });
    else if (kind === "player") patchDef(id, { kind });
    else patchDef(id, { kind, controls: false });
  }

  function toggle(field: "solid" | "controls") {
    patchDef(id, { [field]: !def?.[field] });
  }

  const toggleRow = (field: "solid" | "controls", label: string) => (
    <button
      onClick={() => toggle(field)}
      className="flex w-full items-center justify-between rounded-lg border border-surface0 px-3 py-2 text-left"
    >
      <span className="text-[13px]">{label}</span>
      <span
        className={`relative h-5 w-9 rounded-full transition-colors ${def[field] ? "bg-green" : "bg-surface1"}`}
      >
        <span
          className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${def[field] ? "left-[18px]" : "left-0.5"}`}
        />
      </span>
    </button>
  );

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-widest text-subtext0">
          {t(lang, "assets.editor")}
        </p>
        <span className="rounded-full bg-teal/15 px-2 py-0.5 font-mono text-[10px] text-teal">{def.id}</span>
      </div>
      <fieldset disabled={!!project.locked} className="mt-2 space-y-2">
        <div className="flex items-center gap-1.5 rounded-lg border border-surface0 px-3 py-2">
          {(() => {
            const Icon = KIND_META[def.kind].icon;
            return <Icon size={14} className="shrink-0 text-teal" />;
          })()}
          {rename === null ? (
            <button
              onClick={() => {
                setRename(def.id);
                setRenameError(null);
              }}
              title={t(lang, "insp.rename")}
              className="flex-1 truncate text-left text-[13px] font-semibold hover:text-teal"
            >
              {def.id}
            </button>
          ) : (
            <input
              autoFocus
              value={rename}
              onChange={(e) => setRename(e.target.value)}
              onBlur={() => setRename(null)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const err = renameDef(def.id, rename);
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
            value={def.kind}
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
        <button
          type="button"
          onClick={() => setPicking(true)}
          title={t(lang, "insp.change_sprite")}
          className="flex w-full items-center gap-2.5 rounded-lg border border-surface0 px-3 py-2 text-left transition-colors hover:border-teal/40"
        >
          <span className="w-12 shrink-0">
            <SpriteThumb id={def.sprite} dim={48} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-mono text-[11px] uppercase tracking-widest text-subtext0">
              {t(lang, "insp.sprite")}
            </span>
            <span className="block truncate text-[13px] font-medium">
              {def.sprite}{" "}
              {(() => {
                const s = project.sprites.find((x) => x.id === def.sprite);
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
        <SpritePicker open={picking} onPick={(sid) => patchDef(id, { sprite: sid })} onClose={() => setPicking(false)} />
        {toggleRow("solid", t(lang, "insp.solid"))}
        {def.kind === "player" && toggleRow("controls", t(lang, "insp.controls"))}
        <div className="rounded-lg border border-surface0 px-3 py-2">
          <MaskEditor
            value={def.mask}
            full={spritePxOf(project, def.sprite)}
            custom={false}
            onChange={(mask) => patchDef(id, { mask })}
          />
        </div>
        <label className="block">
          <span className="mb-1 block font-mono text-[11px] uppercase tracking-widest text-subtext0">
            {t(lang, "insp.anim")}
          </span>
          <select
            value={def.anim ?? ""}
            onChange={(e) => patchDef(id, { anim: e.target.value || undefined })}
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
        {hideCode ? (
          <button
            onClick={() => canvasModeStore.set("logic")}
            className="flex w-full items-center justify-between rounded-lg border border-surface0 px-3 py-2 text-left transition-colors hover:border-mauve/40"
          >
            <span className="font-mono text-[11px] uppercase tracking-widest text-subtext0">
              {t(lang, "insp.logic")}: {(def.events ?? []).length} {t(lang, "view.events").toLowerCase()}
            </span>
            <span className="rounded-md bg-mauve/15 px-1.5 py-0.5 font-mono text-[11px] text-mauve">
              {t(lang, "insp.events_open")}
            </span>
          </button>
        ) : (
          <label className="block">
            <span className="mb-1 block font-mono text-[11px] uppercase tracking-widest text-subtext0">
              {t(lang, "insp.tick")}
            </span>
            <textarea
              value={def.tick ?? ""}
              onChange={(e) => patchDef(id, { tick: e.target.value || undefined })}
              spellCheck={false}
              rows={3}
              placeholder={t(lang, "insp.tick_ph")}
              className="w-full resize-y rounded-lg border border-surface1 bg-base p-2 font-mono text-[11px] leading-relaxed outline-none placeholder:text-overlay0 focus:border-mauve"
            />
          </label>
        )}
        <div className="rounded-lg border border-surface0 p-3">
          <p className="font-mono text-[11px] uppercase tracking-widest text-subtext0">
            {t(lang, "assets.used_by")} ({usedBy.length})
          </p>
          {usedBy.length === 0 ? (
            <p className="mt-1 text-[13px] text-subtext0">{t(lang, "assets.unused")}</p>
          ) : (
            <p className="mt-1 truncate font-mono text-[11px] text-subtext0">{usedBy.join(", ")}</p>
          )}
        </div>
        {confirming ? (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => deleteDef(id)}
              className="flex-1 rounded-lg bg-red/20 px-3 py-2 text-[13px] font-medium text-red transition-colors hover:bg-red/30"
            >
              {t(lang, "assets.delete_confirm")}
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="rounded-lg bg-surface0 px-3 py-2 text-[13px] transition-colors hover:bg-surface1"
            >
              {t(lang, "assets.delete_cancel")}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="w-full rounded-lg border border-surface0 px-3 py-2 text-[13px] text-subtext0 transition-colors hover:border-red/40 hover:text-red"
          >
            {t(lang, "assets.delete_def")}
          </button>
        )}
      </fieldset>
    </div>
  );
}
