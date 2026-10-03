/* Project store: the single source of truth the canvas, inspector,
   sprite editor, graph, sound mixer and exporter all read.
   Persistence is gated on login — guests work purely in memory (see
   SessionBanner), so nothing implies saving that isn't happening. */
import { atom, computed } from "nanostores";
import {
  MAX_SPRITE_TILES,
  SAMPLE_PROJECT,
  flattenScene,
  migrateProject,
  projectDefs,
  spritePxOf,
  spriteTiles,
  type Block,
  type EventTrigger,
  type FlatLeaf,
  type ObjectDef,
  type ObjectEvent,
  type ObjectKind,
  type Project,
  type SceneNode,
} from "./project";
import { getSession } from "./session";

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
  const loggedIn = !!getSession();
  // Guests read per-tab storage (survives full page loads in this tab);
  // logins read local storage, adopting tab work once when it is absent.
  let raw = loggedIn ? localStorage.getItem(STORE_KEY) : sessionStorage.getItem(STORE_KEY);
  let adopted = false;
  if (loggedIn && !raw) {
    raw = sessionStorage.getItem(STORE_KEY);
    adopted = !!raw;
  }
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
          // Adopted guest work after a login: write it through so the
          // next fresh tab finds it under the account.
          if (adopted) {
            try {
              localStorage.setItem(STORE_KEY, JSON.stringify(out));
            } catch {
              /* quota */
            }
          }
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
export const paintToolStore = atom<"brush" | "erase">("brush");
export const voiceSelStore = atom<number>(0);
/** Selected named sound (right panel shows its SoundEditor).
    Mutually exclusive with voiceSelStore the same way defSel is
    with selectionStore: picking one clears the other. */
export const soundSelStore = atom<string | null>(null);
export const codeFileStore = atom<string>("main.ux");
export const viewStore = atom<"scene" | "sprites" | "events" | "sound" | "code">("scene");

if (typeof localStorage !== "undefined") {
  const persist = (all: Record<string, Project>, id: string) => {
    // Guests write per-tab storage only; logins write local storage.
    const box = getSession() ? localStorage : sessionStorage;
    try {
      box.setItem(STORE_KEY, JSON.stringify({ projects: all, current: id }));
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
  viewStore.set(all[id].kind === "code" ? "code" : "scene");
}

export function createProject(name: string): string {
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
    scenes: [{ id: "main", nodes: [], clicks: [], keys: [] }],
    start: "main",
    updatedAt: Date.now(),
  };
  projectsStore.set({ ...all, [id]: p });
  openProject(id);
  return id;
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

/* Object events: GameMaker-style trigger lists on defs and inline
   leaves. Owners address a def or a top-level leaf of the current
   scene; nested leaves inherit home-leaf events (edit them there). */

/** An event owner: a template, or a top-level leaf of the current scene. */
export type EventOwner = { def: string } | { leaf: string };

function readOwnerEvents(p: Project, owner: EventOwner): ObjectEvent[] | null {
  if ("def" in owner) {
    const def = projectDefs(p).find((d) => d.id === owner.def);
    return def ? (def.events ?? []) : null;
  }
  const scene = currentScene(p, sceneIdStore.get());
  const node = scene.nodes.find((o) => o.id === owner.leaf && !o.scene);
  if (!node || node.def) return null;
  return node.events ?? [];
}

function writeOwnerEvents(owner: EventOwner, fn: (events: ObjectEvent[]) => ObjectEvent[]): boolean {
  const p = projectStore.get();
  if (readOwnerEvents(p, owner) === null) return false;
  updateCurrent((prev) => {
    if ("def" in owner) {
      return {
        ...prev,
        objectDefs: projectDefs(prev).map((d) => (d.id === owner.def ? { ...d, events: fn(d.events ?? []) } : d)),
      };
    }
    const scene = currentScene(prev, sceneIdStore.get());
    return {
      ...prev,
      scenes: prev.scenes.map((s) =>
        s.id !== scene.id
          ? s
          : { ...s, nodes: s.nodes.map((o) => (o.id === owner.leaf ? { ...o, events: fn(o.events ?? []) } : o)) },
      ),
    };
  });
  return true;
}

const EVENT_ID = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Add an event; returns its id (ev_N). Unknown owner, bad trigger
    or dangling key/target refs are refused. */
export function addEvent(owner: EventOwner, trigger: EventTrigger, params?: { key?: string; target?: string }): string | null {
  const p = projectStore.get();
  const cur = readOwnerEvents(p, owner);
  if (!cur) return null;
  if (trigger !== "create" && trigger !== "step" && trigger !== "destroy" && trigger !== "key" && trigger !== "collide" && trigger !== "click" && trigger !== "alarm")
    return null;
  if (trigger === "key" && (params?.key === undefined || !p.inputs.some((i) => i.id === params.key))) return null;
  if (trigger === "collide") {
    const t = params?.target ?? "";
    const ok =
      t === "any" || t === "solid" || t === "player" || t === "movable" ||
      (t.startsWith("def:") && projectDefs(p).some((d) => d.id === t.slice(4)));
    if (!ok) return null;
  }
  let id = "ev_1";
  let n = 2;
  while (cur.some((e) => e.id === id)) id = `ev_${n++}`;
  const event: ObjectEvent = {
    id,
    trigger,
    ...(trigger === "key" ? { key: params?.key } : {}),
    ...(trigger === "collide" ? { target: params?.target } : {}),
    blocks: [],
  };
  return writeOwnerEvents(owner, (events) => [...events, event]) ? id : null;
}

export function deleteEvent(owner: EventOwner, eventId: string): boolean {
  const p = projectStore.get();
  const cur = readOwnerEvents(p, owner);
  if (!cur || !cur.some((e) => e.id === eventId)) return false;
  return writeOwnerEvents(owner, (events) => events.filter((e) => e.id !== eventId));
}

const BLOCK_OPS = ["move", "set_pos", "play", "goto", "destroy", "wait"];

/** Append (or insert) a block. The op and required fields are
    checked; value ranges are validation's job (same gate as export). */
export function addBlock(owner: EventOwner, eventId: string, block: Block, index?: number): boolean {
  if (!block || !BLOCK_OPS.includes(block.op)) return false;
  const p = projectStore.get();
  const cur = readOwnerEvents(p, owner);
  if (!cur || !cur.some((e) => e.id === eventId)) return false;
  return writeOwnerEvents(owner, (events) =>
    events.map((e) => {
      if (e.id !== eventId) return e;
      const blocks = [...e.blocks];
      const at = index === undefined ? blocks.length : Math.min(Math.max(0, index), blocks.length);
      blocks.splice(at, 0, block);
      return { ...e, blocks };
    }),
  );
}

/** Merge fields into one block (same op shape assumed; ranges are
    validation's job). Powers the per-op editors. */
export function patchBlock(owner: EventOwner, eventId: string, index: number, patch: Record<string, number | string>): boolean {
  const p = projectStore.get();
  const cur = readOwnerEvents(p, owner);
  const ev = cur?.find((e) => e.id === eventId);
  if (!ev || index < 0 || index >= ev.blocks.length) return false;
  return writeOwnerEvents(owner, (events) =>
    events.map((e) =>
      e.id === eventId
        ? { ...e, blocks: e.blocks.map((b, i) => (i === index ? ({ ...b, ...patch } as Block) : b)) }
        : e,
    ),
  );
}

export function deleteBlock(owner: EventOwner, eventId: string, index: number): boolean {
  const p = projectStore.get();
  const cur = readOwnerEvents(p, owner);
  const ev = cur?.find((e) => e.id === eventId);
  if (!ev || index < 0 || index >= ev.blocks.length) return false;
  return writeOwnerEvents(owner, (events) =>
    events.map((e) => (e.id === eventId ? { ...e, blocks: e.blocks.filter((_, i) => i !== index) } : e)),
  );
}

export function moveBlock(owner: EventOwner, eventId: string, from: number, to: number): boolean {
  const p = projectStore.get();
  const cur = readOwnerEvents(p, owner);
  const ev = cur?.find((e) => e.id === eventId);
  if (!ev || from < 0 || from >= ev.blocks.length || to < 0 || to >= ev.blocks.length) return false;
  return writeOwnerEvents(owner, (events) =>
    events.map((e) => {
      if (e.id !== eventId) return e;
      const blocks = [...e.blocks];
      const [b] = blocks.splice(from, 1);
      blocks.splice(to, 0, b);
      return { ...e, blocks };
    }),
  );
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
      return { ...s, w: tw, h: th, pixels: next };
    }),
  }));
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

export function deleteScene(id: string): void {
  const p = projectStore.get();
  if (p.scenes.length <= 1) return;
  updateCurrent((prev) => {
    const scenes = prev.scenes.filter((s) => s.id !== id);
    const start = prev.start === id ? scenes[0].id : prev.start;
    return {
      ...prev,
      start,
      scenes: scenes.map((s) => ({
        ...s,
        clicks: s.clicks.filter((c) => c.goto !== id),
        keys: s.keys.filter((k) => k.goto !== id),
      })),
    };
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
            clicks: s.clicks.map((c) => (c.object === oldId ? { ...c, object: clean } : c)),
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
    ...prev,
    objectDefs: projectDefs(prev).map((d) => (d.id === oldId ? { ...d, id: clean } : d)),
    scenes: prev.scenes.map((s) => ({
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
      tick: o.tick ?? def.tick,
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
    tick: node.tick,
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
    if (ref.parent.length > 0) return next;
    return {
      ...next,
      scenes: next.scenes.map((s) =>
        s.id !== ref.sceneId ? s : { ...s, clicks: s.clicks.filter((c) => c.object !== node.id) },
      ),
    };
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

export function addBinding(
  kind: "click" | "key",
  objectId: string | null,
  goto: string,
  key?: number,
  inputId?: string,
): void {
  const p = projectStore.get();
  const scene = currentScene(p, sceneIdStore.get());
  updateCurrent((prev) => ({
    ...prev,
    scenes: prev.scenes.map((s) => {
      if (s.id !== scene.id) return s;
      if (kind === "click" && objectId) return { ...s, clicks: [...s.clicks, { object: objectId, goto }] };
      const code = key ?? (prev.inputs ?? []).find((i) => i.id === inputId)?.key ?? 32;
      return { ...s, keys: [...s.keys, { input: inputId, key: code, goto }] };
    }),
  }));
}

export function removeBinding(kind: "click" | "key", index: number): void {
  const p = projectStore.get();
  const scene = currentScene(p, sceneIdStore.get());
  updateCurrent((prev) => ({
    ...prev,
    scenes: prev.scenes.map((s) => {
      if (s.id !== scene.id) return s;
      if (kind === "click") return { ...s, clicks: s.clicks.filter((_, i) => i !== index) };
      return { ...s, keys: s.keys.filter((_, i) => i !== index) };
    }),
  }));
}

export function setSceneFrameCode(code: string): void {
  const p = projectStore.get();
  const scene = currentScene(p, sceneIdStore.get());
  updateCurrent((prev) => ({
    ...prev,
    scenes: prev.scenes.map((s) =>
      s.id !== scene.id ? s : { ...s, frameCode: code || undefined },
    ),
  }));
}

export function setTheme(theme: { r: number; g: number; b: number }): void {
  updateCurrent((prev) => ({ ...prev, theme }));
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
  const retarget = (blocks: Block[]): Block[] =>
    blocks.map((b) => (b.op === "play" && b.sound === oldId ? { ...b, sound: clean } : b));
  updateCurrent((prev) => ({
    ...prev,
    sounds: (prev.sounds ?? []).map((s) => (s.id === oldId ? { ...s, id: clean } : s)),
    objectDefs: projectDefs(prev).map((d) => ({
      ...d,
      events: (d.events ?? []).map((e) => ({ ...e, blocks: retarget(e.blocks) })),
    })),
    scenes: prev.scenes.map((s) => ({
      ...s,
      nodes: s.nodes.map((o) =>
        !o.scene && !o.def && o.events ? { ...o, events: o.events.map((e) => ({ ...e, blocks: retarget(e.blocks) })) } : o,
      ),
    })),
  }));
  if (soundSelStore.get() === oldId) soundSelStore.set(clean);
  return null;
}

/** Delete a named sound. Refused while a play block names it —
    retarget (or delete) those blocks first. */
export function deleteSound(soundId: string): string | null {
  const p = projectStore.get();
  if (!(p.sounds ?? []).some((s) => s.id === soundId)) return `unknown sound '${soundId}'`;
  const used =
    projectDefs(p).some((d) => (d.events ?? []).some((e) => e.blocks.some((b) => b.op === "play" && b.sound === soundId))) ||
    p.scenes.some((s) =>
      s.nodes.some(
        (o) => !o.scene && (o.events ?? []).some((e) => e.blocks.some((b) => b.op === "play" && b.sound === soundId)),
      ),
    );
  if (used) return `sound '${soundId}' is used by a play block`;
  updateCurrent((prev) => ({ ...prev, sounds: (prev.sounds ?? []).filter((s) => s.id !== soundId) }));
  if (soundSelStore.get() === soundId) soundSelStore.set(null);
  return null;
}
