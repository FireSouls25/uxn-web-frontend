import { useState, type ReactNode } from "react";
import { useStore } from "@nanostores/react";
import {
  Video,
  ArrowUpFromLine,
  ArrowDown,
  ArrowUp,
  Braces,
  Code2,
  DoorOpen,
  Eye,
  EyeOff,
  GitBranch,
  Grid3x3,
  Image as ImageIcon,
  Layers,
  MapPin,
  Move,
  Music,
  Navigation,
  Palette,
  Plus,
  Repeat,
  Send,
  SquarePlus,
  Timer,
  Trash2,
  Type,
  Undo2,
  Variable,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import Popover, { Chip } from "./Popover";
import {
  CondChip,
  DefChip,
  FnChip,
  KeyChip,
  MessageChip,
  SceneChip,
  SongChip,
  SoundChip,
  SpriteChip,
  SpriteMini,
  TargetChip,
  ValueChip,
  VarChip,
  type PickCtx,
} from "./Pickers";
import { t, useLang } from "../../lib/i18n";
import { previewEvent, scriptFunctions, templatesOf, type Template } from "../../lib/engine";
import { flattenScene, projectDefs, validateProject, type Block, type BlockOp, type BlockPath, type EventTrigger, type ObjectEvent, type Project } from "../../lib/project";
import {
  addBlockAt,
  addDefVar,
  addEvent,
  addSound,
  addVariable,
  currentScene,
  defSelStore,
  deleteBlockAt,
  deleteDefVar,
  deleteEvent,
  extractObject,
  moveBlockAt,
  moveEvent,
  patchBlockAt,
  patchEvent,
  projectStore,
  readOwnerEvents,
  sceneIdStore,
  selectionStore,
  setDefVar,
  setScenePool,
  setSceneCamera,
  type EventOwner,
} from "../../lib/store";

/* ------------------------------------------------------------------
   The action catalog: what the "+ action" menu offers, grouped the
   way people look for things, with a sensible starting block each.
   ------------------------------------------------------------------ */

interface ActionDef {
  op: BlockOp;
  icon: typeof Move;
  objectOnly?: boolean;
  make: (p: Project) => Block;
}

const GROUPS: Array<{ id: string; actions: ActionDef[] }> = [
  {
    id: "motion",
    actions: [
      { op: "move", icon: Move, objectOnly: true, make: () => ({ op: "move", dx: 1, dy: 0 }) },
      { op: "set_pos", icon: MapPin, objectOnly: true, make: () => ({ op: "set_pos", x: { k: "mouse", axis: "x" }, y: { k: "mouse", axis: "y" } }) },
      { op: "glide", icon: Navigation, objectOnly: true, make: () => ({ op: "glide", x: 0, y: 0, frames: 10 }) },
      { op: "jump", icon: ArrowUpFromLine, objectOnly: true, make: () => ({ op: "jump", power: 4 }) },
    ],
  },
  {
    id: "looks",
    actions: [
      { op: "sprite", icon: ImageIcon, objectOnly: true, make: (p) => ({ op: "sprite", sprite: p.sprites[0]?.id ?? "" }) },
      { op: "cell", icon: Grid3x3, objectOnly: true, make: () => ({ op: "cell", cell: 0 }) },
      { op: "look", icon: Palette, objectOnly: true, make: () => ({ op: "look", blend: 5 }) },
      { op: "show", icon: Eye, objectOnly: true, make: () => ({ op: "show" }) },
      { op: "hide", icon: EyeOff, objectOnly: true, make: () => ({ op: "hide" }) },
      { op: "text", icon: Type, objectOnly: true, make: () => ({ op: "text", text: "SCORE ", value: 0 }) },
    ],
  },
  {
    id: "sound",
    actions: [
      { op: "play", icon: Volume2, make: (p) => ({ op: "play", sound: p.sounds?.[0]?.id ?? addSound("blip") }) },
      { op: "song", icon: Music, make: (p) => ({ op: "song", song: p.songs?.[0]?.id ?? "" }) },
      { op: "song_stop", icon: VolumeX, make: () => ({ op: "song_stop" }) },
    ],
  },
  {
    id: "scenes",
    actions: [
      { op: "goto", icon: DoorOpen, make: (p) => ({ op: "goto", scene: p.scenes[0]?.id ?? "" }) },
      { op: "overlay", icon: Layers, make: (p) => ({ op: "overlay", scene: p.scenes[0]?.id ?? "" }) },
      { op: "back", icon: Undo2, make: () => ({ op: "back" }) },
    ],
  },
  {
    id: "objects",
    actions: [
      { op: "spawn", icon: SquarePlus, make: (p) => ({ op: "spawn", def: projectDefs(p)[0]?.id ?? "", x: 0, y: 0 }) },
      { op: "destroy", icon: Trash2, make: () => ({ op: "destroy" }) },
      { op: "send", icon: Send, make: () => ({ op: "send", message: "go" }) },
    ],
  },
  {
    id: "data",
    actions: [
      { op: "set", icon: Variable, make: (p) => ({ op: "set", name: p.vars?.[0]?.id ?? addVariable("score"), mode: "add", value: 1 }) },
      { op: "if", icon: GitBranch, make: () => ({ op: "if", cond: { k: "mouse_down" }, then: [] }) },
      { op: "repeat", icon: Repeat, make: () => ({ op: "repeat", times: 3, body: [] }) },
      { op: "wait", icon: Timer, make: () => ({ op: "wait", ticks: 60 }) },
    ],
  },
  {
    id: "code",
    actions: [
      { op: "call", icon: Braces, make: (p) => ({ op: "call", fn: scriptFunctions(p)[0]?.name ?? "", args: scriptFunctions(p)[0]?.params.map(() => 0) ?? [] }) },
      { op: "code", icon: Code2, make: () => ({ op: "code", code: "( ETAL statements: self is this object's slot )" }) },
    ],
  },
];
const ICON = new Map(GROUPS.flatMap((g) => g.actions.map((a) => [a.op, a.icon] as const)));

const OBJECT_TRIGGERS: EventTrigger[] = ["create", "step", "key", "click", "release", "collide", "alarm", "message", "destroy"];
const SCENE_TRIGGERS: EventTrigger[] = ["create", "step", "key", "click", "release", "alarm", "message"];

/* ------------------------------------------------------------------ */

function ownerKey(o: EventOwner): string {
  return "def" in o ? `def:${o.def}` : "leaf" in o ? `leaf:${o.leaf}` : `scene:${o.scene}`;
}

export default function EventSheet() {
  const lang = useLang();
  const project = useStore(projectStore);
  const sceneId = useStore(sceneIdStore);
  const selection = useStore(selectionStore);
  const defSel = useStore(defSelStore);
  const [showCode, setShowCode] = useState(false);
  const locked = !!project.locked;
  const scene = currentScene(project, sceneId);
  const tpls = templatesOf(project);

  // Owner follows the studio selection: a template, an inline object,
  // or (nothing selected) the scene itself.
  let owner: EventOwner = { scene: scene.id };
  if (defSel && projectDefs(project).some((d) => d.id === defSel)) owner = { def: defSel };
  else if (selection && !selection.includes("/")) {
    const node = scene.nodes.find((n) => n.id === selection && !n.scene);
    if (node?.def) owner = { def: node.def };
    else if (node) owner = { leaf: node.id };
  }
  const events = readOwnerEvents(project, owner) ?? [];
  const tpl: Template | undefined =
    "def" in owner ? tpls.find((x) => x.def?.id === owner.def) : "leaf" in owner ? tpls.find((x) => x.key === `${scene.id}:${owner.leaf}`) : undefined;
  const isScene = "scene" in owner && !("leaf" in owner);
  const allMyVars = [...new Set(tpls.flatMap((x) => x.vars.map((v) => v.id)))];
  const baseCtx = { myVars: tpl?.vars.map((v) => v.id) ?? [], allMyVars, scene: isScene, locked };
  const ownerName = "def" in owner ? owner.def : "leaf" in owner ? `${scene.id}/${owner.leaf}` : scene.id;
  const problems = validateProject(project).filter((e) => e.startsWith(isScene ? `scene '${scene.id}'` : `object '${ownerName}'`));

  const select = (o: EventOwner): void => {
    if ("def" in o) {
      defSelStore.set(o.def);
      selectionStore.set(null);
    } else if ("leaf" in o) {
      defSelStore.set(null);
      selectionStore.set(o.leaf);
    } else {
      defSelStore.set(null);
      selectionStore.set(null);
    }
  };
  let flat: ReturnType<typeof flattenScene> = [];
  try {
    flat = flattenScene(project, scene.id);
  } catch {
    flat = [];
  }
  const inline = scene.nodes.filter((n) => !n.scene && !n.def);
  const count = (defId: string): number => flat.filter((l) => l.def === defId).length;

  return (
    <div data-nopan className="absolute inset-0 flex overflow-hidden bg-base pl-[264px]">
      {/* Owners */}
      <aside className="w-56 shrink-0 overflow-y-auto border-r border-surface0 p-3">
        <OwnerButton active={isScene} onClick={() => select({ scene: scene.id })} icon={<Layers size={14} />} label={`${t(lang, "ev.scene_owner")} ${scene.id}`} sub={t(lang, "ev.scene_owner_sub")} n={(scene.events ?? []).length} />
        <p className="mb-1 mt-4 font-mono text-[10px] uppercase tracking-widest text-overlay0">{t(lang, "ev.templates")}</p>
        {projectDefs(project).length === 0 && <p className="text-[11px] text-overlay0">{t(lang, "ev.no_templates")}</p>}
        {projectDefs(project).map((d) => (
          <OwnerButton
            key={d.id}
            active={"def" in owner && owner.def === d.id}
            onClick={() => select({ def: d.id })}
            icon={d.sprite ? <SpriteMini id={d.sprite} cell={d.cell ?? 0} /> : <Type size={14} />}
            label={d.id}
            sub={t(lang, "ev.instances").replace("{n}", String(count(d.id)))}
            n={(d.events ?? []).length}
          />
        ))}
        <p className="mb-1 mt-4 font-mono text-[10px] uppercase tracking-widest text-overlay0">{t(lang, "ev.objects_here")}</p>
        {inline.length === 0 && <p className="text-[11px] text-overlay0">{t(lang, "ev.no_objects")}</p>}
        {inline.map((n) => (
          <OwnerButton
            key={n.id}
            active={"leaf" in owner && owner.leaf === n.id}
            onClick={() => select({ leaf: n.id })}
            icon={n.sprite ? <SpriteMini id={n.sprite} cell={n.cell ?? 0} /> : <Type size={14} />}
            label={n.id}
            sub={n.label ? `“${n.label}”` : ""}
            n={(n.events ?? []).length}
          />
        ))}
      </aside>

      {/* Sheet */}
      <section className="min-w-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-3xl">
          <header className="mb-4 flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] uppercase tracking-widest text-overlay0">
                {isScene ? t(lang, "ev.kind_scene") : "def" in owner ? t(lang, "ev.kind_template") : t(lang, "ev.kind_object")}
              </p>
              <h2 className="truncate text-lg font-semibold">{isScene ? scene.id : "def" in owner ? owner.def : (owner as { leaf: string }).leaf}</h2>
              <p className="text-[12px] text-subtext0">{isScene ? t(lang, "ev.scene_hint") : "def" in owner ? t(lang, "ev.template_hint") : t(lang, "ev.object_hint")}</p>
            </div>
            {"leaf" in owner && !locked && (
              <button onClick={() => extractObject((owner as { leaf: string }).leaf)} className="rounded-lg border border-surface1 px-2.5 py-1 text-[12px] text-subtext0 hover:border-mauve hover:text-text">
                {t(lang, "ev.make_template")}
              </button>
            )}
            <label className="flex items-center gap-1.5 text-[12px] text-subtext0">
              <input type="checkbox" checked={showCode} onChange={(e) => setShowCode(e.target.checked)} className="accent-mauve" />
              {t(lang, "ev.show_code")}
            </label>
          </header>

          {"def" in owner && <TemplateVars defId={owner.def} locked={locked} />}
          {isScene && <ScenePool sceneId={scene.id} pool={scene.pool} locked={locked} />}
          {isScene && <SceneCamera sceneId={scene.id} follow={scene.camera?.follow ?? ""} locked={locked} />}

          {problems.length > 0 && (
            <ul className="mb-3 space-y-1 rounded-lg border border-red/40 bg-red/5 p-2 text-[12px] text-red">
              {problems.slice(0, 8).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}

          <div className="space-y-3">
            {events.length === 0 && <p className="rounded-xl border border-dashed border-surface1 p-6 text-center text-[13px] text-subtext0">{t(lang, "ev.empty")}</p>}
            {events.map((e, i) => (
              <EventCard
                key={`${ownerKey(owner)}/${e.id}`}
                owner={owner}
                ev={e}
                first={i === 0}
                last={i === events.length - 1}
                ctx={{ ...baseCtx, other: e.trigger === "collide" }}
                code={showCode ? previewEvent(project, e, isScene) : null}
              />
            ))}
          </div>
          {!locked && <AddEventMenu owner={owner} isScene={isScene} />}
        </div>
      </section>
    </div>
  );
}

function OwnerButton({ active, onClick, icon, label, sub, n }: { active: boolean; onClick: () => void; icon: ReactNode; label: string; sub: string; n: number }) {
  return (
    <button
      onClick={onClick}
      className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${active ? "seg-active" : "text-subtext0 hover:bg-surface0 hover:text-text"}`}
    >
      <span className="grid w-5 shrink-0 place-items-center">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px]">{label}</span>
        {sub && <span className="block truncate text-[10px] opacity-70">{sub}</span>}
      </span>
      {n > 0 && <span className="rounded-full bg-surface0 px-1.5 font-mono text-[10px] text-subtext0">{n}</span>}
    </button>
  );
}

function TemplateVars({ defId, locked }: { defId: string; locked: boolean }) {
  const lang = useLang();
  const project = useStore(projectStore);
  const def = projectDefs(project).find((d) => d.id === defId);
  const [err, setErr] = useState<string | null>(null);
  if (!def) return null;
  return (
    <div className="mb-4 rounded-xl border border-surface0 p-3">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-widest text-overlay0">{t(lang, "ev.vars")}</p>
        {!locked && (
          <button onClick={() => addDefVar(defId)} className="flex items-center gap-1 text-[12px] text-subtext0 hover:text-text">
            <Plus size={12} /> {t(lang, "ev.add_var")}
          </button>
        )}
      </div>
      <p className="mb-2 text-[11px] text-overlay0">{t(lang, "ev.vars_hint")}</p>
      {(def.vars ?? []).map((v) => (
        <div key={v.id} className="mb-1 flex items-center gap-2">
          <input
            defaultValue={v.id}
            disabled={locked}
            onBlur={(e) => setErr(setDefVar(defId, v.id, { id: e.target.value }))}
            className="w-32 rounded-md border border-surface1 bg-base px-2 py-1 font-mono text-[12px] outline-none focus:border-mauve"
          />
          <span className="text-[11px] text-overlay0">{t(lang, "ev.starts_at")}</span>
          <input
            type="number"
            value={v.init}
            min={0}
            max={65535}
            disabled={locked}
            onChange={(e) => setDefVar(defId, v.id, { init: e.target.valueAsNumber })}
            className="w-20 rounded-md border border-surface1 bg-base px-2 py-1 text-right font-mono text-[12px] outline-none focus:border-mauve"
          />
          {!locked && (
            <button onClick={() => setErr(deleteDefVar(defId, v.id))} className="text-overlay0 hover:text-red" title={t(lang, "ev.delete")}>
              <X size={13} />
            </button>
          )}
        </div>
      ))}
      {err && <p className="text-[11px] text-red">{err}</p>}
    </div>
  );
}

function ScenePool({ sceneId, pool, locked }: { sceneId: string; pool?: number; locked: boolean }) {
  const lang = useLang();
  return (
    <div className="mb-4 flex items-center gap-2 rounded-xl border border-surface0 p-3 text-[12px] text-subtext0">
      <SquarePlus size={14} />
      <span className="flex-1">{t(lang, "ev.pool")}</span>
      <input
        type="number"
        min={0}
        max={64}
        placeholder={t(lang, "ev.pool_auto")}
        value={pool ?? ""}
        disabled={locked}
        onChange={(e) => setScenePool(sceneId, e.target.value === "" ? undefined : e.target.valueAsNumber)}
        className="w-20 rounded-md border border-surface1 bg-base px-2 py-1 text-right font-mono outline-none focus:border-mauve"
      />
    </div>
  );
}

function SceneCamera({ sceneId, follow, locked }: { sceneId: string; follow: string; locked: boolean }) {
  const lang = useLang();
  const project = useStore(projectStore);
  return (
    <div className="mb-4 flex items-center gap-2 rounded-xl border border-surface0 p-3 text-[12px] text-subtext0">
      <Video size={14} />
      <span className="flex-1" title={t(lang, "ev.camera_hint")}>
        {t(lang, "ev.camera")}
      </span>
      <select className="select" value={follow} disabled={locked} onChange={(e) => setSceneCamera(sceneId, e.target.value)}>
        <option value="">{t(lang, "ev.camera_fixed")}</option>
        {projectDefs(project).map((d) => (
          <option key={d.id} value={d.id}>
            {t(lang, "ev.camera_follow")} {d.id}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ---------------- events ---------------- */

function EventCard({ owner, ev, first, last, ctx, code }: { owner: EventOwner; ev: ObjectEvent; first: boolean; last: boolean; ctx: PickCtx; code: string[] | null }) {
  const lang = useLang();
  const locked = ctx.locked;
  const patch = (params: Parameters<typeof patchEvent>[2]): void => {
    patchEvent(owner, ev.id, params);
  };
  let title: ReactNode;
  switch (ev.trigger) {
    case "create":
      title = t(lang, ctx.scene ? "ev.t_scene_start" : "ev.t_create");
      break;
    case "step":
      title = t(lang, "ev.t_step");
      break;
    case "destroy":
      title = t(lang, "ev.t_destroy");
      break;
    case "key":
      title = (
        <>
          {t(lang, "ev.t_key_a")} <KeyChip input={ev.key} button={ev.button} locked={locked} onChange={(x) => patch(x.button ? { button: x.button, key: undefined } : { key: x.key, button: undefined })} /> {t(lang, "ev.t_key_b")}
        </>
      );
      break;
    case "click":
      title = t(lang, ctx.scene ? "ev.t_click_scene" : "ev.t_click");
      break;
    case "release":
      title = t(lang, "ev.t_release");
      break;
    case "collide":
      title = (
        <>
          {t(lang, "ev.t_collide")} <TargetChip value={ev.target ?? "any"} ctx={ctx} onChange={(target) => patch({ target })} />
          <span className="text-[11px] text-overlay0">{t(lang, "ev.t_collide_other")}</span>
        </>
      );
      break;
    case "alarm":
      title = (
        <>
          {t(lang, "ev.t_alarm_a")}{" "}
          <select className="select w-14" disabled={locked} value={ev.alarm ?? 0} onChange={(e) => patch({ alarm: Number(e.target.value) })}>
            {[0, 1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>{" "}
          {t(lang, "ev.t_alarm_b")}
        </>
      );
      break;
    case "message":
      title = (
        <>
          {t(lang, "ev.t_message_a")} <MessageChip message={ev.message ?? "go"} locked={locked} onChange={(message) => patch({ message })} /> {t(lang, "ev.t_message_b")}
        </>
      );
      break;
  }
  return (
    <article className="rounded-xl border border-surface0 bg-mantle/40">
      <div className="flex items-center gap-2 border-b border-surface0 px-3 py-2">
        <span className="h-4 w-1 rounded-full bg-mauve" />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-[13px] font-medium">{title}</div>
        {!locked && (
          <span className="flex items-center gap-0.5 text-overlay0">
            <IconBtn disabled={first} onClick={() => moveEvent(owner, ev.id, -1)} title={t(lang, "ev.up")}>
              <ArrowUp size={13} />
            </IconBtn>
            <IconBtn disabled={last} onClick={() => moveEvent(owner, ev.id, 1)} title={t(lang, "ev.down")}>
              <ArrowDown size={13} />
            </IconBtn>
            <IconBtn onClick={() => deleteEvent(owner, ev.id)} title={t(lang, "ev.delete")} danger>
              <Trash2 size={13} />
            </IconBtn>
          </span>
        )}
      </div>
      <div className="px-3 py-2">
        <ActionList owner={owner} eventId={ev.id} path={[]} blocks={ev.blocks} ctx={ctx} />
      </div>
      {code && (
        <pre data-nopan className="max-h-60 overflow-auto border-t border-surface0 bg-code px-3 py-2 font-mono text-[11px] leading-relaxed text-subtext0">
          {code.join("\n") || "( nothing )"}
        </pre>
      )}
    </article>
  );
}

function AddEventMenu({ owner, isScene }: { owner: EventOwner; isScene: boolean }) {
  const lang = useLang();
  const project = useStore(projectStore);
  return (
    <Popover
      width={320}
      title={t(lang, "ev.add_event")}
      trigger={() => (
        <span className="mt-4 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-dashed border-surface1 py-2.5 text-[13px] text-subtext0 transition-colors hover:border-mauve hover:text-text">
          <Plus size={14} /> {t(lang, "ev.add_event")}
        </span>
      )}
    >
      {(close) => (
        <div>
          {(isScene ? SCENE_TRIGGERS : OBJECT_TRIGGERS).map((tr) => (
            <button
              key={tr}
              onClick={() => {
                addEvent(owner, tr, tr === "key" ? { key: project.inputs[0]?.id, button: project.inputs[0] ? undefined : "a" } : {});
                close();
              }}
              className="flex w-full flex-col rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface0"
            >
              <span className="text-[13px] text-text">{t(lang, `ev.n_${tr}${isScene && (tr === "create" || tr === "click") ? "_scene" : ""}`)}</span>
              <span className="text-[11px] text-overlay0">{t(lang, `ev.d_${tr}${isScene && (tr === "create" || tr === "click") ? "_scene" : ""}`)}</span>
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

/* ---------------- actions ---------------- */

function ActionList({ owner, eventId, path, blocks, ctx }: { owner: EventOwner; eventId: string; path: BlockPath; blocks: Block[]; ctx: PickCtx }) {
  const lang = useLang();
  return (
    <div className="space-y-1">
      {blocks.length === 0 && <p className="py-1 text-[12px] italic text-overlay0">{t(lang, "ev.no_actions")}</p>}
      {blocks.map((b, i) => (
        <ActionRow key={i} owner={owner} eventId={eventId} path={path} index={i} block={b} count={blocks.length} ctx={ctx} />
      ))}
      {!ctx.locked && <AddActionMenu owner={owner} eventId={eventId} path={path} ctx={ctx} />}
    </div>
  );
}

function AddActionMenu({ owner, eventId, path, ctx }: { owner: EventOwner; eventId: string; path: BlockPath; ctx: PickCtx }) {
  const lang = useLang();
  return (
    <Popover
      width={360}
      title={t(lang, "ev.add_action")}
      trigger={() => (
        <span className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-overlay0 transition-colors hover:bg-surface0 hover:text-text">
          <Plus size={12} /> {t(lang, "ev.add_action")}
        </span>
      )}
    >
      {(close) => (
        <div className="space-y-2">
          {GROUPS.map((g) => (
            <div key={g.id}>
              <p className="mb-1 px-1 font-mono text-[10px] uppercase tracking-widest text-overlay0">{t(lang, `ev.g_${g.id}`)}</p>
              <div className="grid grid-cols-2 gap-1">
                {g.actions
                  .filter((a) => !(ctx.scene && a.objectOnly))
                  .map((a) => (
                    <button
                      key={a.op}
                      onClick={() => {
                        addBlockAt(owner, eventId, a.make(projectStore.get()), undefined, path);
                        close();
                      }}
                      title={t(lang, `ev.ad_${a.op}`)}
                      className="flex items-center gap-1.5 rounded-md border border-surface0 px-2 py-1 text-left text-[12px] text-subtext0 transition-colors hover:border-mauve hover:text-text"
                    >
                      <a.icon size={13} className="shrink-0" />
                      <span className="truncate">{t(lang, `ev.a_${a.op}`)}</span>
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Popover>
  );
}

function IconBtn({ children, onClick, title, disabled, danger }: { children: ReactNode; onClick: () => void; title: string; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`grid size-6 place-items-center rounded-md transition-colors disabled:opacity-30 ${danger ? "hover:bg-red/10 hover:text-red" : "hover:bg-surface0 hover:text-text"}`}
    >
      {children}
    </button>
  );
}

function ActionRow({ owner, eventId, path, index, block, count, ctx }: { owner: EventOwner; eventId: string; path: BlockPath; index: number; block: Block; count: number; ctx: PickCtx }) {
  const lang = useLang();
  const project = useStore(projectStore);
  const locked = ctx.locked;
  const set = (patch: Record<string, unknown>): void => {
    patchBlockAt(owner, eventId, index, patch, path);
  };
  const Icon = ICON.get(block.op) ?? Code2;
  const V = (field: string, value: Parameters<typeof ValueChip>[0]["value"], signed = false) => (
    <ValueChip value={value} ctx={ctx} signed={signed} onChange={(v) => set({ [field]: v })} />
  );
  const w = (k: string): string => t(lang, k);
  let body: ReactNode;
  switch (block.op) {
    case "move":
      body = (
        <>
          {w("ev.s_move")} x {V("dx", block.dx, true)} y {V("dy", block.dy, true)}
        </>
      );
      break;
    case "set_pos":
      body = (
        <>
          {w("ev.s_set_pos")} x {V("x", block.x)} y {V("y", block.y)}
        </>
      );
      break;
    case "glide":
      body = (
        <>
          {w("ev.s_glide")} x {V("x", block.x)} y {V("y", block.y)} {w("ev.s_in")}
          <input type="number" min={1} max={255} disabled={locked} value={block.frames} onChange={(e) => set({ frames: Math.max(1, Math.min(255, e.target.valueAsNumber || 1)) })} className="w-14 rounded-md border border-surface1 bg-base px-1.5 py-0.5 text-right font-mono text-[11px] outline-none focus:border-mauve" />
          {w("ev.s_frames")}
        </>
      );
      break;
    case "sprite":
      body = (
        <>
          {w("ev.s_sprite")} <SpriteChip sprite={block.sprite} cell={typeof block.cell === "number" ? block.cell : undefined} locked={locked} onChange={(sprite, cell) => set({ sprite, cell })} />
          {typeof block.cell === "object" && (
            <>
              {w("ev.s_cell")} {V("cell", block.cell)}
            </>
          )}
        </>
      );
      break;
    case "cell":
      body = (
        <>
          {w("ev.s_cell_set")} {V("cell", block.cell)}
        </>
      );
      break;
    case "look":
      body = (
        <>
          {w("ev.s_look")}
          <select className="select w-20" disabled={locked} value={block.blend ?? ""} onChange={(e) => set({ blend: e.target.value === "" ? undefined : Number(e.target.value) })}>
            <option value="">{w("ev.s_keep")}</option>
            {Array.from({ length: 16 }, (_, b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <FlipSel label="↔" value={block.flipX} locked={locked} onChange={(flipX) => set({ flipX })} />
          <FlipSel label="↕" value={block.flipY} locked={locked} onChange={(flipY) => set({ flipY })} />
        </>
      );
      break;
    case "show":
      body = w("ev.s_show");
      break;
    case "hide":
      body = w("ev.s_hide");
      break;
    case "text":
      body = (
        <>
          {w("ev.s_text")}
          <input
            value={block.text}
            maxLength={24}
            disabled={locked}
            onChange={(e) => set({ text: e.target.value.replace(/[^\x20-\x7e]/g, "").toUpperCase().slice(0, 24) })}
            className="w-32 rounded-md border border-surface1 bg-base px-1.5 py-0.5 font-mono text-[11px] outline-none focus:border-mauve"
          />
          {block.value !== undefined ? (
            <>
              {w("ev.s_then_number")} {V("value", block.value)}
              {!locked && (
                <button className="text-overlay0 hover:text-red" onClick={() => set({ value: undefined })} title={w("ev.delete")}>
                  <X size={11} />
                </button>
              )}
            </>
          ) : (
            !locked && (
              <button className="text-[11px] text-overlay0 hover:text-text" onClick={() => set({ value: 0 })}>
                + {w("ev.s_number")}
              </button>
            )
          )}
        </>
      );
      break;
    case "play":
      body = (
        <>
          {w("ev.s_play")} <SoundChip sound={block.sound} locked={locked} onChange={(sound) => set({ sound })} />
        </>
      );
      break;
    case "song":
      body = (
        <>
          {w("ev.s_song")} <SongChip song={block.song} locked={locked} onChange={(song) => set({ song })} />
        </>
      );
      break;
    case "song_stop":
      body = w("ev.s_song_stop");
      break;
    case "jump":
      body = (
        <>
          {w("ev.s_jump")} {V("power", block.power)}
        </>
      );
      break;
    case "goto":
      body = (
        <>
          {w("ev.s_goto")} <SceneChip scene={block.scene} locked={locked} onChange={(scene) => set({ scene })} />
        </>
      );
      break;
    case "overlay":
      body = (
        <>
          {w("ev.s_overlay")} <SceneChip scene={block.scene} locked={locked} onChange={(scene) => set({ scene })} /> {w("ev.s_overlay_b")}
        </>
      );
      break;
    case "back":
      body = w("ev.s_back");
      break;
    case "wait":
      body = (
        <>
          {w("ev.s_wait_a")}
          <select className="select w-12" disabled={locked} value={block.slot ?? 0} onChange={(e) => set({ slot: Number(e.target.value) || undefined })}>
            {[0, 1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          {w("ev.s_wait_b")} {V("ticks", block.ticks)} {w("ev.s_frames")}
        </>
      );
      break;
    case "destroy":
      body = (
        <>
          {w("ev.s_destroy")} <TargetChip destroy value={block.target ?? (ctx.scene ? "" : "self")} ctx={ctx} onChange={(target) => set({ target: target === "self" ? undefined : target })} />
        </>
      );
      break;
    case "spawn":
      body = (
        <>
          {w("ev.s_spawn")} <DefChip def={block.def} locked={locked} onChange={(def) => set({ def })} /> {w("ev.s_at")} x {V("x", block.x)} y {V("y", block.y)}
        </>
      );
      break;
    case "send":
      body = (
        <>
          {w("ev.s_send")} <MessageChip message={block.message} locked={locked} onChange={(message) => set({ message })} />
        </>
      );
      break;
    case "set":
      body = (
        <>
          <select className="select w-24" disabled={locked} value={block.mode} onChange={(e) => set({ mode: e.target.value })}>
            <option value="set">{w("ev.s_set")}</option>
            <option value="add">{w("ev.s_add")}</option>
            <option value="sub">{w("ev.s_sub")}</option>
          </select>
          <VarChip
            name={`${(block.scope ?? "global") === "self" ? `${w("blk.my")} ` : (block.scope ?? "global") === "other" ? `${w("blk.other_s")} ` : ""}${block.name}`}
            locked={locked}
            mine={ctx.scene ? undefined : { self: ctx.myVars, other: ctx.other ? ctx.allMyVars : [] }}
            onChange={(name, scope) => set({ name, scope: scope === "global" ? undefined : scope })}
          />
          {block.mode === "set" ? w("ev.s_to") : block.mode === "add" ? w("ev.s_by") : w("ev.s_by")} {V("value", block.value)}
        </>
      );
      break;
    case "if":
      body = (
        <>
          {w("ev.s_if")} <CondChip cond={block.cond} ctx={ctx} onChange={(cond) => set({ cond })} />
        </>
      );
      break;
    case "repeat":
      body = (
        <>
          {w("ev.s_repeat")} {V("times", block.times)} {w("ev.s_times")}
          {block.index ? (
            <>
              {w("ev.s_counter")} <VarChip name={block.index} locked={locked} onChange={(index) => set({ index })} />
            </>
          ) : (
            !locked && (
              <button className="text-[11px] text-overlay0 hover:text-text" onClick={() => set({ index: project.vars?.[0]?.id ?? addVariable("i") })}>
                + {w("ev.s_counter")}
              </button>
            )
          )}
        </>
      );
      break;
    case "call": {
      const fn = scriptFunctions(project).find((f) => f.name === block.fn);
      body = (
        <>
          {w("ev.s_call")} <FnChip fn={block.fn} locked={locked} onChange={(name, arity) => set({ fn: name, args: Array.from({ length: arity }, (_, i) => block.args?.[i] ?? 0) })} />
          {(block.args ?? []).map((a, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              <span className="text-[11px] text-overlay0">{fn?.params[i]?.name ?? `#${i + 1}`}</span>
              <ValueChip value={a} ctx={ctx} onChange={(v) => set({ args: (block.args ?? []).map((x, j) => (j === i ? v : x)) })} />
            </span>
          ))}
        </>
      );
      break;
    }
    case "code":
      body = (
        <div className="w-full">
          <p className="text-[11px] text-overlay0">{w("ev.s_code")}</p>
          <textarea
            data-nopan
            value={block.code}
            disabled={locked}
            spellCheck={false}
            rows={Math.min(10, block.code.split("\n").length + 1)}
            onChange={(e) => set({ code: e.target.value })}
            className="mt-1 w-full rounded-md border border-surface1 bg-code px-2 py-1 font-mono text-[11px] outline-none focus:border-mauve"
          />
        </div>
      );
      break;
  }
  return (
    <div className="group">
      <div className="flex items-start gap-2 rounded-lg px-1 py-1 hover:bg-surface0/40">
        <Icon size={14} className="mt-1 shrink-0 text-mauve" />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-[12px] text-text">{body}</div>
        {!locked && (
          <span className="flex shrink-0 items-center gap-0.5 text-overlay0 opacity-0 transition-opacity group-hover:opacity-100">
            <IconBtn disabled={index === 0} onClick={() => moveBlockAt(owner, eventId, index, index - 1, path)} title={t(lang, "ev.up")}>
              <ArrowUp size={12} />
            </IconBtn>
            <IconBtn disabled={index === count - 1} onClick={() => moveBlockAt(owner, eventId, index, index + 1, path)} title={t(lang, "ev.down")}>
              <ArrowDown size={12} />
            </IconBtn>
            <IconBtn onClick={() => deleteBlockAt(owner, eventId, index, path)} title={t(lang, "ev.delete")} danger>
              <Trash2 size={12} />
            </IconBtn>
          </span>
        )}
      </div>
      {block.op === "if" && (
        <div className="ml-3 border-l-2 border-mauve/30 pl-3">
          <ActionList owner={owner} eventId={eventId} path={[...path, index, "then"]} blocks={block.then ?? []} ctx={ctx} />
          {block.else ? (
            <>
              <p className="mt-1 text-[11px] font-medium text-subtext0">{t(lang, "ev.s_else")}</p>
              <ActionList owner={owner} eventId={eventId} path={[...path, index, "else"]} blocks={block.else} ctx={ctx} />
            </>
          ) : (
            !locked && (
              <button className="text-[11px] text-overlay0 hover:text-text" onClick={() => set({ else: [] })}>
                + {t(lang, "ev.s_else")}
              </button>
            )
          )}
        </div>
      )}
      {block.op === "repeat" && (
        <div className="ml-3 border-l-2 border-teal/30 pl-3">
          <ActionList owner={owner} eventId={eventId} path={[...path, index, "body"]} blocks={block.body ?? []} ctx={ctx} />
        </div>
      )}
    </div>
  );
}

function FlipSel({ label, value, onChange, locked }: { label: string; value?: boolean; onChange: (v: boolean | undefined) => void; locked: boolean }) {
  const lang = useLang();
  return (
    <select className="select w-24" disabled={locked} value={value === undefined ? "" : value ? "1" : "0"} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value === "1")}>
      <option value="">
        {label} {t(lang, "ev.s_keep")}
      </option>
      <option value="1">
        {label} {t(lang, "ev.s_flip_on")}
      </option>
      <option value="0">
        {label} {t(lang, "ev.s_flip_off")}
      </option>
    </select>
  );
}

export { Chip };
