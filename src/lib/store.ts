/* Project store: the single source of truth the canvas, inspector,
   sprite editor, graph, sound mixer and exporter all read.
   Persistence is account-only (localStorage) — the projects and
   studio pages sit behind RequireAuth, so there is no guest path. */
import { atom, computed } from "nanostores";
import {
  MAX_SCRIPTS,
  MAX_SONG_STEPS,
  MAX_SPRITE_TILES,
  SAMPLE_PROJECT,
  SCRIPT_STARTER,
  GENERATED_FILES,
  scriptTemplate,
  type LoopMode,
  flattenScene,
  migrateProject,
  projectDefs,
  spritePxOf,
  spriteTiles,
  type Block,
  type BlockOp,
  type BlockPath,
  type ButtonName,
  type EventTrigger,
  type FlatLeaf,
  type HitBox,
  type Animation,
  type ObjectDef,
  type ObjectEvent,
  type ObjectKind,
  type Project,
  type SceneNode,
  type Tilemap,
  type Value,
} from "./project";
import { eachBlock, mapBehaviour, renameRef, usesRef } from "./engine";

import { STDLIB } from "./stdlib";

const STDLIB_SET: Record<string, true> = Object.fromEntries(Object.keys(STDLIB).map((k) => [k, true]));
const STORE_KEY = "uxn.projects.v1";
const LEGACY_KEY = "uxn.project";

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "game"
  );
}

function freshSample(): Project {
  return structuredClone(SAMPLE_PROJECT);
}

function loadAll(): { projects: Record<string, Project>; current: string } {
  const fallback = () => ({ projects: { demo: freshSample() }, current: "demo" });
  if (typeof localStorage === "undefined") return fallback();
  const raw = localStorage.getItem(STORE_KEY);
  try {
    if (raw) {
      const anyRaw = JSON.parse(raw) as Record<string, unknown>;
      if (anyRaw["projects"] && typeof anyRaw["projects"] === "object") {
        const projects: Record<string, Project> = {};
        for (const [id, p] of Object.entries(anyRaw["projects"] as Record<string, unknown>)) {
          projects[id] = migrateProject(p as Record<string, unknown>);
        }
        const ids = Object.keys(projects);
        if (ids.length > 0) {
          const current =
            typeof anyRaw["current"] === "string" && projects[anyRaw["current"]]
              ? (anyRaw["current"] as string)
              : ids[0];
          const out = { projects, current };
          return out;
        }
      } else {
        // Single-project shape (current or legacy): migrate in place.
        const parsed = migrateProject(anyRaw);
        if (parsed.scenes.some((s) => s.id === parsed.start)) {
          return { projects: { [parsed.id]: parsed }, current: parsed.id };
        }
      }
    }
    // One-time migration from the single-project era (localStorage only).
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const p = JSON.parse(legacy) as Project;
      const id = p.id && /^[A-Za-z][A-Za-z0-9_]*$/.test(p.id) ? p.id : "demo";
      return { projects: { [id]: { ...p, id } }, current: id };
    }
  } catch {
    /* corrupt — start fresh */
  }
  return fallback();
}

const _initial = typeof localStorage === "undefined" ? null : loadAll();

export const projectsStore = atom<Record<string, Project>>(
  _initial?.projects ?? { demo: freshSample() },
);
export const currentIdStore = atom<string>(_initial?.current ?? "demo");
export const projectStore = computed(
  [projectsStore, currentIdStore],
  (all, id) => all[id] ?? all[Object.keys(all)[0]],
);
export const sceneIdStore = atom<string>(SAMPLE_PROJECT.start);
export const selectionStore = atom<string | null>(null);
export const spriteSelStore = atom<string>("hero");
/** Selected object template (right panel shows its Object Editor).
    Mutually exclusive with selectionStore: picking one clears the other. */
export const defSelStore = atom<string | null>(null);
export const paintColorStore = atom<number>(1);
export const paintToolStore = atom<"brush" | "erase" | "pick">("brush");
export const voiceSelStore = atom<number>(0);
/** Selected named sound (right panel shows its SoundEditor).
    Mutually exclusive with voiceSelStore the same way defSel is
    with selectionStore: picking one clears the other. */
export const soundSelStore = atom<string | null>(null);
/** Script-loop projects have nothing to show on the scene canvas, so
    a fresh /studio load lands them on their code (openProject sets the
    same thing, but the navigation to /studio reloads every store). */
const _startScript = (() => {
  const all = _initial?.projects;
  const id = _initial?.current;
  return !!(all && id && all[id]?.loop === "script");
})();
export const codeFileStore = atom<string>(_startScript ? "custom.ux" : "main.ux");
/** Compiler diagnostics from the last Check/Playtest/Export, so the
    Code page can list them and jump to file:line. */
export const diagnosticsStore = atom<Array<{ file: string | null; line: number | null; col: number | null; msg: string }>>([]);
/** Selected named snippet (Code page edits it). Independent from
    codeFileStore: files and snippets share the editor shell. */
export const snippetSelStore = atom<string | null>(null);
/** Selected named song (Sound page edits it). */
export const songSelStore = atom<string | null>(null);
export const viewStore = atom<"scene" | "sprites" | "events" | "sound" | "code">(_startScript ? "code" : "scene");

/* Canvas-first studio chrome. viewStore above now only opens the
   sprite/sound/code dialogs; the canvas itself runs on these. */
export const canvasModeStore = atom<"scene" | "logic">("scene");
/** Blocks-view level: the scene map first, double-click a scene to
    drill into its objects. */
export const mapLevelStore = atom<"map" | "objects">("objects");
export const overlayStore = atom<{ left: boolean; right: boolean }>({ left: true, right: true });
export function toggleOverlay(side: "left" | "right"): void {
  const cur = overlayStore.get();
  overlayStore.set(side === "left" ? { ...cur, left: !cur.left } : { ...cur, right: !cur.right });
}
/** Playtest blob URL (null = closed). closePlaytest revokes it so
    repeated runs never leak object URLs. */
export const playtestStore = atom<string | null>(null);
export function openPlaytest(url: string): void {
  const prev = playtestStore.get();
  if (prev) URL.revokeObjectURL(prev);
  playtestStore.set(url);
}
/** Bumped to ask the header to compile + open a playtest (it owns the
    busy/error state); lets the script-loop banner offer Playtest. */
export const playRequestStore = atom<number>(0);
export function requestPlaytest(): void {
  playRequestStore.set(playRequestStore.get() + 1);
}
/** sessionStorage flag: "start a playtest once /studio opens this
    project" (the Projects page Play button). */
export const PLAY_ON_OPEN_KEY = "uxn.playOnOpen";
export function closePlaytest(): void {
  const prev = playtestStore.get();
  if (prev) URL.revokeObjectURL(prev);
  playtestStore.set(null);
}
export const viewportStore = atom<{ x: number; y: number; k: number; snap: boolean; grid: boolean }>({
  x: 0,
  y: 0,
  k: 1,
  snap: true,
  grid: true,
});
export function patchViewport(patch: Partial<{ x: number; y: number; k: number; snap: boolean; grid: boolean }>): void {
  viewportStore.set({ ...viewportStore.get(), ...patch });
}
export function resetViewport(): void {
  viewportStore.set({ ...viewportStore.get(), x: 0, y: 0, k: 1 });
}

/* Free-canvas block positions (Blocks view): scenes on the map,
   objects inside a drilled scene. Blocks stay where left; missing
   entries cascade. Pure chrome — validation and emit ignore it. */
export function sceneNodePos(p: Project, sceneId: string, index: number): { x: number; y: number } {
  return (
    p.layout?.scenes?.[sceneId] ?? { x: 60 + (index % 4) * 240, y: 80 + Math.floor(index / 4) * 140 }
  );
}
export function setSceneNodePos(sceneId: string, x: number, y: number): void {
  updateCurrent((prev) => ({
    ...prev,
    layout: {
      ...(prev.layout ?? {}),
      scenes: { ...(prev.layout?.scenes ?? {}), [sceneId]: { x: Math.round(x), y: Math.round(y) } },
    },
  }));
}
export function objectNodePos(p: Project, sceneId: string, path: string, index: number): { x: number; y: number } {
  return (
    p.layout?.objects?.[sceneId]?.[path] ?? { x: 60 + (index % 3) * 440, y: 60 + Math.floor(index / 3) * 200 }
  );
}
export function setObjectNodePos(sceneId: string, path: string, x: number, y: number): void {
  updateCurrent((prev) => ({
    ...prev,
    layout: {
      ...(prev.layout ?? {}),
      objects: {
        ...(prev.layout?.objects ?? {}),
        [sceneId]: { ...(prev.layout?.objects?.[sceneId] ?? {}), [path]: { x: Math.round(x), y: Math.round(y) } },
      },
    },
  }));
}

if (typeof localStorage !== "undefined") {
  const persist = (all: Record<string, Project>, id: string) => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ projects: all, current: id }));
    } catch {
      /* quota/private mode — memory copy keeps working */
    }
  };
  projectsStore.subscribe((all) => persist(all, currentIdStore.get()));
  currentIdStore.subscribe((id) => persist(projectsStore.get(), id));
}

function touch(p: Project): Project {
  return { ...p, updatedAt: Date.now() };
}

export function openProject(id: string): void {
  const all = projectsStore.get();
  if (!all[id]) return;
  currentIdStore.set(id);
  sceneIdStore.set(all[id].start || all[id].scenes[0]?.id || "");
  selectionStore.set(null);
  viewStore.set(all[id].kind === "code" || all[id].loop === "script" ? "code" : "scene");
  codeFileStore.set(all[id].loop === "script" ? "custom.ux" : "main.ux");
  snippetSelStore.set(null);
  diagnosticsStore.set([]);
}

export function createProject(name: string, loop: LoopMode = "engine"): string {
  const clean = name.trim().slice(0, 48) || "Untitled";
  let id = slug(clean);
  const all = projectsStore.get();
  let n = 2;
  while (all[`${id}`]) id = `${slug(clean)}-${n++}`;
  const base = freshSample();
  const p: Project = {
    ...base,
    id,
    name: clean,
    author: base.author,
    scenes: [{ id: "main", nodes: [] }],
    start: "main",
    updatedAt: Date.now(),
    ...(loop === "script" ? { loop, customCode: SCRIPT_STARTER } : {}),
  };
  projectsStore.set({ ...all, [id]: p });
  openProject(id);
  return id;
}

/** Fork any project (including locked showcases) into an editable
    copy. The copy keeps every scene, sprite, sound and script;
    only identity and the lock change. */
export function duplicateProject(copyWord: string): string | null {
  const id = currentIdStore.get();
  const all = projectsStore.get();
  const src = all[id];
  if (!src) return null;
  let nid = `${src.id}_copy`;
  let n = 2;
  while (all[nid]) nid = `${src.id}_copy_${n++}`;
  const copy: Project = {
    ...structuredClone(src),
    id: nid,
    name: `${src.name} (${copyWord})`.slice(0, 48),
    locked: false,
    updatedAt: Date.now(),
  };
  projectsStore.set({ ...all, [nid]: copy });
  openProject(nid);
  return nid;
}

export function deleteProject(id: string): void {
  const all = { ...projectsStore.get() };
  delete all[id];
  const rest = Object.keys(all);
  if (rest.length === 0) {
    const fresh = freshSample();
    projectsStore.set({ [fresh.id]: touch(fresh) });
    openProject(fresh.id);
    return;
  }
  projectsStore.set(all);
  if (currentIdStore.get() === id) openProject(rest[0]);
}

function updateCurrent(fn: (p: Project) => Project): void {
  const id = currentIdStore.get();
  const all = projectsStore.get();
  if (!all[id] || all[id].locked) return; // locked examples are read-only
  projectsStore.set({ ...all, [id]: touch(fn(all[id])) });
}

/** Clamp a dragged position so the 8px sprite stays on-canvas. */
/** Clamp a top-left origin so a sw×sh object stays on canvas.
    Defaults keep the legacy 8px contract (see workflow.test.ts). */
export function clampToCanvas(x: number, y: number, w: number, h: number, sw = 8, sh = 8): [number, number] {
  return [
    Math.min(Math.max(0, Math.round(x)), Math.max(0, w - sw)),
    Math.min(Math.max(0, Math.round(y)), Math.max(0, h - sh)),
  ];
}

/** Flattened leaves of a scene; [] when the chain is broken (mid-edit). */
export function flattenLeaves(p: Project, sceneId: string): FlatLeaf[] {
  try {
    return flattenScene(p, sceneId);
  } catch {
    return [];
  }
}

export function currentScene(p: Project, sceneId: string) {
  return p.scenes.find((s) => s.id === sceneId) ?? p.scenes[0];
}

/** A node list address: scene + path of branch ids to the list. */
export interface ListRef {
  sceneId: string;
  parent: string[];
}

/** Resolve which scene DEFINITION owns the list (branch children
    live in their home scene — editing them edits every instance,
    Godot-style). Returns null on broken chains. */
export function resolveHome(p: Project, sceneId: string, parent: string[]): string | null {
  let current = sceneId;
  for (const seg of parent) {
    const scene = p.scenes.find((s) => s.id === current);
    const branch = scene?.nodes.find((n) => n.id === seg);
    if (!branch?.scene || !p.scenes.some((s) => s.id === branch.scene)) return null;
    current = branch.scene;
  }
  return current;
}

/** Read the node list at a ref (top level or inside branches). */
export function readList(p: Project, ref: ListRef): SceneNode[] {
  const home = resolveHome(p, ref.sceneId, ref.parent);
  return p.scenes.find((s) => s.id === home)?.nodes ?? [];
}

function writeList(p: Project, ref: ListRef, nodes: SceneNode[]): Project {
  const home = resolveHome(p, ref.sceneId, ref.parent);
  if (!home) return p;
  return {
    ...p,
    scenes: p.scenes.map((s) => (s.id !== home ? s : { ...s, nodes })),
  };
}

/** All scene ids in a branch's subtree (cycle guard for moves). */
export function subtreeScenes(p: Project, node: SceneNode): Set<string> {
  const out = new Set<string>();
  const walk = (n: SceneNode): void => {
    if (!n.scene) return;
    if (out.has(n.scene)) return;
    out.add(n.scene);
    for (const child of p.scenes.find((s) => s.id === n.scene)?.nodes ?? []) walk(child);
  };
  walk(node);
  return out;
}

/** Absolute origin of a parent chain (for nested drag math). */
export function parentOrigin(p: Project, sceneId: string, parent: string[]): [number, number] {
  let x = 0;
  let y = 0;
  let current = sceneId;
  for (const seg of parent) {
    const node = p.scenes.find((s) => s.id === current)?.nodes.find((n) => n.id === seg);
    if (!node) break;
    x += node.x;
    y += node.y;
    if (!node.scene) break;
    current = node.scene;
  }
  return [x, y];
}

export function moveObject(project: Project, sceneId: string, objectId: string, x: number, y: number): Project {
  const node = project.scenes.find((s) => s.id === sceneId)?.nodes.find((o) => o.id === objectId);
  const [sw, sh] = node?.sprite ? spritePxOf(project, node.sprite) : [8, 8];
  const [cx, cy] = clampToCanvas(x, y, project.width, project.height, sw, sh);
  return {
    ...project,
    scenes: project.scenes.map((s) =>
      s.id !== sceneId
        ? s
        : {
            ...s,
            nodes: s.nodes.map((o): SceneNode => (o.id === objectId ? { ...o, x: cx, y: cy } : o)),
          },
    ),
  };
}

/** Apply fn to the node list addressed by (sceneId, parent),
    writing through to whichever home scene owns it. */
function updateListAt(
  p: Project,
  sceneId: string,
  parent: string[],
  fn: (nodes: SceneNode[]) => SceneNode[],
): Project {
  let home = sceneId;
  for (const seg of parent) {
    const branch = p.scenes.find((s) => s.id === home)?.nodes.find((n) => n.id === seg);
    if (!branch?.scene || !p.scenes.some((s) => s.id === branch.scene)) return p;
    home = branch.scene;
  }
  return {
    ...p,
    scenes: p.scenes.map((s) => (s.id !== home ? s : { ...s, nodes: fn(s.nodes) })),
  };
}

/** Drag any leaf (top-level or nested) to an absolute point. */
export function moveLeafByPath(sceneId: string, path: string, x: number, y: number): void {
  const segs = path.split("/");
  if (segs.length <= 1) {
    setObjectPos(segs[0], x, y);
    return;
  }
  const p = projectStore.get();
  const parent = segs.slice(0, -1);
  const list = readList(p, { sceneId, parent });
  const index = list.findIndex((n) => n.id === segs[segs.length - 1]);
  if (index >= 0) moveInstancePos({ sceneId, parent }, index, x, y);
}

/** Drag a nested instance: convert the absolute drop point back into
    the instance's parent-relative offset. */
export function moveInstancePos(ref: ListRef, index: number, absX: number, absY: number): void {
  const p = projectStore.get();
  const [ox, oy] = parentOrigin(p, ref.sceneId, ref.parent);
  const node = readList(p, ref)[index];
  const [sw, sh] = node?.sprite ? spritePxOf(p, node.sprite) : [8, 8];
  // Clamp the absolute landing point, then store the parent-relative
  // offset (which may legitimately go negative).
  const [cx, cy] = clampToCanvas(absX, absY, p.width, p.height, sw, sh);
  const nx = Math.round(cx - ox);
  const ny = Math.round(cy - oy);
  updateCurrent((prev) => {
    const cur = readList(prev, ref);
    if (index < 0 || index >= cur.length) return prev;
    return updateListAt(prev, ref.sceneId, ref.parent, (nodes) =>
      nodes.map((o, i) => (i === index ? { ...o, x: nx, y: ny } : o)),
    );
  });
}

export function setObjectPos(objectId: string, x: number, y: number): void {
  const p = projectStore.get();
  const scene = currentScene(p, sceneIdStore.get());
  updateCurrent((prev) => moveObject(prev, scene.id, objectId, x, y));
}

export function patchObject(objectId: string, patch: Partial<SceneNode>): void {
  const p = projectStore.get();
  const scene = currentScene(p, sceneIdStore.get());
  updateCurrent((prev) => ({
    ...prev,
    scenes: prev.scenes.map((s) =>
      s.id !== scene.id
        ? s
        : { ...s, nodes: s.nodes.map((o) => (o.id === objectId ? { ...o, ...patch } : o)) },
    ),
  }));
}

/** Set (or clear) a leaf's dialogue label. Printable ASCII only, 24
    chars max — the same gate validation applies, refused here so the
    editor and the agent cannot write an unassemblable label. */
export function setLeafLabel(leafId: string, label: string | undefined): string | null {
  const p = projectStore.get();
  const scene = currentScene(p, sceneIdStore.get());
  const node = scene.nodes.find((o) => o.id === leafId && !o.scene);
  if (!node) return `unknown leaf '${leafId}'`;
  if (label !== undefined && (label.length === 0 || label.length > 24 || /[^\x20-\x7e]/.test(label)))
    return "label must be 1–24 printable ASCII chars";
  patchObject(leafId, { label });
  return null;
}

/** Set how a top-level leaf draws: sheet cell, flips, Varvara blend.
    Only the given fields change; null clears one back to default. */
export function setLeafLook(
  leafId: string,
  look: { cell?: number | null; flipX?: boolean | null; flipY?: boolean | null; blend?: number | null },
): string | null {
  const p = projectStore.get();
  if (p.locked) return "this example is read-only — duplicate it to edit";
  const scene = currentScene(p, sceneIdStore.get());
  const node = scene.nodes.find((o) => o.id === leafId && !o.scene);
  if (!node) return `unknown leaf '${leafId}'`;
  if (look.blend != null && (!Number.isInteger(look.blend) || look.blend < 0 || look.blend > 15)) return "blend must be 0–15";
  if (look.cell != null && (!Number.isInteger(look.cell) || look.cell < 0)) return "cell must be a whole number ≥ 0";
  const patch: Partial<SceneNode> = {};
  if (look.cell !== undefined) patch.cell = look.cell || undefined;
  if (look.flipX !== undefined) patch.flipX = look.flipX || undefined;
  if (look.flipY !== undefined) patch.flipY = look.flipY || undefined;
  if (look.blend !== undefined) patch.blend = look.blend === null || look.blend === 1 ? undefined : look.blend;
  patchObject(leafId, patch);
  return null;
}

/* Behaviour editing: events on templates, inline objects and scenes.
   Owners address a template ({def}), an inline object ({leaf}, in the
   current scene unless `scene` is given) or a scene ({scene}). */

/** An event owner: a template, an inline object, or a scene. */
export type EventOwner = { def: string } | { leaf: string; scene?: string } | { scene: string };

export function readOwnerEvents(p: Project, owner: EventOwner): ObjectEvent[] | null {
  if ("def" in owner) {
    const def = projectDefs(p).find((d) => d.id === owner.def);
    return def ? (def.events ?? []) : null;
  }
  if ("leaf" in owner) {
    const scene = owner.scene ? p.scenes.find((s) => s.id === owner.scene) : currentScene(p, sceneIdStore.get());
    const node = scene?.nodes.find((o) => o.id === owner.leaf && !o.scene);
    if (!node || node.def) return null;
    return node.events ?? [];
  }
  const scene = p.scenes.find((s) => s.id === owner.scene);
  return scene ? (scene.events ?? []) : null;
}

function writeOwnerEvents(owner: EventOwner, fn: (events: ObjectEvent[]) => ObjectEvent[]): boolean {
  const p = projectStore.get();
  if (p.locked || readOwnerEvents(p, owner) === null) return false;
  updateCurrent((prev) => {
    if ("def" in owner) {
      return { ...prev, objectDefs: projectDefs(prev).map((d) => (d.id === owner.def ? { ...d, events: fn(d.events ?? []) } : d)) };
    }
    if ("leaf" in owner) {
      const sid = owner.scene ?? currentScene(prev, sceneIdStore.get()).id;
      return {
        ...prev,
        scenes: prev.scenes.map((s) =>
          s.id !== sid ? s : { ...s, nodes: s.nodes.map((o) => (o.id === owner.leaf && !o.scene ? { ...o, events: fn(o.events ?? []) } : o)) },
        ),
      };
    }
    return { ...prev, scenes: prev.scenes.map((s) => (s.id === owner.scene ? { ...s, events: fn(s.events ?? []) } : s)) };
  });
  return true;
}

const TRIGGERS_ALL: EventTrigger[] = ["create", "step", "destroy", "key", "click", "release", "collide", "alarm", "message"];

export interface EventParams {
  key?: string;
  button?: ButtonName;
  target?: string;
  alarm?: number;
  message?: string;
}

/** Add an event; returns its id (ev_N). Unknown owner or trigger, or
    a scene asked for an object-only trigger, are refused. Parameters
    are stored as given (validation reports dangling references, so
    the editor can create the event first and pick its key after). */
export function addEvent(owner: EventOwner, trigger: EventTrigger, params: EventParams = {}): string | null {
  const p = projectStore.get();
  const cur = readOwnerEvents(p, owner);
  if (!cur || !TRIGGERS_ALL.includes(trigger)) return null;
  if ("scene" in owner && !("leaf" in owner) && (trigger === "collide" || trigger === "destroy")) return null;
  let id = "ev_1";
  let n = 2;
  while (cur.some((e) => e.id === id)) id = `ev_${n++}`;
  const event: ObjectEvent = { id, trigger, ...cleanParams(trigger, params, p), blocks: [] };
  return writeOwnerEvents(owner, (events) => [...events, event]) ? id : null;
}

function cleanParams(trigger: EventTrigger, params: EventParams, p: Project): Partial<ObjectEvent> {
  if (trigger === "key") return params.button ? { button: params.button } : { key: params.key ?? p.inputs[0]?.id ?? "" };
  if (trigger === "collide") return { target: params.target ?? "any" };
  if (trigger === "alarm") return params.alarm ? { alarm: params.alarm } : {};
  if (trigger === "message") return { message: params.message ?? "go" };
  return {};
}

/** Change an event's trigger details (key, button, target, timer,
    message). The trigger itself stays — delete and re-add to change it. */
export function patchEvent(owner: EventOwner, eventId: string, params: EventParams): boolean {
  const p = projectStore.get();
  const ev = readOwnerEvents(p, owner)?.find((e) => e.id === eventId);
  if (!ev) return false;
  return writeOwnerEvents(owner, (events) =>
    events.map((e) => {
      if (e.id !== eventId) return e;
      const { key: _k, button: _b, target: _t, alarm: _a, message: _m, ...rest } = e;
      void _k, _b, _t, _a, _m;
      return { ...rest, ...cleanParams(e.trigger, { ...e, ...params }, p) } as ObjectEvent;
    }),
  );
}

export function deleteEvent(owner: EventOwner, eventId: string): boolean {
  const p = projectStore.get();
  const cur = readOwnerEvents(p, owner);
  if (!cur || !cur.some((e) => e.id === eventId)) return false;
  return writeOwnerEvents(owner, (events) => events.filter((e) => e.id !== eventId));
}

export function moveEvent(owner: EventOwner, eventId: string, delta: number): boolean {
  const p = projectStore.get();
  const cur = readOwnerEvents(p, owner);
  const i = cur?.findIndex((e) => e.id === eventId) ?? -1;
  if (!cur || i < 0 || i + delta < 0 || i + delta >= cur.length) return false;
  return writeOwnerEvents(owner, (events) => {
    const copy = [...events];
    const [e] = copy.splice(i, 1);
    copy.splice(i + delta, 0, e);
    return copy;
  });
}

export const BLOCK_OPS: BlockOp[] = [
  "move", "set_pos", "glide", "sprite", "cell", "look", "show", "hide", "text",
  "play", "song", "song_stop", "goto", "overlay", "back", "wait", "destroy", "spawn",
  "send", "set", "if", "repeat", "call", "jump", "code",
];

type Seg = number | "then" | "else" | "body";

/** The child list a (block index, branch) pair opens. */
function childOf(b: Block | undefined, br: Seg | undefined): Block[] | null {
  if (!b) return null;
  if (b.op === "if" && (br === "then" || br === "else")) return br === "then" ? (b.then ?? []) : (b.else ?? []);
  if (b.op === "repeat" && br === "body") return b.body ?? [];
  return null;
}

/** Immutable read of a (possibly nested) list. */
export function readBlocksAt(blocks: Block[], parent: Seg[]): Block[] | null {
  let arr: Block[] | null = blocks;
  for (let i = 0; i < parent.length; i += 2) {
    const idx = parent[i];
    if (typeof idx !== "number" || !arr) return null;
    arr = childOf(arr[idx], parent[i + 1]);
  }
  return arr;
}

/** Immutable rewrite of one nested list. */
function writeBlocksAt(blocks: Block[], parent: Seg[], fn: (arr: Block[]) => Block[]): Block[] | null {
  if (parent.length === 0) return fn(blocks);
  const [idx, br, ...rest] = parent;
  if (typeof idx !== "number") return null;
  const target = blocks[idx];
  const child = childOf(target, br);
  if (!child) return null;
  const patched = writeBlocksAt([...child], rest, fn);
  if (!patched) return null;
  return blocks.map((b, i) => {
    if (i !== idx) return b;
    if (b.op === "if") return br === "then" ? { ...b, then: patched } : { ...b, else: patched };
    if (b.op === "repeat") return { ...b, body: patched };
    return b;
  });
}

function editEventBlocks(owner: EventOwner, eventId: string, path: BlockPath, fn: (arr: Block[]) => Block[] | null): boolean {
  const p = projectStore.get();
  const ev = readOwnerEvents(p, owner)?.find((e) => e.id === eventId);
  if (!ev || !readBlocksAt(ev.blocks, path)) return false;
  let ok = true;
  const done = writeOwnerEvents(owner, (events) =>
    events.map((e) => {
      if (e.id !== eventId) return e;
      const next = writeBlocksAt(e.blocks, path, (arr) => {
        const r = fn(arr);
        if (!r) {
          ok = false;
          return arr;
        }
        return r;
      });
      return next ? { ...e, blocks: next } : e;
    }),
  );
  return done && ok;
}

/** Insert (default: append) an action. `path` addresses a nested
    if branch or repeat body (default top level). */
export function addBlockAt(owner: EventOwner, eventId: string, block: Block, index: number | undefined, path: BlockPath = []): boolean {
  if (!block || !BLOCK_OPS.includes(block.op)) return false;
  return editEventBlocks(owner, eventId, path, (arr) => {
    const copy = [...arr];
    copy.splice(index === undefined ? arr.length : Math.min(Math.max(0, index), arr.length), 0, block);
    return copy;
  });
}

export function addBlock(owner: EventOwner, eventId: string, block: Block, index?: number): boolean {
  return addBlockAt(owner, eventId, block, index, []);
}

/** Merge fields into one action. `undefined` clears a field. */
export function patchBlockAt(owner: EventOwner, eventId: string, index: number, patch: Record<string, unknown>, path: BlockPath = []): boolean {
  return editEventBlocks(owner, eventId, path, (list) => {
    if (index < 0 || index >= list.length) return null;
    return list.map((b, i) => {
      if (i !== index) return b;
      const nextB = { ...b, ...patch } as Record<string, unknown>;
      for (const [k, v] of Object.entries(patch)) if (v === undefined) delete nextB[k];
      return nextB as unknown as Block;
    });
  });
}

export function patchBlock(owner: EventOwner, eventId: string, index: number, patch: Record<string, unknown>): boolean {
  return patchBlockAt(owner, eventId, index, patch, []);
}

export function deleteBlockAt(owner: EventOwner, eventId: string, index: number, path: BlockPath = []): boolean {
  return editEventBlocks(owner, eventId, path, (list) => (index < 0 || index >= list.length ? null : list.filter((_, i) => i !== index)));
}

export function deleteBlock(owner: EventOwner, eventId: string, index: number): boolean {
  return deleteBlockAt(owner, eventId, index, []);
}

export function moveBlockAt(owner: EventOwner, eventId: string, from: number, to: number, path: BlockPath = []): boolean {
  return editEventBlocks(owner, eventId, path, (list) => {
    if (from < 0 || from >= list.length || to < 0 || to >= list.length) return null;
    const copy = [...list];
    const [b] = copy.splice(from, 1);
    copy.splice(to, 0, b);
    return copy;
  });
}

export function moveBlock(owner: EventOwner, eventId: string, from: number, to: number): boolean {
  return moveBlockAt(owner, eventId, from, to, []);
}

/** Set (or clear, when mask is undefined) the hitbox on a template
    or a top-level leaf. Bounds are validation's job, like the
    editors — this just writes. */
export function setMask(target: { def: string } | { leaf: string }, mask: HitBox | undefined): string | null {
  const p = projectStore.get();
  if ("def" in target) {
    if (!projectDefs(p).some((d) => d.id === target.def)) return `unknown object '${target.def}'`;
    updateCurrent((prev) => ({
      ...prev,
      objectDefs: projectDefs(prev).map((d) => (d.id === target.def ? { ...d, mask } : d)),
    }));
    return null;
  }
  const scene = currentScene(p, sceneIdStore.get());
  const node = scene.nodes.find((o) => o.id === target.leaf && !o.scene);
  if (!node) return `unknown object '${target.leaf}'`;
  updateCurrent((prev) => {
    const home = currentScene(prev, sceneIdStore.get());
    return {
      ...prev,
      scenes: prev.scenes.map((s) =>
        s.id !== home.id ? s : { ...s, nodes: s.nodes.map((o) => (o.id === target.leaf ? { ...o, mask } : o)) },
      ),
    };
  });
  return null;
}

/** Patch a template (unknown sprite/anim/kind refused with a message).
    Movable implies solid, same as the editors. */
export function patchDef(defId: string, patch: Partial<ObjectDef>): string | null {
  const p = projectStore.get();
  if (patch.sprite !== undefined && !p.sprites.some((s) => s.id === patch.sprite))
    return `unknown sprite ${patch.sprite}`;
  if (patch.anim !== undefined && !p.anims.some((a) => a.id === patch.anim))
    return `unknown animation ${patch.anim}`;
  if (patch.kind !== undefined && patch.kind !== "player" && patch.kind !== "static" && patch.kind !== "movable")
    return `bad kind '${(patch as { kind: unknown }).kind}'`;
  updateCurrent((prev) => ({
    ...prev,
    objectDefs: projectDefs(prev).map((d) =>
      d.id === defId ? { ...d, ...patch, ...(patch.kind === "movable" ? { solid: true } : {}) } : d,
    ),
  }));
  return null;
}

export function setTile(objectId: string, tile: number[]): void {
  // Legacy 1bpp paint API: upgrades into the shared sprite.
  const p = projectStore.get();
  const scene = currentScene(p, sceneIdStore.get());
  const obj = scene.nodes.find((o) => o.id === objectId);
  if (!obj) return;
  setSpritePixels(obj.sprite ?? "", tile.flatMap((b) => Array.from({ length: 8 }, (_, c) => (b & (1 << (7 - c)) ? 1 : 0))));
}

export function setSpritePixels(spriteId: string, pixels: number[]): void {
  const sprite = projectStore.get().sprites.find((s) => s.id === spriteId);
  const [tw, th] = sprite ? spriteTiles(sprite) : [1, 1];
  const want = 64 * tw * th;
  const clean = pixels.slice(0, want).map((v) => v & 3);
  while (clean.length < want) clean.push(0);
  updateCurrent((prev) => ({
    ...prev,
    sprites: prev.sprites.map((s) => (s.id === spriteId ? { ...s, pixels: clean } : s)),
  }));
}

export function addSprite(name: string, w = 1, h = 1): string {
  let base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "sprite";
  if (!/^[A-Za-z]/.test(base)) base = `s_${base}`;
  let id = base;
  let n = 2;
  const p = projectStore.get();
  while (p.sprites.some((s) => s.id === id)) id = `${base}_${n++}`;
  const tw = Number.isInteger(w) && w >= 1 && w <= MAX_SPRITE_TILES ? w : 1;
  const th = Number.isInteger(h) && h >= 1 && h <= MAX_SPRITE_TILES ? h : 1;
  updateCurrent((prev) => ({
    ...prev,
    sprites: [...prev.sprites, { id, w: tw, h: th, pixels: Array(64 * tw * th).fill(0) }],
  }));
  spriteSelStore.set(id);
  return id;
}

/** Resize a sprite, preserving the top-left overlap and clearing new
    tiles. Objects using it re-clamp on next move; the emitter reads
    live dims, so nothing else must change. */
export function setSpriteSize(spriteId: string, w: number, h: number): void {
  const tw = Math.min(MAX_SPRITE_TILES, Math.max(1, Math.round(w) || 1));
  const th = Math.min(MAX_SPRITE_TILES, Math.max(1, Math.round(h) || 1));
  updateCurrent((prev) => ({
    ...prev,
    sprites: prev.sprites.map((s) => {
      if (s.id !== spriteId) return s;
      const [ow, oh] = spriteTiles(s);
      if (ow === tw && oh === th) return s;
      const next: number[] = [];
      for (let ty = 0; ty < th; ty++) {
        for (let tx = 0; tx < tw; tx++) {
          for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
              next.push(tx < ow && ty < oh ? (s.pixels[(tx + ty * ow) * 64 + r * 8 + c] ?? 0) : 0);
            }
          }
        }
      }
      // A sheet grid that no longer divides the sprite is dropped.
      const cell = s.cell && tw % s.cell.w === 0 && th % s.cell.h === 0 ? s.cell : undefined;
      return { ...s, w: tw, h: th, pixels: next, cell };
    }),
  }));
}

/** Make a sprite a sheet of cw×ch-tile cells (null = whole sprite).
    Refused unless the cell evenly divides the sprite. */
export function setSpriteCell(spriteId: string, cell: { w: number; h: number } | null): string | null {
  const p = projectStore.get();
  const s = p.sprites.find((x) => x.id === spriteId);
  if (!s) return `unknown sprite '${spriteId}'`;
  const [w, h] = spriteTiles(s);
  if (cell && (w % cell.w !== 0 || h % cell.h !== 0)) return `a ${cell.w}×${cell.h} cell must divide the ${w}×${h} sprite`;
  const whole = !cell || (cell.w === w && cell.h === h);
  updateCurrent((prev) => ({
    ...prev,
    sprites: prev.sprites.map((x) => (x.id === spriteId ? { ...x, cell: whole ? undefined : cell! } : x)),
  }));
  return null;
}

/** Patch rate/loop/pingpong (frames have dedicated fns below). */
export function patchAnimation(animId: string, patch: Partial<Animation>): void {
  updateCurrent((prev) => ({
    ...prev,
    anims: prev.anims.map((a) => (a.id === animId ? { ...a, ...patch } : a)),
  }));
}

/** Append a frame. Refused when the sprite is unknown, already 16
    frames, or sized differently (frames swap one address — mixed
    sizes would tear). */
export function addAnimFrame(animId: string, spriteId: string): string | null {
  const p = projectStore.get();
  const anim = p.anims.find((a) => a.id === animId);
  if (!anim) return `unknown animation '${animId}'`;
  const sprite = p.sprites.find((s) => s.id === spriteId);
  if (!sprite) return `unknown sprite '${spriteId}'`;
  if (anim.frames.length >= 16) return "animation holds at most 16 frames";
  const [w, h] = spriteTiles(sprite);
  const [fw, fh] = spriteTiles(p.sprites.find((s) => s.id === anim.frames[0]) ?? { id: "", pixels: [] });
  if (anim.frames.length > 0 && (w !== fw || h !== fh)) return `sprite must match ${fw}×${fh} tiles`;
  updateCurrent((prev) => ({
    ...prev,
    anims: prev.anims.map((a) => (a.id === animId ? { ...a, frames: [...a.frames, spriteId] } : a)),
  }));
  return null;
}

/** Reorder frames (filmstrip ←/→). Ends refuse; middle swaps. */
export function moveAnimFrame(animId: string, index: number, dir: -1 | 1): boolean {
  const p = projectStore.get();
  if (p.locked) return false;
  const anim = p.anims.find((a) => a.id === animId);
  if (!anim) return false;
  const j = index + dir;
  if (index < 0 || index >= anim.frames.length || j < 0 || j >= anim.frames.length) return false;
  updateCurrent((prev) => ({
    ...prev,
    anims: prev.anims.map((a) => {
      if (a.id !== animId) return a;
      const frames = [...a.frames];
      [frames[index], frames[j]] = [frames[j], frames[index]];
      return { ...a, frames };
    }),
  }));
  return true;
}

/** Drop a frame; the last one stays (validation needs 1–16). */
export function removeAnimFrame(animId: string, index: number): boolean {
  const p = projectStore.get();
  const anim = p.anims.find((a) => a.id === animId);
  if (!anim || anim.frames.length <= 1 || index < 0 || index >= anim.frames.length) return false;
  updateCurrent((prev) => ({
    ...prev,
    anims: prev.anims.map((a) => (a.id === animId ? { ...a, frames: a.frames.filter((_, i) => i !== index) } : a)),
  }));
  return true;
}

export function addAnimation(spriteIds: string[]): string {
  const p = projectStore.get();
  let id = "anim";
  let n = 2;
  while (p.anims.some((a) => a.id === id)) id = `anim_${n++}`;
  updateCurrent((prev) => ({
    ...prev,
    anims: [...prev.anims, { id, frames: spriteIds.length > 0 ? spriteIds : [prev.sprites[0]?.id ?? "hero"], rate: 30, loop: true }],
  }));
  return id;
}

export function addScene(): string {
  const p = projectStore.get();
  let id = "scene";
  let n = 2;
  while (p.scenes.some((s) => s.id === id)) id = `scene_${n++}`;
  updateCurrent((prev) => ({
    ...prev,
    scenes: [...prev.scenes, { id, nodes: [], clicks: [], keys: [] }],
  }));
  sceneIdStore.set(id);
  selectionStore.set(null);
  return id;
}

/** Reorder scenes (header tab drag). The start scene follows its id. */
export function reorderScenes(from: number, to: number): void {
  const p = projectStore.get();
  if (from === to || from < 0 || to < 0 || from >= p.scenes.length || to >= p.scenes.length) return;
  updateCurrent((prev) => {
    const scenes = [...prev.scenes];
    const [moved] = scenes.splice(from, 1);
    scenes.splice(to, 0, moved);
    return { ...prev, scenes };
  });
}

export function deleteScene(id: string): void {
  const p = projectStore.get();
  if (p.scenes.length <= 1) return;
  updateCurrent((prev) => {
    // Scene changes into the deleted scene go too (validation would
    // otherwise flag every one of them).
    const cleaned = mapBehaviour(prev, { block: (b) => ((b.op === "goto" || b.op === "overlay") && b.scene === id ? null : b) });
    const scenes = cleaned.scenes.filter((s) => s.id !== id);
    const start = prev.start === id ? scenes[0].id : prev.start;
    return { ...cleaned, start, scenes };
  });
  if (sceneIdStore.get() === id) {
    const rest = projectStore.get().scenes;
    sceneIdStore.set(rest[0].id);
    selectionStore.set(null);
  }
}

export function addObject(kind: ObjectKind = "static", name = "", sprite?: string, x?: number, y?: number): string {
  const p = projectStore.get();
  const scene = currentScene(p, sceneIdStore.get());
  const clean = name.trim().slice(0, 24);
  let id = clean && /^[A-Za-z][A-Za-z0-9_]*$/.test(clean) ? clean : "obj";
  let n = 2;
  const base = id;
  while (scene.nodes.some((o) => o.id === id)) id = `${base}_${n++}`;
  const spriteId = sprite ?? p.sprites[0]?.id ?? "hero";
  const [sw, sh] = spritePxOf(p, spriteId);
  const [cx, cy] =
    x === undefined || y === undefined
      ? clampToCanvas(8 + scene.nodes.length * 12, 8, p.width, p.height, sw, sh)
      : clampToCanvas(x, y, p.width, p.height, sw, sh);
  const obj: SceneNode = {
    id,
    x: cx,
    y: cy,
    sprite: spriteId,
    kind,
    ...(kind === "player" ? { controls: true } : {}),
    ...(kind === "movable" ? { solid: true } : {}),
  };
  const ref = { sceneId: scene.id, parent: [] as string[] };
  if (!addNode(ref, obj)) return id;
  selectionStore.set(id);
  return id;
}

export function deleteObject(objectId: string): void {
  const p = projectStore.get();
  const scene = currentScene(p, sceneIdStore.get());
  const ref = { sceneId: scene.id, parent: [] as string[] };
  const index = readList(p, ref).findIndex((o) => o.id === objectId);
  if (index >= 0) deleteNode(ref, index);
}

/** Rename an object id everywhere it is referenced (click bindings). */
export function renameObject(oldId: string, newId: string): string | null {
  const clean = newId.trim().slice(0, 24);
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(clean)) return "bad id";
  const p = projectStore.get();
  const scene = currentScene(p, sceneIdStore.get());
  if (oldId !== clean && scene.nodes.some((o) => o.id === clean)) return "duplicate id";
  updateCurrent((prev) => ({
    ...prev,
    scenes: prev.scenes.map((s) =>
      s.id !== scene.id
        ? s
        : {
            ...s,
            nodes: s.nodes.map((o) => (o.id === oldId ? { ...o, id: clean } : o)),
          },
    ),
  }));
  if (selectionStore.get() === oldId) selectionStore.set(clean);
  return null;
}

/* Object templates: the GameMaker Object in our Object ≠ Sprite ≠
   Instance split. Defs live in their own library; leaves reference
   them by id and override per field. */

/** Create a template from art + behavior defaults. Selects it for editing. */
export function addDef(name: string, sprite?: string, kind: ObjectKind = "static"): string {
  const p = projectStore.get();
  let base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "object";
  if (!/^[A-Za-z]/.test(base)) base = `o_${base}`;
  let id = base;
  let n = 2;
  const defs = projectDefs(p);
  while (defs.some((d) => d.id === id)) id = `${base}_${n++}`;
  const spriteId = sprite && p.sprites.some((s) => s.id === sprite) ? sprite : (p.sprites[0]?.id ?? "hero");
  const def: ObjectDef = { id, sprite: spriteId, kind, ...(kind === "movable" ? { solid: true } : {}) };
  updateCurrent((prev) => ({ ...prev, objectDefs: [...projectDefs(prev), def] }));
  defSelStore.set(id);
  selectionStore.set(null);
  return id;
}

/** Rename a template id everywhere it is referenced (instances). */
export function renameDef(oldId: string, newId: string): string | null {
  const clean = newId.trim().slice(0, 24);
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(clean)) return "bad id";
  const p = projectStore.get();
  if (oldId !== clean && projectDefs(p).some((d) => d.id === clean)) return "duplicate id";
  updateCurrent((prev) => ({
    ...renameRef(prev, "def", oldId, clean),
    objectDefs: projectDefs(renameRef(prev, "def", oldId, clean)).map((d) => (d.id === oldId ? { ...d, id: clean } : d)),
    scenes: renameRef(prev, "def", oldId, clean).scenes.map((s) => ({
      ...s,
      nodes: s.nodes.map((o) => (o.def === oldId ? { ...o, def: clean } : o)),
    })),
  }));
  if (defSelStore.get() === oldId) defSelStore.set(clean);
  return null;
}

/** Delete a template, baking its effective values into instances so
    the game plays byte-identically without it (GameMaker deletes
    placements instead — baking is the non-destructive version). */
export function deleteDef(defId: string): void {
  const p = projectStore.get();
  const def = projectDefs(p).find((d) => d.id === defId);
  if (!def) return;
  const bake = (o: SceneNode): SceneNode => {
    if (o.def !== defId) return o;
    const { def: _drop, ...rest } = o;
    void _drop;
    return {
      ...rest,
      sprite: o.sprite ?? def.sprite,
      kind: o.kind ?? def.kind,
      solid: o.solid ?? def.solid,
      controls: o.controls ?? def.controls,
      anim: o.anim ?? def.anim,
      mask: o.mask ?? def.mask,
      label: o.label ?? def.label,
      cell: o.cell ?? def.cell,
      flipX: o.flipX ?? def.flipX,
      flipY: o.flipY ?? def.flipY,
      blend: o.blend ?? def.blend,
      // An inline object owns events again; per-instance variable
      // values have no template left to belong to.
      events: (def.events ?? []).map((e) => structuredClone(e)),
      vars: undefined,
    };
  };
  updateCurrent((prev) => ({
    ...prev,
    objectDefs: projectDefs(prev).filter((d) => d.id !== defId),
    scenes: prev.scenes.map((s) => ({ ...s, nodes: s.nodes.map(bake) })),
  }));
  if (defSelStore.get() === defId) defSelStore.set(null);
}

/** Stamp an instance of a template on a scene (default: current).
    Returns "" for an unknown def. */
export function addInstance(defId: string, x = 8, y = 8, name = "", sceneId?: string): string {
  const p = projectStore.get();
  const def = projectDefs(p).find((d) => d.id === defId);
  if (!def) return "";
  const scene = p.scenes.find((s) => s.id === (sceneId ?? sceneIdStore.get())) ?? currentScene(p, sceneIdStore.get());
  const clean = name.trim().slice(0, 24);
  let id = clean && /^[A-Za-z][A-Za-z0-9_]*$/.test(clean) ? clean : defId;
  let n = 2;
  const base = id;
  while (scene.nodes.some((o) => o.id === id)) id = `${base}_${n++}`;
  const [sw, sh] = spritePxOf(p, def.sprite);
  const [cx, cy] = clampToCanvas(x, y, p.width, p.height, sw, sh);
  const ref = { sceneId: scene.id, parent: [] as string[] };
  if (!addNode(ref, { id, x: cx, y: cy, def: defId })) return "";
  sceneIdStore.set(scene.id);
  selectionStore.set(id);
  defSelStore.set(null);
  return id;
}

/** Convert a top-level inline leaf into a template + instance pair.
    Effective values become the def; the leaf keeps id/x/y and drops
    the rest (pure overrides from then on). Returns the def id. */
export function extractObject(objectId: string): string | null {
  const p = projectStore.get();
  const scene = currentScene(p, sceneIdStore.get());
  const node = scene.nodes.find((o) => o.id === objectId);
  if (!node || node.scene || node.def) return null;
  const defs = projectDefs(p);
  let id = node.id;
  let n = 2;
  while (defs.some((d) => d.id === id)) id = `${node.id}_${n++}`;
  const def: ObjectDef = {
    id,
    sprite: node.sprite ?? p.sprites[0]?.id ?? "hero",
    kind: node.kind ?? "static",
    solid: node.solid,
    controls: node.controls,
    anim: node.anim,
    mask: node.mask,
    label: node.label,
    cell: node.cell,
    flipX: node.flipX,
    flipY: node.flipY,
    blend: node.blend,
    events: node.events ?? [],
  };
  updateCurrent((prev) => ({
    ...prev,
    objectDefs: [...projectDefs(prev), def],
    scenes: prev.scenes.map((s) =>
      s.id !== scene.id
        ? s
        : { ...s, nodes: s.nodes.map((o) => (o.id === objectId ? { id: o.id, x: o.x, y: o.y, def: id } : o)) },
    ),
  }));
  defSelStore.set(id);
  selectionStore.set(null);
  return id;
}

export function addNode(ref: ListRef, node: SceneNode): boolean {
  const p = projectStore.get();
  if (readList(p, ref).some((o) => o.id === node.id)) return false;
  let ok = false;
  updateCurrent((prev) => {
    if (readList(prev, ref).some((o) => o.id === node.id)) return prev;
    ok = true;
    return updateListAt(prev, ref.sceneId, ref.parent, (nodes) => [...nodes, node]);
  });
  return ok;
}

/** Reorder within one list (hierarchy drag). Slots follow. */
export function reorderNodes(ref: ListRef, from: number, to: number): void {
  const p = projectStore.get();
  const len = readList(p, ref).length;
  if (from === to || from < 0 || to < 0 || from >= len || to >= len) return;
  updateCurrent((prev) =>
    updateListAt(prev, ref.sceneId, ref.parent, (nodes) => {
      const next = [...nodes];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    }),
  );
}

/** Move a node between lists, with cycle guard for branches. */
export function moveNode(src: ListRef, index: number, dst: ListRef): boolean {
  const p = projectStore.get();
  const node = readList(p, src)[index];
  if (!node) return false;
  if (node.scene) {
    // A branch dragged into its own subtree would cycle.
    const dstHome = resolveHome(p, dst.sceneId, dst.parent);
    if (dstHome && (dstHome === node.scene || subtreeScenes(p, node).has(dstHome))) return false;
    // Target budget counts flattened leaves, checked at validation;
    // refuse only the obviously absurd here.
    void 0;
  }
  let moved = false;
  updateCurrent((prev) => {
    const cur = readList(prev, src)[index];
    if (!cur) return prev;
    moved = true;
    const without = updateListAt(prev, src.sceneId, src.parent, (nodes) =>
      nodes.filter((_, i) => i !== index),
    );
    return updateListAt(without, dst.sceneId, dst.parent, (nodes) => [...nodes, cur]);
  });
  return moved;
}

/** Reorder within the current top-level list (compat wrapper). */
export function reorderObject(from: number, to: number): void {
  reorderNodes({ sceneId: sceneIdStore.get(), parent: [] }, from, to);
}

/** Move a top-level object to another scene (compat wrapper). */
export function moveObjectToScene(objectId: string, targetSceneId: string): void {
  const p = projectStore.get();
  const scene = currentScene(p, sceneIdStore.get());
  if (scene.id === targetSceneId) return;
  const index = scene.nodes.findIndex((o) => o.id === objectId);
  if (index < 0) return;
  if (moveNode({ sceneId: scene.id, parent: [] }, index, { sceneId: targetSceneId, parent: [] })) {
    sceneIdStore.set(targetSceneId);
    selectionStore.set(objectId);
  }
}

/** Delete a node (click bindings cleaned for top-level leaves). */
export function deleteNode(ref: ListRef, index: number): void {
  const p = projectStore.get();
  const node = readList(p, ref)[index];
  if (!node) return;
  updateCurrent((prev) => {
    const next = updateListAt(prev, ref.sceneId, ref.parent, (nodes) =>
      nodes.filter((_, i) => i !== index),
    );
    return next;
  });
  const sel = selectionStore.get();
  if (sel === node.id || sel?.endsWith(`/${node.id}`)) selectionStore.set(null);
}

export function resizeProject(w: number, h: number): void {
  updateCurrent((prev) => ({
    ...prev,
    width: w,
    height: h,
    scenes: prev.scenes.map((s) => ({
      ...s,
      nodes: s.nodes.map((o) => {
        const [sw, sh] = o.sprite ? spritePxOf(prev, o.sprite) : [8, 8];
        const [cx, cy] = clampToCanvas(o.x, o.y, w, h, sw, sh);
        return { ...o, x: cx, y: cy };
      }),
    })),
  }));
}

/** Find-or-create a named input for a key code (shared per code),
    so the press-a-key picker never duplicates `key_32` five times. */
export function addInput(key: number, name = ""): string {
  const code = Math.min(255, Math.max(0, Math.round(key) || 0));
  const p = projectStore.get();
  const inputs = p.inputs ?? [];
  const shared = inputs.find((i) => i.key === code && i.id.startsWith("key_"));
  if (shared) return shared.id;
  let base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24);
  if (!/^[A-Za-z]/.test(base)) base = `key_${code}`;
  let id = base;
  let n = 2;
  while (inputs.some((i) => i.id === id)) id = `${base}_${n++}`;
  updateCurrent((prev) => ({ ...prev, inputs: [...(prev.inputs ?? []), { id, key: code }] }));
  return id;
}

/** Spare object slots for spawn actions in a scene (undefined = auto). */
export function setScenePool(sceneId: string, pool: number | undefined): void {
  updateCurrent((prev) => ({
    ...prev,
    scenes: prev.scenes.map((s) => (s.id !== sceneId ? s : { ...s, pool: pool === undefined ? undefined : Math.max(0, Math.min(64, Math.round(pool))) })),
  }));
}

/** Camera: follow the first live instance of a template ("" = fixed). */
export function setSceneCamera(sceneId: string, follow: string): void {
  updateCurrent((prev) => ({
    ...prev,
    scenes: prev.scenes.map((s) => (s.id !== sceneId ? s : { ...s, camera: follow ? { follow } : undefined })),
  }));
}

/** Replace (or remove) a scene's tile layer. */
export function setSceneTilemap(sceneId: string, tilemap: Tilemap | undefined): void {
  updateCurrent((prev) => ({
    ...prev,
    scenes: prev.scenes.map((s) => (s.id !== sceneId ? s : { ...s, tilemap })),
  }));
}

/** Paint one cell of a scene's tile layer (0 = empty, n = sheet cell n-1). */
export function paintTile(sceneId: string, col: number, row: number, value: number): void {
  updateCurrent((prev) => ({
    ...prev,
    scenes: prev.scenes.map((s) => {
      const tm = s.tilemap;
      if (s.id !== sceneId || !tm || col < 0 || row < 0 || col >= tm.cols || row >= tm.rows) return s;
      const tiles = [...tm.tiles];
      tiles[row * tm.cols + col] = value;
      return { ...s, tilemap: { ...tm, tiles } };
    }),
  }));
}

export function setTheme(theme: { r: number; g: number; b: number }): void {
  updateCurrent((prev) => ({ ...prev, theme }));
}

/** Scene background palette index (0–3); out-of-range writes are ignored. */
export function setProjectBg(bg: number): void {
  if (!Number.isInteger(bg) || bg < 0 || bg > 3) return;
  updateCurrent((prev) => ({ ...prev, bg }));
}

export function setVoice(index: number, note: number, vol: number): void {
  updateCurrent((prev) => {
    const voices = [0, 1, 2, 3].map((i) => prev.sound?.voices[i] ?? { note: 0, vol: 0 });
    voices[index] = { note, vol };
    return { ...prev, sound: { voices } };
  });
}

/* Named one-shot sounds: the Phase 3 library behind play blocks. All
   four voices travel with the sound (index = Audio device); the boot
   mix above stays exactly as it was. */

/** Add a sound with an audible voice 0 (the rest silent), so the
    new library entry validates immediately. Selects it. */
export function addSound(name: string): string {
  const p = projectStore.get();
  let base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "sound";
  if (!/^[A-Za-z]/.test(base)) base = `s_${base}`;
  let id = base;
  let n = 2;
  const sounds = p.sounds ?? [];
  while (sounds.some((s) => s.id === id)) id = `${base}_${n++}`;
  updateCurrent((prev) => ({
    ...prev,
    sounds: [
      ...(prev.sounds ?? []),
      { id, voices: [{ note: 72, vol: 120 }, { note: 0, vol: 0 }, { note: 0, vol: 0 }, { note: 0, vol: 0 }] },
    ],
  }));
  soundSelStore.set(id);
  return id;
}

/** Set one voice of a named sound. Unknown sound or voice refused. */
export function setSoundVoice(soundId: string, voice: number, note: number, vol: number): string | null {
  const p = projectStore.get();
  if (!(p.sounds ?? []).some((s) => s.id === soundId)) return `unknown sound '${soundId}'`;
  if (!Number.isInteger(voice) || voice < 0 || voice > 3) return `voice must be 0–3`;
  updateCurrent((prev) => ({
    ...prev,
    sounds: (prev.sounds ?? []).map((s) =>
      s.id !== soundId
        ? s
        : {
            ...s,
            voices: [0, 1, 2, 3].map((i) =>
              i === voice
                ? {
                    note: Math.min(107, Math.max(0, Math.round(note))),
                    vol: Math.min(255, Math.max(0, Math.round(vol))),
                  }
                : (s.voices[i] ?? { note: 0, vol: 0 }),
            ),
          },
    ),
  }));
  return null;
}

/** Rename a sound id everywhere play blocks reference it. */
export function renameSound(oldId: string, newId: string): string | null {
  const clean = newId.trim().slice(0, 24);
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(clean)) return "bad id";
  const p = projectStore.get();
  if (oldId !== clean && (p.sounds ?? []).some((s) => s.id === clean)) return "duplicate id";
  updateCurrent((prev) => ({
    ...renameRef(prev, "sound", oldId, clean),
    sounds: (prev.sounds ?? []).map((s) => (s.id === oldId ? { ...s, id: clean } : s)),
  }));
  if (soundSelStore.get() === oldId) soundSelStore.set(clean);
  return null;
}

/** Delete a named sound. Refused while a play block names it —
    retarget (or delete) those blocks first. */
export function deleteSound(soundId: string): string | null {
  const p = projectStore.get();
  if (!(p.sounds ?? []).some((s) => s.id === soundId)) return `unknown sound '${soundId}'`;
  if (usesRef(p, "sound", soundId)) return `sound '${soundId}' is still played by an action`;
  updateCurrent((prev) => ({ ...prev, sounds: (prev.sounds ?? []).filter((s) => s.id !== soundId) }));
  if (soundSelStore.get() === soundId) soundSelStore.set(null);
  return null;
}

/* Named u16 variables: the Phase B library behind set/if blocks.
   Same contract as sounds/snippets (unique ids, refcounted delete);
   set/if blocks and hand snippets share the `var_<id>[0]` cells. */

function cleanVarId(name: string): string {
  let base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "var";
  if (!/^[A-Za-z]/.test(base)) base = `v_${base}`;
  return base;
}

/** Add a variable with a boot init (validates immediately). */
export function addVariable(name: string, init = 0): string {
  const p = projectStore.get();
  let id = cleanVarId(name);
  let n = 2;
  const vars = p.vars ?? [];
  while (vars.some((v) => v.id === id)) id = `${cleanVarId(name)}_${n++}`;
  const clean = Number.isInteger(init) && init >= 0 && init <= 65535 ? init : 0;
  updateCurrent((prev) => ({
    ...prev,
    vars: [...(prev.vars ?? []), { id, init: clean }],
  }));
  return id;
}

/** Rename a variable id everywhere set/if blocks reference it. */
export function renameVariable(oldId: string, newId: string): string | null {
  const clean = newId.trim().slice(0, 24);
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(clean)) return "bad id";
  const p = projectStore.get();
  if (oldId !== clean && (p.vars ?? []).some((v) => v.id === clean)) return "duplicate id";
  updateCurrent((prev) => ({
    ...renameRef(prev, "var", oldId, clean),
    vars: (prev.vars ?? []).map((v) => (v.id === oldId ? { ...v, id: clean } : v)),
  }));
  return null;
}

/** Set a variable's boot init. */
export function setVariableInit(variableId: string, init: number): string | null {
  const p = projectStore.get();
  if (!(p.vars ?? []).some((v) => v.id === variableId)) return `unknown variable '${variableId}'`;
  if (!Number.isInteger(init) || init < 0 || init > 65535) return "init must be 0–65535";
  updateCurrent((prev) => ({
    ...prev,
    vars: (prev.vars ?? []).map((v) => (v.id === variableId ? { ...v, init } : v)),
  }));
  return null;
}

/** Delete a named variable. Refused while a set/if block names it. */
export function deleteVariable(variableId: string): string | null {
  const p = projectStore.get();
  if (!(p.vars ?? []).some((v) => v.id === variableId)) return `unknown variable '${variableId}'`;
  if (usesRef(p, "var", variableId)) return `variable '${variableId}' is still used by an action`;
  updateCurrent((prev) => ({ ...prev, vars: (prev.vars ?? []).filter((v) => v.id !== variableId) }));
  return null;
}

/* Named song loops: the Phase C library behind song blocks. Same
   contract as sounds/snippets (unique ids, refcounted delete), with
   a 4x16 step grid. Songs play through the shared sequencer, so one
   loops across scene switches. */

/** Add a song with a short audible arpeggio on voice 0, so the new
    entry validates immediately. Selects it. */
export function addSong(name: string): string {
  const p = projectStore.get();
  let base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "song";
  if (!/^[A-Za-z]/.test(base)) base = `song_${base}`;
  let id = base;
  let n = 2;
  const songs = p.songs ?? [];
  while (songs.some((s) => s.id === id)) id = `${base}_${n++}`;
  updateCurrent((prev) => ({
    ...prev,
    songs: [
      ...(prev.songs ?? []),
      {
        id,
        tracks: [
          { notes: [{ pitch: 60, len: 2 }, { pitch: 64, len: 2 }, { pitch: 67, len: 2 }, { pitch: 72, len: 2 }], vol: 180 },
          { notes: [], vol: 0 },
          { notes: [], vol: 0 },
          { notes: [], vol: 0 },
        ],
      },
    ],
  }));
  songSelStore.set(id);
  return id;
}

/** Rename a song id everywhere song blocks reference it. */
export function renameSong(oldId: string, newId: string): string | null {
  const clean = newId.trim().slice(0, 24);
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(clean)) return "bad id";
  const p = projectStore.get();
  if (oldId !== clean && (p.songs ?? []).some((s) => s.id === clean)) return "duplicate id";
  updateCurrent((prev) => ({
    ...renameRef(prev, "song", oldId, clean),
    songs: (prev.songs ?? []).map((s) => (s.id === oldId ? { ...s, id: clean } : s)),
  }));
  if (songSelStore.get() === oldId) songSelStore.set(clean);
  return null;
}

/** Set one step of a song voice. `null` pitch clears the step; out of
    range values are refused rather than clamped (validation is the
    contract, the editor never writes an invalid project). */
export function setSongNote(songId: string, voice: number, step: number, pitch: number | null, len = 2): string | null {
  const p = projectStore.get();
  if (!(p.songs ?? []).some((s) => s.id === songId)) return `unknown song '${songId}'`;
  if (!Number.isInteger(voice) || voice < 0 || voice > 3) return "voice must be 0–3";
  if (!Number.isInteger(step) || step < 0 || step >= MAX_SONG_STEPS) return `step must be 0–${MAX_SONG_STEPS - 1}`;
  if (pitch !== null && !(Number.isInteger(pitch) && ((pitch >= 0 && pitch <= 107) || pitch === 127)))
    return "pitch must be 0–107 or 127 (rest)";
  const l = Math.min(255, Math.max(1, Math.round(len)));
  updateCurrent((prev) => ({
    ...prev,
    songs: (prev.songs ?? []).map((s) =>
      s.id !== songId
        ? s
        : {
            ...s,
            tracks: s.tracks.map((tr, vi) => {
              if (vi !== voice) return tr;
              const notes = tr.notes.slice();
              while (notes.length < step) notes.push({ pitch: 127, len: 1 });
              if (pitch === null) notes.length = Math.min(notes.length, step);
              else notes[step] = { pitch, len: l };
              return { ...tr, notes };
            }),
          },
    ),
  }));
  return null;
}

/** Set a song voice's volume. */
export function setSongVol(songId: string, voice: number, vol: number): string | null {
  const p = projectStore.get();
  if (!(p.songs ?? []).some((s) => s.id === songId)) return `unknown song '${songId}'`;
  if (!Number.isInteger(voice) || voice < 0 || voice > 3) return "voice must be 0–3";
  if (!Number.isInteger(vol) || vol < 0 || vol > 255) return "vol must be 0–255";
  updateCurrent((prev) => ({
    ...prev,
    songs: (prev.songs ?? []).map((s) =>
      s.id === songId ? { ...s, tracks: s.tracks.map((tr, i) => (i === voice ? { ...tr, vol } : tr)) } : s,
    ),
  }));
  return null;
}

/** Delete a named song. Refused while a song block names it. */
export function deleteSong(songId: string): string | null {
  const p = projectStore.get();
  if (!(p.songs ?? []).some((s) => s.id === songId)) return `unknown song '${songId}'`;
  if (usesRef(p, "song", songId)) return `song '${songId}' is still started by an action`;
  updateCurrent((prev) => ({ ...prev, songs: (prev.songs ?? []).filter((s) => s.id !== songId) }));
  if (songSelStore.get() === songId) songSelStore.set(null);
  return null;
}

const SCRIPT_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

function cleanScriptPath(name: string): string {
  let base = name.trim().replace(/\.ux$/i, "").replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 28) || "script";
  if (!/^[A-Za-z]/.test(base)) base = `s_${base}`;
  return `${base}.ux`;
}

function takenPaths(p: Project): Set<string> {
  return new Set<string>([...GENERATED_FILES, ...(p.scripts ?? []).map((s) => s.path)]);
}

export function setCustomCode(code: string): void {
  updateCurrent((prev) => (prev.kind === "visual" ? { ...prev, customCode: code } : prev));
}

export function setLoopMode(loop: LoopMode): void {
  updateCurrent((prev) => {
    if (prev.kind !== "visual") return prev;
    const next: Project = { ...prev, loop };
    // Switching an empty project to the script loop seeds a working
    // custom_frame, so the first Playtest already shows something.
    if (loop === "script" && !(prev.customCode ?? "").trim()) next.customCode = SCRIPT_STARTER;
    return next;
  });
}

/** Toggle "the game draws its own mouse cursor" (web builds then
    hide the browser pointer over the game). */
export function setGameCursor(on: boolean): void {
  updateCurrent((prev) => ({ ...prev, gameCursor: on || undefined }));
}

/** Add a script module (unique .ux name) and open it. */
export function addScript(name: string, code?: string): string | null {
  const p = projectStore.get();
  if (p.locked || p.kind !== "visual") return "locked";
  if ((p.scripts ?? []).length >= MAX_SCRIPTS) return `at most ${MAX_SCRIPTS} scripts`;
  const taken = takenPaths(p);
  let path = cleanScriptPath(name);
  let n = 2;
  while (taken.has(path) || path in STDLIB_SET) path = `${cleanScriptPath(name).replace(/\.ux$/, "")}_${n++}.ux`;
  updateCurrent((prev) => ({ ...prev, scripts: [...(prev.scripts ?? []), { path, code: code ?? scriptTemplate(path) }] }));
  codeFileStore.set(path);
  snippetSelStore.set(null);
  return null;
}

export function setScriptCode(path: string, code: string): string | null {
  const p = projectStore.get();
  if (!(p.scripts ?? []).some((s) => s.path === path)) return `unknown script '${path}'`;
  updateCurrent((prev) => ({ ...prev, scripts: (prev.scripts ?? []).map((s) => (s.path === path ? { ...s, code } : s)) }));
  return null;
}

/** Rename a script and rewrite `import "old"` lines everywhere. */
export function renameScript(oldPath: string, newName: string): string | null {
  const p = projectStore.get();
  if (!(p.scripts ?? []).some((s) => s.path === oldPath)) return `unknown script '${oldPath}'`;
  const base = newName.trim().replace(/\.ux$/i, "");
  if (!SCRIPT_NAME.test(base)) return "bad name";
  const path = `${base}.ux`;
  if (path === oldPath) return null;
  if (takenPaths(p).has(path) || path in STDLIB_SET) return "name taken";
  const fix = (code: string) => code.split(`import "${oldPath}"`).join(`import "${path}"`);
  updateCurrent((prev) => ({
    ...prev,
    customCode: prev.customCode === undefined ? undefined : fix(prev.customCode),
    scripts: (prev.scripts ?? []).map((s) => ({ path: s.path === oldPath ? path : s.path, code: fix(s.code) })),
  }));
  if (codeFileStore.get() === oldPath) codeFileStore.set(path);
  return null;
}

/** Delete a script. Refused while another file imports it. */
export function deleteScript(path: string): string | null {
  const p = projectStore.get();
  if (!(p.scripts ?? []).some((s) => s.path === path)) return `unknown script '${path}'`;
  const importer = [{ path: "custom.ux", code: p.customCode ?? "" }, ...(p.scripts ?? [])].find(
    (s) => s.path !== path && s.code.includes(`import "${path}"`),
  );
  if (importer) return `${importer.path} imports ${path}`;
  updateCurrent((prev) => ({ ...prev, scripts: (prev.scripts ?? []).filter((s) => s.path !== path) }));
  if (codeFileStore.get() === path) codeFileStore.set("custom.ux");
  return null;
}

/** Move a script one step up/down the import order. */
export function moveScript(path: string, dir: -1 | 1): void {
  updateCurrent((prev) => {
    const list = [...(prev.scripts ?? [])];
    const i = list.findIndex((s) => s.path === path);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return prev;
    [list[i], list[j]] = [list[j], list[i]];
    return { ...prev, scripts: list };
  });
}

/* Template variables: each instance gets its own copy ("my hp"). */

function myVarUsed(p: Project, name: string): boolean {
  let used = false;
  mapBehaviour(p, {
    value: (v) => {
      if (typeof v === "object" && v.k === "my" && v.name === name) used = true;
      return v;
    },
    block: (b) => {
      if (b.op === "set" && (b.scope ?? "global") !== "global" && b.name === name) used = true;
      return b;
    },
  });
  return used;
}

export function addDefVar(defId: string, name = "value", init = 0): string | null {
  const p = projectStore.get();
  const def = projectDefs(p).find((d) => d.id === defId);
  if (!def || p.locked) return null;
  let base = name.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 20) || "value";
  if (!/^[a-z]/.test(base)) base = `v_${base}`;
  let id = base;
  let n = 2;
  while ((def.vars ?? []).some((v) => v.id === id)) id = `${base}_${n++}`;
  updateCurrent((prev) => ({
    ...prev,
    objectDefs: projectDefs(prev).map((d) => (d.id === defId ? { ...d, vars: [...(d.vars ?? []), { id, init: Math.max(0, Math.min(65535, Math.round(init) || 0)) }] } : d)),
  }));
  return id;
}

/** Rename and/or change the start value of a template variable.
    Renames follow every action and value that names it. */
export function setDefVar(defId: string, varId: string, patch: { id?: string; init?: number }): string | null {
  const p = projectStore.get();
  const def = projectDefs(p).find((d) => d.id === defId);
  if (!def?.vars?.some((v) => v.id === varId)) return `unknown variable '${varId}'`;
  const nextId = patch.id?.trim();
  if (nextId !== undefined && nextId !== varId) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(nextId)) return "bad name";
    if (def.vars.some((v) => v.id === nextId)) return "duplicate name";
  }
  updateCurrent((prev) => {
    let next = prev;
    if (nextId && nextId !== varId) {
      next = mapBehaviour(prev, {
        value: (v) => (typeof v === "object" && v.k === "my" && v.name === varId ? { ...v, name: nextId } : v),
        block: (b) => (b.op === "set" && (b.scope ?? "global") !== "global" && b.name === varId ? { ...b, name: nextId } : b),
      });
      next = {
        ...next,
        scenes: next.scenes.map((s) => ({
          ...s,
          nodes: s.nodes.map((o) => {
            if (o.def !== defId || !o.vars || !(varId in o.vars)) return o;
            const { [varId]: val, ...rest } = o.vars;
            return { ...o, vars: { ...rest, [nextId]: val } };
          }),
        })),
      };
    }
    return {
      ...next,
      objectDefs: projectDefs(next).map((d) =>
        d.id !== defId
          ? d
          : {
              ...d,
              vars: (d.vars ?? []).map((v) =>
                v.id !== varId ? v : { id: nextId || v.id, init: patch.init === undefined ? v.init : Math.max(0, Math.min(65535, Math.round(patch.init) || 0)) },
              ),
            },
      ),
    };
  });
  return null;
}

export function deleteDefVar(defId: string, varId: string): string | null {
  const p = projectStore.get();
  if (myVarUsed(p, varId) && !projectDefs(p).some((d) => d.id !== defId && d.vars?.some((v) => v.id === varId)))
    return `'${varId}' is still used by an action`;
  updateCurrent((prev) => ({
    ...prev,
    objectDefs: projectDefs(prev).map((d) => (d.id === defId ? { ...d, vars: (d.vars ?? []).filter((v) => v.id !== varId) } : d)),
    scenes: prev.scenes.map((s) => ({
      ...s,
      nodes: s.nodes.map((o) => {
        if (o.def !== defId || !o.vars || !(varId in o.vars)) return o;
        const { [varId]: _drop, ...rest } = o.vars;
        void _drop;
        return { ...o, vars: Object.keys(rest).length ? rest : undefined };
      }),
    })),
  }));
  return null;
}

/** Per-instance start value for a template variable (undefined = the
    template's default). Top-level leaf of the current scene. */
export function setInstanceVar(leafId: string, name: string, value: number | undefined): void {
  const p = projectStore.get();
  const scene = currentScene(p, sceneIdStore.get());
  const node = scene.nodes.find((o) => o.id === leafId);
  if (!node?.def) return;
  const vars = { ...(node.vars ?? {}) };
  if (value === undefined) delete vars[name];
  else vars[name] = Math.max(0, Math.min(65535, Math.round(value) || 0));
  patchObject(leafId, { vars: Object.keys(vars).length ? vars : undefined });
}
