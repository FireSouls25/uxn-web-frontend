/* Agent tool manifest: the complete programmatic interface to the
   studio, shared by human UI and AI agents alike. Every tool wraps a
   store/emitter operation with a JSON-schema-ish signature and a
   description written for tool-calling models. The RAG corpus
   (backend/rag/tools.md) mirrors these descriptions; adding a tool
   here means documenting it there.
   Safety: tools validate through the same paths as the UI
   (validateProject, reserved names, slot budget); the backend
   compiler remains the final arbiter at export. */
import {
  addAnimFrame,
  addBlock,
  addBlockAt,
  addDef,
  addEvent,
  addInstance,
  addNode,
  addObject,
  addScene,
  addScript,
  addSong,
  addSound,
  addSprite,
  addVariable,
  createProject,
  deleteBlock,
  deleteBlockAt,
  deleteEvent,
  deleteNode,
  deleteScript,
  deleteSong,
  deleteSound,
  deleteVariable,
  extractObject,
  moveNode,
  openProject,
  patchAnimation,
  patchDef,
  patchObject,
  projectStore,
  readList,
  renameObject,
  renameSong,
  renameSound,
  renameVariable,
  reorderNodes,
  sceneIdStore,
  selectionStore,
  setLeafLabel,
  setLeafLook,
  setSpriteCell,
  setCustomCode,
  setLoopMode,
  setMask,
  setScriptCode,
  setObjectPos,
  setSongNote,
  setSongVol,
  setSoundVoice,
  setSpritePixels,
  setTheme,
  setVariableInit,
  setVoice,
  BLOCK_OPS,
  addDefVar,
  addInput,
  readOwnerEvents,
  setSceneCamera,
  setSceneTilemap,
} from "../store";
import { definedHooks, emitProject, flattenScene, loopOf, projectDefs, spritePxOf, validateProject } from "../project";
import { previewEvent } from "../engine";
import { STDLIB, STDLIB_NAMES, moduleExports, moduleSummary } from "../stdlib";
import type { Block, BlockPath, ButtonName, EventTrigger, ObjectKind } from "../project";
import type { EventOwner } from "../store";
import { compileProject } from "../export";
import { tilesFromRows, type Movement, type ObjectEvent, type Project } from "../project";

export interface ToolResult {
  ok: boolean;
  message: string;
  data?: Record<string, unknown>;
}

export interface ToolDef {
  name: string;
  description: string;
  params: Record<string, { type: string; required?: boolean; description?: string }>;
  run: (args: Record<string, unknown>) => ToolResult;
  /** Tools that need the network (check_build). The agent loop awaits
      this when present; sync callers get `run`'s answer instead. */
  runAsync?: (args: Record<string, unknown>) => Promise<ToolResult>;
}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === "number" ? v : fallback);


/* ---- project context: what the agent sees at the top of every request ---- */

function eventTag(e: ObjectEvent): string {
  const arg = e.key ?? e.button ?? e.target ?? e.message ?? (e.trigger === "alarm" ? String(e.alarm ?? 0) : "");
  return `${e.id}:${e.trigger}${arg ? `(${arg})` : ""}[${e.blocks.length}]`;
}

/** `name(a, b) -> u16` for every fn/macro a script declares. */
export function scriptSignatures(code: string): string[] {
  const out: string[] = [];
  const re = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*::\s*(fn|event)\s*\(([^)]*)\)\s*(->\s*[A-Za-z0-9_]+)?/gm;
  for (const m of code.matchAll(re)) {
    const params = m[3].replace(/\s+/g, " ").trim();
    out.push(`${m[1]}(${params})${m[4] ? ` ${m[4].replace(/\s+/g, " ")}` : ""}${m[2] === "event" ? " [event]" : ""}`);
  }
  return out;
}

/** Compact, current picture of the open project (ids the tools take),
    capped so it never crowds out the request. */
export function projectContext(p: Project = projectStore.get(), max = 6000): string {
  const L: string[] = [];
  const cur = sceneIdStore.get();
  L.push(
    `Project "${p.name}" (id ${p.id}, ${p.kind}${p.locked ? ", READ-ONLY: tell the user to Duplicate to edit" : ""}), loop ${loopOf(p)}, canvas ${p.width}x${p.height}, start scene ${p.start}, open scene ${cur}.`,
  );
  if (p.kind === "code") {
    L.push(`Code project files: ${Object.keys(p.codeFiles ?? {}).join(", ")}; entry ${p.entry ?? "main.ux"}.`);
    return L.join("\n").slice(0, max);
  }
  L.push("Scenes:");
  for (const s of p.scenes) {
    const nodes = s.nodes.map((n) => {
      const what = n.scene ? `scene:${n.scene}` : n.def ? `${n.def}` : n.sprite ? `sprite:${n.sprite}` : "text";
      return `${n.id}=${what}@${n.x},${n.y}${n.label ? ` "${n.label}"` : ""}${(n.events?.length ?? 0) > 0 ? ` events[${n.events!.map(eventTag).join(" ")}]` : ""}`;
    });
    const shown = nodes.length > 14 ? [...nodes.slice(0, 14), `…+${nodes.length - 14} more (scene_map)`] : nodes;
    L.push(`- ${s.id}${s.pool ? ` pool ${s.pool}` : ""}${(s.events?.length ?? 0) > 0 ? ` | scene events: ${s.events!.map(eventTag).join(" ")}` : ""}`);
    if (shown.length) L.push(`    objects: ${shown.join("; ")}`);
  }
  const defs = projectDefs(p);
  if (defs.length) {
    L.push("Templates:");
    for (const d of defs) {
      const vars = (d.vars ?? []).map((v) => `${v.id}=${v.init ?? 0}`).join(",");
      L.push(`- ${d.id}: sprite ${d.sprite || "-"}, ${d.kind}${d.blend !== undefined ? `, blend ${d.blend}` : ""}${vars ? `, vars ${vars}` : ""}${(d.events?.length ?? 0) > 0 ? `, events ${d.events!.map(eventTag).join(" ")}` : ""}`);
    }
  }
  if ((p.vars ?? []).length) L.push(`Game variables: ${p.vars!.map((v) => `${v.id}=${v.init ?? 0}`).join(", ")}`);
  if (p.inputs.length) L.push(`Inputs: ${p.inputs.map((i) => `${i.id}=${i.key}`).join(", ")}`);
  L.push(`Sprites: ${p.sprites.map((s) => `${s.id}(${(s.w ?? 1) * 8}x${(s.h ?? 1) * 8}${s.cell ? ` sheet of ${s.cell.w}x${s.cell.h}-tile cells` : ""})`).join(", ") || "none"}`);
  if (p.anims.length) L.push(`Animations: ${p.anims.map((a) => `${a.id}[${a.frames.length}]`).join(", ")}`);
  L.push(`Sounds: ${(p.sounds ?? []).map((s) => s.id).join(", ") || "none"}; songs: ${(p.songs ?? []).map((s) => s.id).join(", ") || "none"}`);
  const scripts = p.scripts ?? [];
  if (scripts.length) {
    L.push("Scripts (functions blocks can call):");
    for (const s of scripts) {
      const imports = [...s.code.matchAll(/^\s*import\s+"([^"]+)"/gm)].map((m) => m[1]);
      L.push(`- ${s.path} (${s.code.split("\n").length} lines${imports.length ? `, imports ${imports.join(" ")}` : ""}): ${scriptSignatures(s.code).join("; ") || "no fns"}`);
    }
  }
  const hooks = [...definedHooks(p)];
  if (hooks.length || (p.customCode ?? "").trim()) L.push(`custom.ux hooks: ${hooks.join(", ") || "none"}`);
  const sel = selectionStore.get();
  if (sel !== null && sel !== undefined) L.push(`Selected: ${JSON.stringify(sel)}`);
  const out = L.join("\n");
  return out.length > max ? `${out.slice(0, max)}\n…(truncated: call describe/scene_map/read_file for more)` : out;
}

function numbered(text: string, from: number, to: number): string {
  const lines = text.split("\n");
  const a = Math.max(1, from);
  const b = Math.min(lines.length, to);
  const out: string[] = [];
  for (let i = a; i <= b; i++) out.push(`${String(i).padStart(4)}  ${lines[i - 1]}`);
  return out.join("\n");
}

/** Source text for read_file: script, custom.ux, generated file, or
    library module (`lib/name.ux` or bare name). */
function sourceOf(path: string): { path: string; text: string } | null {
  const p = projectStore.get();
  if (p.kind === "code" && p.codeFiles && path in p.codeFiles) return { path, text: p.codeFiles[path] };
  const script = (p.scripts ?? []).find((s) => s.path === path);
  if (script) return { path, text: script.code };
  if (path === "custom.ux") return { path, text: p.customCode ?? "" };
  const lib = path.startsWith("lib/") ? path.slice(4) : path;
  const libName = lib.endsWith(".ux") ? lib : `${lib}.ux`;
  let files: Record<string, string> = {};
  try {
    files = emitProject(p);
  } catch {
    files = {};
  }
  if (path in files) return { path, text: files[path] };
  if (libName in STDLIB) return { path: `lib/${libName}`, text: STDLIB[libName] };
  return null;
}

function snapshot(): Record<string, unknown> {
  const p = projectStore.get();
  return {
    project: p.id,
    scene: sceneIdStore.get(),
    scenes: p.scenes.map((s) => s.id),
    sprites: p.sprites.map((s) => s.id),
    defs: projectDefs(p).map((d) => d.id),
    sounds: (p.sounds ?? []).map((s) => s.id),
    anims: p.anims.map((a) => a.id),
    loop: loopOf(p),
    scripts: (p.scripts ?? []).map((s) => s.path),
    hooks: [...definedHooks(p)],
  };
}

/* Shared spatial model (UI rulers + agents): game pixels, origin
   top-left, +x right, +y down. Every visible leaf resolves to a
   rect with effective kind/solid/sprite (def fallbacks applied,
   subscene offsets accumulated). Solid = flag set or movable kind. */
interface LeafRect {
  path: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: string;
  solid: boolean;
  sprite: string;
}

function leafRects(sceneId: string): LeafRect[] {
  const p = projectStore.get();
  return flattenScene(p, sceneId).map((l) => {
    const [w, h] = spritePxOf(p, l.sprite);
    return {
      path: l.path,
      x: l.x,
      y: l.y,
      w,
      h,
      kind: l.kind,
      solid: (l.solid ?? false) || l.kind === "movable",
      sprite: l.sprite,
    };
  });
}

function rectsOverlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function resolveScene(arg: unknown): { p: ReturnType<typeof projectStore.get>; id: string } | { err: string } {
  const p = projectStore.get();
  const id = str(arg) || sceneIdStore.get();
  if (!p.scenes.some((s) => s.id === id)) return { err: `unknown scene ${id}` };
  return { p, id };
}

export const TOOLS: ToolDef[] = [
  {
    name: "create_sprite",
    description:
      "Create a sprite in the project library (1x1 to 4x4 tiles of 8x8, via the Screen device's per-tile draws). Pixels are 64*w*h color indices 0-3 (Uxn 2bpp limit), tile-major row-major; index 0 paints palette 0 (opaque background). Returns the sprite id.",
    params: {
      name: { type: "string", required: true, description: "Display name, becomes the id when valid" },
      pixels: { type: "array", description: "64*w*h numbers 0-3. Omit for a blank sprite." },
      w: { type: "number", description: "Tiles wide 1-4, default 1" },
      h: { type: "number", description: "Tiles tall 1-4, default 1" },
    },
    run: (args) => {
      const id = addSprite(str(args["name"], "sprite"), num(args["w"], 1), num(args["h"], 1));
      if (Array.isArray(args["pixels"])) {
        setSpritePixels(id, (args["pixels"] as unknown[]).map((v) => num(v)));
      }
      return { ok: true, message: `sprite ${id}`, data: { id } };
    },
  },
  {
    name: "put_on_scene",
    description:
      "Place a sprite as an object on a scene (default: current scene). Kinds: player (at most one per scene, 0 allowed), static (prop), movable (solid + pushable). Coordinates are game pixels (origin top-left, +x right, +y down), clamped to canvas — use scene_map to see occupancy and find_space for a free spot.",
    params: {
      sprite: { type: "string", required: true, description: "Sprite id from the library" },
      scene: { type: "string", description: "Scene id, default current" },
      x: { type: "number", description: "Pixels, default 8" },
      y: { type: "number", description: "Pixels, default 8" },
      kind: { type: "string", description: "player|static|movable, default static" },
      name: { type: "string", description: "Object id, default obj_N" },
    },
    run: (args) => {
      const p = projectStore.get();
      const sceneId = str(args["scene"]) || sceneIdStore.get();
      if (!p.scenes.some((s) => s.id === sceneId)) return { ok: false, message: `unknown scene ${sceneId}` };
      if (!p.sprites.some((s) => s.id === args["sprite"])) return { ok: false, message: `unknown sprite ${args["sprite"]}` };
      const kind = (["player", "static", "movable"].includes(str(args["kind"])) ? str(args["kind"]) : "static") as ObjectKind;
      const prev = sceneIdStore.get();
      sceneIdStore.set(sceneId);
      const id = addObject(kind, str(args["name"]), str(args["sprite"]));
      const obj = projectStore.get().scenes.find((s) => s.id === sceneId)?.nodes.find((o) => o.id === id);
      if (obj) setObjectPos(id, num(args["x"], 8), num(args["y"], 8));
      void prev;
      return { ok: true, message: `placed ${id} on ${sceneId}`, data: { id, scene: sceneId } };
    },
  },
  {
    name: "create_scene",
    description: "Create an empty scene and switch to it. Scene ids route events (click goto, match arms).",
    params: {},
    run: () => {
      const id = addScene();
      return { ok: true, message: `scene ${id}`, data: { id } };
    },
  },
  {
    name: "create_object_def",
    description:
      "Create an object template (GameMaker Object: default sprite, kind, flags, animation, tick script). Scenes stamp instances of it; editing the def updates every instance. Kinds: player (at most one per scene, 0 allowed), static, movable (solid + pushable).",
    params: {
      name: { type: "string", required: true, description: "Display name, becomes the id when valid" },
      sprite: { type: "string", description: "Sprite id, default first in the library" },
      kind: { type: "string", description: "player|static|movable, default static" },
      anim: { type: "string", description: "Animation id" },
      tick: { type: "string", description: "Default ETAL tick script" },
    },
    run: (args) => {
      const p = projectStore.get();
      if (args["sprite"] !== undefined && !p.sprites.some((s) => s.id === args["sprite"]))
        return { ok: false, message: `unknown sprite ${args["sprite"]}` };
      const kind = (["player", "static", "movable"].includes(str(args["kind"])) ? str(args["kind"]) : "static") as ObjectKind;
      const id = addDef(str(args["name"], "object"), str(args["sprite"]) || undefined, kind);
      if (args["anim"] !== undefined || args["tick"] !== undefined) {
        const err = patchDef(id, {
          ...(args["anim"] !== undefined ? { anim: str(args["anim"]) || undefined } : {}),
          ...(args["tick"] !== undefined ? { tick: str(args["tick"]) || undefined } : {}),
        });
        if (err) return { ok: false, message: err };
      }
      return { ok: true, message: `object ${id}`, data: { id } };
    },
  },
  {
    name: "place_instance",
    description:
      "Stamp an instance of an object template on a scene (default: current scene). Local fields override the def per instance; position is always instance state. Coordinates are game pixels (origin top-left) — use scene_map/find_space to place coherently.",
    params: {
      def: { type: "string", required: true, description: "Object template id" },
      scene: { type: "string", description: "Scene id, default current" },
      x: { type: "number", description: "Pixels, default 8" },
      y: { type: "number", description: "Pixels, default 8" },
      name: { type: "string", description: "Instance id, default the def id" },
    },
    run: (args) => {
      const id = addInstance(
        str(args["def"]),
        num(args["x"], 8),
        num(args["y"], 8),
        str(args["name"]),
        str(args["scene"]) || undefined,
      );
      if (!id) return { ok: false, message: `unknown object ${args["def"]}` };
      return { ok: true, message: `placed ${id}`, data: { id } };
    },
  },
  {
    name: "extract_object",
    description:
      "Convert a top-level inline object into a template + instance pair: effective values become the new def, the leaf keeps id and position. Prefer this over rebuilding shared art by hand.",
    params: {
      object: { type: "string", required: true, description: "Top-level object id in current scene" },
    },
    run: (args) => {
      const id = extractObject(str(args["object"]));
      if (!id) return { ok: false, message: `cannot extract ${args["object"]} (missing, nested, or already an instance)` };
      return { ok: true, message: `extracted ${id}`, data: { id } };
    },
  },
  {
    name: "add_event",
    description:
      "Add an event to an owner: a template ({def}), an inline object ({object}, top-level of the current scene) or a scene ({scene}; scene events are the level's controller). Triggers: create (scene start; scenes run theirs before their objects'), step (every frame), destroy, key ({key}: named input id, or {button}: a|b|select|start|up|down|left|right), click (mouse pressed on this object; on a scene: anywhere), release (mouse released anywhere), collide ({target}: any|solid|player|movable|def:<id> — the hit object is 'other' in its actions), alarm ({timer} 0-3, armed by wait actions), message ({message}: name, fired by send actions). Scenes can't use collide/destroy.",
    params: {
      def: { type: "string", description: "Template id (one of def/object/scene)" },
      object: { type: "string", description: "Inline object id in the current scene" },
      scene: { type: "string", description: "Scene id: scene-level event" },
      trigger: { type: "string", required: true, description: "create|step|destroy|key|click|release|collide|alarm|message" },
      key: { type: "string", description: "key: named input id" },
      button: { type: "string", description: "key: controller button instead of a key" },
      target: { type: "string", description: "collide: any|solid|player|movable|def:<id>" },
      timer: { type: "number", description: "alarm: 0-3" },
      message: { type: "string", description: "message: name" },
    },
    run: (args) => {
      const owner = ownerOf(args);
      if (!owner) return { ok: false, message: "name exactly one of def/object/scene" };
      const id = addEvent(owner, str(args["trigger"]) as EventTrigger, {
        key: str(args["key"]) || undefined,
        button: (str(args["button"]) || undefined) as ButtonName | undefined,
        target: str(args["target"]) || undefined,
        alarm: args["timer"] === undefined ? undefined : num(args["timer"]),
        message: str(args["message"]) || undefined,
      });
      if (!id) return { ok: false, message: "event refused (unknown owner or trigger, or an object-only trigger on a scene)" };
      return { ok: true, message: `event ${id}`, data: { id } };
    },
  },
  {
    name: "add_action",
    description:
      'Add an action to an event, as JSON {"op": ...}. Every number field is a VALUE: a plain number, or {"k":"var","name"} (game variable), {"k":"my","name","of"?:"other"} (template variable), {"k":"prop","prop":"x|y|cell|w|h","of"?:"other"}, {"k":"mouse","axis":"x|y"}, {"k":"random","max":V}, {"k":"math","op":"+|-|*|/|%","a":V,"b":V}, {"k":"call","fn","args":[V]} (script function returning u16). Ops: move{dx,dy} (signed), set_pos{x,y}, glide{x,y,frames 1-255}, sprite{sprite,cell?}, cell{cell}, look{blend?0-15,flipX?,flipY?}, show, hide, text{text ≤24 ASCII, value?} (draws text, then a number), play{sound}, song{song}, song_stop, goto{scene}, overlay{scene} (opens a scene on top, freezing the one below — pause menus), back (close the overlay, resume), wait{ticks,slot?0-3} (starts a timer → alarm event), destroy{target?: self|other|def:<id>}, spawn{def,x,y} (new instance of a template, uses the scene\'s spawn slots), send{message}, set{name,scope?:"global"|"self"|"other",mode:"set|add|sub",value}, if{cond,then:[...],else?:[...]}, repeat{times,index?:<game var>,body:[...]}, call{fn,args:[V]} (script function), jump{power 1-8} (launch upward; templates with platformer/walker movement), code{code} (raw ETAL; self = this object\'s slot). CONDITIONS: {"k":"cmp","a":V,"op":"eq|neq|lt|lte|gt|gte","b":V}, {"k":"held","button"}, {"k":"touching","target"}, {"k":"mouse_over"}, {"k":"mouse_down"}, {"k":"all","of":[C]}, {"k":"any","of":[C]}, {"k":"not","c":C}. Nested if/repeat bodies can be given inline or filled later with path "2.then" / "0.body". Run validate after — it names any bad reference.',
    params: {
      def: { type: "string", description: "Template id (one of def/object/scene)" },
      object: { type: "string", description: "Inline object id in the current scene" },
      scene: { type: "string", description: "Scene id (scene event)" },
      event: { type: "string", required: true, description: "Event id from add_event" },
      action: { type: "string", required: true, description: "The action as JSON" },
      path: { type: "string", description: "Nested body: 1.then | 1.else | 0.body (default top level)" },
      index: { type: "number", description: "Insert position, default append" },
    },
    run: (args) => {
      const owner = ownerOf(args);
      if (!owner) return { ok: false, message: "name exactly one of def/object/scene" };
      let block: Block;
      try {
        block = (typeof args["action"] === "object" ? args["action"] : JSON.parse(str(args["action"]))) as Block;
      } catch {
        return { ok: false, message: "action must be JSON like {\"op\":\"play\",\"sound\":\"blip\"}" };
      }
      if (!block || typeof block !== "object" || !BLOCK_OPS.includes(block.op)) return { ok: false, message: `unknown op '${(block as { op?: unknown })?.op}'` };
      const path = parsePath(str(args["path"]));
      if (!path) return { ok: false, message: "bad path (want 1.then, 1.else or 0.body)" };
      if (!addBlockAt(owner, str(args["event"]), block, args["index"] === undefined ? undefined : num(args["index"]), path))
        return { ok: false, message: "action refused (unknown owner, event or path)" };
      return { ok: true, message: `${block.op} added` };
    },
  },
  {
    name: "delete_event",
    description: "Delete an event (and its actions).",
    params: {
      def: { type: "string", description: "Template id (one of def/object/scene)" },
      object: { type: "string", description: "Inline object id in the current scene" },
      scene: { type: "string", description: "Scene id (scene event)" },
      event: { type: "string", required: true, description: "Event id" },
    },
    run: (args) => {
      const owner = ownerOf(args);
      if (!owner) return { ok: false, message: "name exactly one of def/object/scene" };
      if (!deleteEvent(owner, str(args["event"]))) return { ok: false, message: "unknown owner or event" };
      return { ok: true, message: "event deleted" };
    },
  },
  {
    name: "delete_action",
    description: "Delete one action of an event by index (path addresses a nested body, e.g. 1.then).",
    params: {
      def: { type: "string", description: "Template id (one of def/object/scene)" },
      object: { type: "string", description: "Inline object id in the current scene" },
      scene: { type: "string", description: "Scene id (scene event)" },
      event: { type: "string", required: true, description: "Event id" },
      index: { type: "number", required: true, description: "Action index" },
      path: { type: "string", description: "Nested body 1.then | 1.else | 0.body" },
    },
    run: (args) => {
      const owner = ownerOf(args);
      if (!owner) return { ok: false, message: "name exactly one of def/object/scene" };
      const path = parsePath(str(args["path"]));
      if (!path) return { ok: false, message: "bad path" };
      if (!deleteBlockAt(owner, str(args["event"]), num(args["index"]), path)) return { ok: false, message: "unknown owner, event, path or index" };
      return { ok: true, message: "action deleted" };
    },
  },
  {
    name: "preview_event",
    description: "Show the exact ETAL an event's actions lower to (the emitter's own lowering).",
    params: {
      def: { type: "string", description: "Template id (one of def/object/scene)" },
      object: { type: "string", description: "Inline object id in the current scene" },
      scene: { type: "string", description: "Scene id (scene event)" },
      event: { type: "string", required: true, description: "Event id" },
    },
    run: (args) => {
      const p = projectStore.get();
      const owner = ownerOf(args);
      if (!owner) return { ok: false, message: "name exactly one of def/object/scene" };
      const ev = readOwnerEvents(p, owner)?.find((e) => e.id === str(args["event"]));
      if (!ev) return { ok: false, message: "unknown owner or event" };
      const lines = previewEvent(p, ev, "scene" in owner && !("leaf" in owner));
      return { ok: true, message: lines.join("\n") || "(no actions)", data: { etal: lines } };
    },
  },
  {
    name: "nest_scene",
    description:
      "Instance a subscene inside a scene at an offset (Godot-style composition: board of squares, room of furniture). Cycles are rejected. Children render at parent offset + own position.",
    params: {
      scene: { type: "string", required: true, description: "Subscene id to instance" },
      into: { type: "string", description: "Parent scene, default current" },
      x: { type: "number", description: "Origin offset x" },
      y: { type: "number", description: "Origin offset y" },
      name: { type: "string", description: "Instance id" },
    },
    run: (args) => {
      const p = projectStore.get();
      const sub = str(args["scene"]);
      const into = str(args["into"]) || sceneIdStore.get();
      if (!p.scenes.some((s) => s.id === sub)) return { ok: false, message: `unknown scene ${sub}` };
      if (!p.scenes.some((s) => s.id === into)) return { ok: false, message: `unknown scene ${into}` };
      const prev = sceneIdStore.get();
      sceneIdStore.set(into);
      const id = `inst_${sub}`;
      let n = 1;
      let name = str(args["name"]) || id;
      const list = readList(projectStore.get(), { sceneId: into, parent: [] });
      while (list.some((o) => o.id === name)) name = `${id}_${n++}`;
      const ok = addNode(
        { sceneId: into, parent: [] },
        { id: name, x: num(args["x"]), y: num(args["y"]), scene: sub },
      );
      sceneIdStore.set(prev);
      if (!ok) return { ok: false, message: "duplicate instance id" };
      return { ok: true, message: `instanced ${sub} as ${name} in ${into}`, data: { id: name } };
    },
  },
  {
    name: "add_transition",
    description:
      "Shortcut: switch scenes on input. click + {object} adds a click event with a go-to action to that inline object (or its template); key + {key} (named input id) or {code} (key code, 32 space, 27 escape) adds a scene key event. Same as add_event + add_action.",
    params: {
      event: { type: "string", required: true, description: "click|key" },
      object: { type: "string", description: "Object id in the current scene (click)" },
      key: { type: "string", description: "Named input id (key)" },
      code: { type: "number", description: "Key code 0-255 (key, creates the input)" },
      goto: { type: "string", required: true, description: "Target scene id" },
    },
    run: (args) => {
      const p = projectStore.get();
      const goto = str(args["goto"]);
      if (!p.scenes.some((s) => s.id === goto)) return { ok: false, message: `unknown scene ${goto}` };
      const scene = sceneIdStore.get();
      let owner: EventOwner;
      let id: string | null;
      if (str(args["event"]) === "key") {
        owner = { scene };
        const key = str(args["key"]) || addInput(num(args["code"], 32));
        id = addEvent(owner, "key", { key });
      } else {
        const node = p.scenes.find((s) => s.id === scene)?.nodes.find((n) => n.id === str(args["object"]) && !n.scene);
        if (!node) return { ok: false, message: `unknown object ${args["object"]}` };
        owner = node.def ? { def: node.def } : { leaf: node.id };
        id = addEvent(owner, "click");
      }
      if (!id || !addBlockAt(owner, id, { op: "goto", scene: goto }, undefined, [])) return { ok: false, message: "refused" };
      return { ok: true, message: `${args["event"]} → ${goto}`, data: { event: id } };
    },
  },
  {
    name: "add_template_var",
    description:
      "Give a template a variable: every instance gets its own copy (\"my hp\", \"my square\"), starting at {init} (instances may override). Read it in values as {\"k\":\"my\",\"name\"}, change it with set{scope:\"self\"}.",
    params: {
      def: { type: "string", required: true, description: "Template id" },
      name: { type: "string", required: true, description: "Variable name" },
      init: { type: "number", description: "Start value 0-65535" },
    },
    run: (args) => {
      const id = addDefVar(str(args["def"]), str(args["name"]), num(args["init"]));
      if (!id) return { ok: false, message: `unknown template ${args["def"]}` };
      return { ok: true, message: `variable ${id}`, data: { id } };
    },
  },
  {
    name: "set_movement",
    description:
      "Give a template built-in movement. platformer: arrows run, up/A/space jumps, gravity; solid tiles and solid objects block. walker: patrols left/right with gravity, turning at walls and ledges (enemies). speed 1-4 px/frame, jump 1-8 (height ≈ 3·j·(j+1)/2 px). movement \"\" removes it.",
    params: {
      def: { type: "string", required: true, description: "Template id" },
      movement: { type: "string", required: true, description: "platformer | walker | \"\"" },
      speed: { type: "number", description: "1-4" },
      jump: { type: "number", description: "1-8 (platformer)" },
    },
    run: (args) => {
      const id = str(args["def"]);
      if (!projectDefs(projectStore.get()).some((d) => d.id === id)) return { ok: false, message: `unknown template '${id}'` };
      const m = str(args["movement"]);
      if (m !== "" && m !== "platformer" && m !== "walker") return { ok: false, message: "movement must be platformer, walker or empty" };
      patchDef(id, {
        movement: (m || undefined) as Movement | undefined,
        ...(m ? { controls: false } : {}),
        ...(args["speed"] !== undefined ? { speed: num(args["speed"]) } : {}),
        ...(args["jump"] !== undefined ? { jump: num(args["jump"]) } : {}),
      });
      return { ok: true, message: m ? `${id} moves as ${m}` : `${id}: movement removed` };
    },
  },
  {
    name: "set_hud",
    description: "Fix a template (all its instances) or an inline object to the screen so the camera doesn't move it: scores, lives, labels.",
    params: {
      def: { type: "string", description: "Template id (one of def/object)" },
      object: { type: "string", description: "Inline object id in the current scene" },
      on: { type: "string", description: "\"false\" to undo (default true)" },
    },
    run: (args) => {
      const on = str(args["on"]) !== "false";
      const def = str(args["def"]);
      if (def) {
        if (!projectDefs(projectStore.get()).some((d) => d.id === def)) return { ok: false, message: `unknown template '${def}'` };
        patchDef(def, { hud: on || undefined });
        return { ok: true, message: `${def} hud ${on}` };
      }
      const obj = str(args["object"]);
      const scene = projectStore.get().scenes.find((s) => s.id === sceneIdStore.get());
      if (!scene?.nodes.some((n) => n.id === obj)) return { ok: false, message: `no object '${obj}' in this scene` };
      patchObject(obj, { hud: on || undefined });
      return { ok: true, message: `${obj} hud ${on}` };
    },
  },
  {
    name: "set_camera",
    description: "Make a scene's camera follow the first live instance of a template (centered, clamped to the level). follow \"\" fixes the camera. The level size comes from the scene's tile layer.",
    params: {
      scene: { type: "string", description: "Scene id (default current)" },
      follow: { type: "string", required: true, description: "Template id or \"\"" },
    },
    run: (args) => {
      const p = projectStore.get();
      const scene = str(args["scene"]) || sceneIdStore.get();
      if (!p.scenes.some((s) => s.id === scene)) return { ok: false, message: `unknown scene '${scene}'` };
      const follow = str(args["follow"]);
      if (follow && !projectDefs(p).some((d) => d.id === follow)) return { ok: false, message: `unknown template '${follow}'` };
      setSceneCamera(scene, follow);
      return { ok: true, message: follow ? `camera follows ${follow}` : "camera fixed" };
    },
  },
  {
    name: "set_tilemap",
    description:
      "Give a scene a tile layer (a level bigger than the screen: 1 byte per 8×8 cell, no object slots). sprite must be a sheet with 1×1-tile cells (set_sheet cell_w 1 cell_h 1). rows: the level as text, one line per tile row; legend maps each character to a sheet cell (0-based), other characters are empty. solid: sheet cells that block movement. Example: rows \"      \\n  ==  \\nGGGGGG\", legend {\"G\":0,\"=\":6}, solid [0,6]. Omit rows to remove the layer.",
    params: {
      scene: { type: "string", description: "Scene id (default current)" },
      sprite: { type: "string", description: "Tile sheet sprite id" },
      rows: { type: "string", description: "Level text, newline-separated" },
      legend: { type: "string", description: "JSON {char: cell}" },
      solid: { type: "array", description: "Solid cells" },
    },
    run: (args) => {
      const p = projectStore.get();
      const scene = str(args["scene"]) || sceneIdStore.get();
      if (!p.scenes.some((s) => s.id === scene)) return { ok: false, message: `unknown scene '${scene}'` };
      const rows = str(args["rows"]);
      if (!rows) {
        setSceneTilemap(scene, undefined);
        return { ok: true, message: `${scene}: tile layer removed` };
      }
      const sprite = str(args["sprite"]);
      const spr = p.sprites.find((s) => s.id === sprite);
      if (!spr) return { ok: false, message: `unknown sprite '${sprite}'` };
      let legend: Record<string, number> = {};
      try {
        legend = (typeof args["legend"] === "object" ? args["legend"] : JSON.parse(str(args["legend"], "{}"))) as Record<string, number>;
      } catch {
        return { ok: false, message: "legend must be JSON like {\"G\":0}" };
      }
      const oneBased = Object.fromEntries(Object.entries(legend).map(([k, v]) => [k, Number(v) + 1]));
      const map = tilesFromRows(rows.split("\n"), oneBased);
      const solid = Array.isArray(args["solid"]) ? (args["solid"] as unknown[]).map(Number) : [];
      setSceneTilemap(scene, { sprite, cols: map.cols, rows: map.rows, tiles: map.tiles, solid });
      const errs = validateProject(projectStore.get()).filter((e) => e.includes(`scene '${scene}' tiles`));
      return errs.length ? { ok: false, message: errs.join("; ") } : { ok: true, message: `${scene}: ${map.cols}×${map.rows} tiles (${map.cols * 8}×${map.rows * 8} px)` };
    },
  },
  {
    name: "set_sound",
    description:
      "Set one of 4 voices (Uxn limit): MIDI note 0-107, volume 0 (silent) to 255. The mix plays once on boot through Audio0-3 with a shared square wave.",
    params: {
      voice: { type: "number", required: true, description: "0-3" },
      note: { type: "number", required: true, description: "MIDI 0-107" },
      vol: { type: "number", required: true, description: "0-255" },
    },
    run: (args) => {
      setVoice(num(args["voice"]), num(args["note"], 60), num(args["vol"], 120));
      return { ok: true, message: `voice ${args["voice"]} set` };
    },
  },
  {
    name: "create_sound",
    description:
      "Add a named one-shot sound to the library (up to 4 voices each; index = Audio device, vol 0 = silent). Trigger it after boot with a play block. A sound where every voice is silent is rejected by validation.",
    params: {
      name: { type: "string", required: true, description: "Display name, becomes the id when valid" },
    },
    run: (args) => {
      const id = addSound(str(args["name"], "sound"));
      return { ok: true, message: `sound ${id}`, data: { id } };
    },
  },
  {
    name: "set_sound_voice",
    description: "Set one voice of a named sound: MIDI note 0-107, volume 0 (silent) to 255.",
    params: {
      sound: { type: "string", required: true, description: "Sound id from create_sound" },
      voice: { type: "number", required: true, description: "0-3" },
      note: { type: "number", required: true, description: "MIDI 0-107" },
      vol: { type: "number", required: true, description: "0-255" },
    },
    run: (args) => {
      const err = setSoundVoice(str(args["sound"]), num(args["voice"]), num(args["note"], 60), num(args["vol"], 120));
      if (err) return { ok: false, message: err };
      return { ok: true, message: `sound ${args["sound"]} voice ${args["voice"]} set` };
    },
  },
  {
    name: "set_loop",
    description:
      "Choose who runs the frame. engine (default): scenes, objects and blocks run; code plugs in via hooks. script: custom_frame() IS the game loop — no scene runtime; the engine boots theme/screen/variables, wires the key/mouse vectors to custom_key/custom_mouse, and exports the assets your code names: &spr_<sprite>, snd_<sound>(), var_<variable>[0], KEY_<INPUT>. An empty project switched to script gets a working starter custom.ux.",
    params: { mode: { type: "string", required: true, description: "engine|script" } },
    run: (args) => {
      const mode = str(args["mode"]);
      if (mode !== "engine" && mode !== "script") return { ok: false, message: "mode must be engine|script" };
      setLoopMode(mode);
      return { ok: true, message: `loop ${loopOf(projectStore.get())}` };
    },
  },
  {
    name: "set_custom_code",
    description:
      "Replace custom.ux: top-level ETAL (fns, globals, data, import lines) plus the hooks custom_setup, custom_frame, custom_draw (engine loop only), custom_key, custom_mouse — each called when defined. import lines hoist to the top of main.ux.",
    params: { code: { type: "string", required: true, description: "Full custom.ux source" } },
    run: (args) => {
      setCustomCode(str(args["code"]));
      return { ok: true, message: `custom.ux set; hooks: ${[...definedHooks(projectStore.get())].join(", ") || "none"}` };
    },
  },
  {
    name: "write_script",
    description:
      "Create or replace a script module (a whole .ux file, imported by main.ux in list order). Scripts may import each other and library modules by name (see list_library). Engine loop: scripts see engine state (ox/oy/var_*/SC_*); script loop: they see assets.ux. Globals must be declared before use (fns can be called from anywhere).",
    params: {
      path: { type: "string", required: true, description: "File name, e.g. game.ux (letters, digits, _)" },
      code: { type: "string", required: true, description: "Full ETAL source" },
    },
    run: (args) => {
      const path = str(args["path"]).trim();
      const p = projectStore.get();
      if ((p.scripts ?? []).some((s) => s.path === path)) {
        const err = setScriptCode(path, str(args["code"]));
        return err ? { ok: false, message: err } : { ok: true, message: `${path} updated` };
      }
      const err = addScript(path, str(args["code"]));
      if (err) return { ok: false, message: err };
      const made = (projectStore.get().scripts ?? []).at(-1)?.path;
      return { ok: true, message: `${made} created`, data: { path: made } };
    },
  },
  {
    name: "delete_script",
    description: "Delete a script module. Refused while another file imports it.",
    params: { path: { type: "string", required: true, description: "Script file name" } },
    run: (args) => {
      const err = deleteScript(str(args["path"]));
      return err ? { ok: false, message: err } : { ok: true, message: `${args["path"]} deleted` };
    },
  },
  {
    name: "list_library",
    description:
      "Standard library modules scripts can import by name (screen, font, input, audio, song, scene, menu, timer, fix16, trig, …). With a module, lists its fns/macros/constants with call forms.",
    params: { module: { type: "string", description: "e.g. screen.ux — omit to list all modules" } },
    run: (args) => {
      const mod = str(args["module"]);
      if (!mod) {
        return { ok: true, message: `${STDLIB_NAMES.length} modules`, data: { modules: STDLIB_NAMES.map((n) => ({ name: n, summary: moduleSummary(n) })) } };
      }
      const name = mod.endsWith(".ux") ? mod : `${mod}.ux`;
      if (!(name in STDLIB)) return { ok: false, message: `unknown module '${mod}'` };
      return { ok: true, message: name, data: { exports: moduleExports(STDLIB[name]) } };
    },
  },
  {
    name: "add_variable",
    description:
      "Add a named u16 game variable (score, health, flags — one buffer slot, initialized once at boot). Read/written by set/if blocks and shared with hand snippets as var_<id>[0].",
    params: {
      name: { type: "string", required: true, description: "Display name, becomes the id when valid" },
      init: { type: "number", description: "Boot value 0-65535, default 0" },
    },
    run: (args) => {
      const id = addVariable(str(args["name"], "var"), args["init"] === undefined ? 0 : num(args["init"]));
      return { ok: true, message: `variable ${id}`, data: { id } };
    },
  },
  {
    name: "rename_variable",
    description: "Rename a variable id everywhere set/if blocks reference it.",
    params: {
      from: { type: "string", required: true, description: "Current variable id" },
      to: { type: "string", required: true, description: "New id (letter first, letters/digits/_)" },
    },
    run: (args) => {
      const err = renameVariable(str(args["from"]), str(args["to"]));
      if (err) return { ok: false, message: err };
      return { ok: true, message: `variable ${args["to"]}` };
    },
  },
  {
    name: "set_variable",
    description: "Set a variable's boot init value (0-65535).",
    params: {
      variable: { type: "string", required: true, description: "Variable id from add_variable" },
      init: { type: "number", required: true, description: "Boot value 0-65535" },
    },
    run: (args) => {
      const err = setVariableInit(str(args["variable"]), num(args["init"]));
      if (err) return { ok: false, message: err };
      return { ok: true, message: `variable ${args["variable"]} set` };
    },
  },
  {
    name: "delete_variable",
    description: "Delete a variable. Refused while a set/if block names it.",
    params: {
      variable: { type: "string", required: true, description: "Variable id" },
    },
    run: (args) => {
      const err = deleteVariable(str(args["variable"]));
      if (err) return { ok: false, message: err };
      return { ok: true, message: "variable deleted" };
    },
  },
  {
    name: "create_song",
    description:
      "Add a named song loop to the Sound library: four sequencer voices, at most 16 steps each (MIDI pitch 0-107, len = ticks held). One loop plays at a time through the shared sequencer; start it with a song block and silence it with song_stop. Zero-vol voices and empty steps are rests, so a voice with no notes never gets an Audio device.",
    params: {
      name: { type: "string", required: true, description: "Display name, becomes the id when valid" },
    },
    run: (args) => {
      const id = addSong(str(args["name"], "song"));
      return { ok: true, message: `song ${id}`, data: { id } };
    },
  },
  {
    name: "set_song_note",
    description:
      "Set one step of a song voice: MIDI pitch 0-107, len 1-255 ticks. Pitch 127 (or omitted) makes the step a rest and a zero-length rest is left as-is; the loop always covers steps 0..(highest set step).",
    params: {
      song: { type: "string", required: true, description: "Song id from create_song" },
      voice: { type: "number", required: true, description: "0-3" },
      step: { type: "number", required: true, description: "0-15" },
      pitch: { type: "number", description: "MIDI 0-107, omit for a rest" },
      len: { type: "number", description: "Ticks held, 1-255 (default 2)" },
    },
    run: (args) => {
      const err = setSongNote(
        str(args["song"]),
        num(args["voice"]),
        num(args["step"]),
        args["pitch"] === undefined ? null : num(args["pitch"]),
        num(args["len"], 2),
      );
      if (err) return { ok: false, message: err };
      return { ok: true, message: `song ${args["song"]} voice ${args["voice"]} step ${args["step"]} set` };
    },
  },
  {
    name: "set_song_vol",
    description: "Set a song voice's volume: 0 (silent, no Audio device) to 255.",
    params: {
      song: { type: "string", required: true, description: "Song id from create_song" },
      voice: { type: "number", required: true, description: "0-3" },
      vol: { type: "number", required: true, description: "0-255" },
    },
    run: (args) => {
      const err = setSongVol(str(args["song"]), num(args["voice"]), num(args["vol"]));
      if (err) return { ok: false, message: err };
      return { ok: true, message: `song ${args["song"]} voice ${args["voice"]} volume set` };
    },
  },
  {
    name: "rename_song",
    description: "Rename a song id everywhere song blocks reference it.",
    params: {
      from: { type: "string", required: true, description: "Current song id" },
      to: { type: "string", required: true, description: "New id (letter first, letters/digits/_)" },
    },
    run: (args) => {
      const err = renameSong(str(args["from"]), str(args["to"]));
      if (err) return { ok: false, message: err };
      return { ok: true, message: `song ${args["to"]}` };
    },
  },
  {
    name: "delete_song",
    description: "Delete a song. Refused while a song block names it.",
    params: {
      song: { type: "string", required: true, description: "Song id" },
    },
    run: (args) => {
      const err = deleteSong(str(args["song"]));
      if (err) return { ok: false, message: err };
      return { ok: true, message: "song deleted" };
    },
  },
  {
    name: "set_label",
    description:
      "Set a dialogue label on a top-level leaf ({object} in the current scene): 1-24 printable ASCII chars, drawn at the object's position in 8px 1bpp cells (the baked 8x8 font, no import). Omit the text to clear it. Labels are per-instance state, so a template never carries one.",
    params: {
      object: { type: "string", required: true, description: "Top-level leaf id in the current scene" },
      text: { type: "string", description: "1-24 printable ASCII chars, omit to clear" },
    },
    run: (args) => {
      const raw = args["text"] === undefined ? "" : str(args["text"]);
      const text = raw.replace(/[^\x20-\x7e]/g, "").slice(0, 24);
      // Labels are per-instance state: a template never carries one,
      // so there is no def form here.
      if (!str(args["object"])) return { ok: false, message: "name the leaf with {object}" };
      const err = setLeafLabel(str(args["object"]), text || undefined);
      if (err) return { ok: false, message: err };
      return { ok: true, message: text ? `label '${text}' set` : "label cleared" };
    },
  },
  {
    name: "set_sheet",
    description:
      "Make a sprite a sheet of equal cells ({cell_w}×{cell_h} tiles, must divide the sprite; omit both for the whole sprite). A scene node then shows one cell (set_look {cell}) and measures as one cell; script code still reads the whole sheet at &spr_<id>, cell n's first tile at row-major cell offsets.",
    params: {
      sprite: { type: "string", required: true, description: "Sprite id" },
      cell_w: { type: "number", description: "Cell width in tiles" },
      cell_h: { type: "number", description: "Cell height in tiles" },
    },
    run: (args) => {
      const w = num(args["cell_w"], 0);
      const h = num(args["cell_h"], 0);
      const err = setSpriteCell(str(args["sprite"]), w && h ? { w, h } : null);
      if (err) return { ok: false, message: err };
      return { ok: true, message: w && h ? `sheet of ${w}×${h} cells` : "whole sprite" };
    },
  },
  {
    name: "set_look",
    description:
      "How a top-level leaf ({object}, current scene) draws — Varvara's sprite byte: {cell} (which sheet cell, 0-based), {flip_x}/{flip_y} (mirror), {blend} 0-15 (palette remap: 1 = identity opaque, the default; 5 = identity with color 0 transparent; 0 = 1→c0 2→c1 3→c2 with 0 transparent; blends 0/5/10/15 are the transparent ones). Same sprite, other colors or facing — no copies. The scene canvas paints exactly what the VM does. Only the given fields change.",
    params: {
      object: { type: "string", required: true, description: "Top-level leaf id in the current scene" },
      cell: { type: "number", description: "Sheet cell index" },
      flip_x: { type: "boolean", description: "Mirror left-right" },
      flip_y: { type: "boolean", description: "Mirror up-down" },
      blend: { type: "number", description: "Varvara blend 0-15" },
    },
    run: (args) => {
      const look: Parameters<typeof setLeafLook>[1] = {};
      if (typeof args["cell"] === "number") look.cell = args["cell"];
      if (typeof args["flip_x"] === "boolean") look.flipX = args["flip_x"];
      if (typeof args["flip_y"] === "boolean") look.flipY = args["flip_y"];
      if (typeof args["blend"] === "number") look.blend = args["blend"];
      const err = setLeafLook(str(args["object"]), look);
      if (err) return { ok: false, message: err };
      return { ok: true, message: "look set" };
    },
  },
  {
    name: "set_mask",
    description:
      "Set the hitbox on a template ({def}) or a top-level leaf ({object}): pixel offsets inside the sprite, the body for collision and clicks (drive keeps full bounds). Omit x/y/w/h to clear back to the whole sprite.",
    params: {
      def: { type: "string", description: "Object template id (exactly one of def/object)" },
      object: { type: "string", description: "Top-level leaf id (exactly one of def/object)" },
      x: { type: "number", description: "Left offset px" },
      y: { type: "number", description: "Top offset px" },
      w: { type: "number", description: "Width px" },
      h: { type: "number", description: "Height px" },
    },
    run: (args) => {
      const hasBox =
        args["x"] !== undefined || args["y"] !== undefined || args["w"] !== undefined || args["h"] !== undefined;
      const mask =
        hasBox
          ? {
              x: num(args["x"]),
              y: num(args["y"]),
              w: num(args["w"], 8),
              h: num(args["h"], 8),
            }
          : undefined;
      let err: string | null;
      if (str(args["def"])) err = setMask({ def: str(args["def"]) }, mask);
      else if (str(args["object"])) err = setMask({ leaf: str(args["object"]) }, mask);
      else return { ok: false, message: "name exactly one of def/object" };
      if (err) return { ok: false, message: err };
      return { ok: true, message: mask ? "hitbox set" : "hitbox cleared" };
    },
  },
  {
    name: "rename_sound",
    description: "Rename a sound id everywhere it is referenced (play blocks follow).",
    params: {
      from: { type: "string", required: true },
      to: { type: "string", required: true },
    },
    run: (args) => {
      const err = renameSound(str(args["from"]), str(args["to"]));
      if (err) return { ok: false, message: err };
      return { ok: true, message: `renamed to ${args["to"]}` };
    },
  },
  {
    name: "delete_sound",
    description: "Delete a named sound. Refused while a play block references it — retarget those blocks first.",
    params: {
      sound: { type: "string", required: true, description: "Sound id" },
    },
    run: (args) => {
      const err = deleteSound(str(args["sound"]));
      if (err) return { ok: false, message: err };
      return { ok: true, message: "sound deleted" };
    },
  },
  {
    name: "add_anim_frame",
    description:
      "Append a sprite as a frame of an animation (same tile size required — frames swap one address, mixed sizes would tear).",
    params: {
      anim: { type: "string", required: true, description: "Animation id" },
      sprite: { type: "string", required: true, description: "Sprite id" },
    },
    run: (args) => {
      const err = addAnimFrame(str(args["anim"]), str(args["sprite"]));
      if (err) return { ok: false, message: err };
      return { ok: true, message: "frame added" };
    },
  },
  {
    name: "set_anim",
    description: "Tune an animation: ticks per frame (rate 1-255), loop, ping-pong bounce at the ends (needs loop + 2+ frames).",
    params: {
      anim: { type: "string", required: true, description: "Animation id" },
      rate: { type: "number", description: "Ticks per frame 1-255" },
      loop: { type: "boolean", description: "Wrap (or hold last) at the end" },
      pingpong: { type: "boolean", description: "Bounce at the ends" },
    },
    run: (args) => {
      const p = projectStore.get();
      if (!p.anims.some((a) => a.id === str(args["anim"]))) return { ok: false, message: `unknown animation ${args["anim"]}` };
      patchAnimation(str(args["anim"]), {
        ...(args["rate"] === undefined ? {} : { rate: num(args["rate"], 30) }),
        ...(args["loop"] === undefined ? {} : { loop: !!args["loop"] }),
        ...(args["pingpong"] === undefined ? {} : { pingpong: !!args["pingpong"] }),
      });
      return { ok: true, message: "animation updated" };
    },
  },
  {
    name: "set_theme",
    description:
      "Set the System palette theme (3 channels 0-65535, nibbles per color). This is the ONLY way to get more colors: sprites stay 4 indices, but the 4 colors can be anything.",
    params: {
      r: { type: "number", required: true },
      g: { type: "number", required: true },
      b: { type: "number", required: true },
    },
    run: (args) => {
      setTheme({ r: num(args["r"]), g: num(args["g"]), b: num(args["b"]) });
      return { ok: true, message: "theme set" };
    },
  },
  {
    name: "validate",
    description: "Run full project validation (ids, refs, physics rules, cycles, slot budget, sounds, theme). Same gate as export.",
    params: {},
    run: () => {
      const errs = validateProject(projectStore.get());
      return { ok: errs.length === 0, message: errs.length === 0 ? "valid" : errs.join("; ") };
    },
  },
  {
    name: "emit_files",
    description: "Lower the project to ETAL files (devices.ux, main.ux) without compiling. Deterministic: same project, same bytes.",
    params: {},
    run: () => {
      try {
        const files = emitProject(projectStore.get());
        return { ok: true, message: Object.keys(files).join(", "), data: { files } };
      } catch (e) {
        return { ok: false, message: (e as Error).message };
      }
    },
  },
  {
    name: "move_object",
    description: "Move a top-level object to absolute game pixels (origin top-left, clamped to canvas). Validate with check_space first.",
    params: {
      object: { type: "string", required: true },
      x: { type: "number", required: true },
      y: { type: "number", required: true },
    },
    run: (args) => {
      setObjectPos(str(args["object"]), num(args["x"]), num(args["y"]));
      return { ok: true, message: `moved ${args["object"]}` };
    },
  },
  {
    name: "rename_object",
    description: "Rename an object id (click bindings follow).",
    params: {
      from: { type: "string", required: true },
      to: { type: "string", required: true },
    },
    run: (args) => {
      const err = renameObject(str(args["from"]), str(args["to"]));
      return err ? { ok: false, message: err } : { ok: true, message: `renamed to ${args["to"]}` };
    },
  },
  {
    name: "delete_node",
    description: "Delete a node by index from a list (default: current top level).",
    params: {
      index: { type: "number", required: true },
      scene: { type: "string", description: "Scene id, default current" },
    },
    run: (args) => {
      const sceneId = str(args["scene"]) || sceneIdStore.get();
      deleteNode({ sceneId, parent: [] }, num(args["index"]));
      return { ok: true, message: "deleted" };
    },
  },
  {
    name: "reorder_nodes",
    description: "Reorder two slots in a list (draw order follows).",
    params: {
      from: { type: "number", required: true },
      to: { type: "number", required: true },
    },
    run: (args) => {
      reorderNodes({ sceneId: sceneIdStore.get(), parent: [] }, num(args["from"]), num(args["to"]));
      return { ok: true, message: "reordered" };
    },
  },
  {
    name: "move_node",
    description: "Move a node between lists by index (cycle-guarded for branches).",
    params: {
      from_scene: { type: "string", required: true },
      from_index: { type: "number", required: true },
      to_scene: { type: "string", required: true },
    },
    run: (args) => {
      const ok = moveNode(
        { sceneId: str(args["from_scene"]), parent: [] },
        num(args["from_index"]),
        { sceneId: str(args["to_scene"]), parent: [] },
      );
      return ok ? { ok: true, message: "moved" } : { ok: false, message: "move refused (cycle or missing)" };
    },
  },
  {
    name: "create_project",
    description: "Create a fresh project and switch to it.",
    params: { name: { type: "string", required: true } },
    run: (args) => {
      const id = createProject(str(args["name"], "Untitled"));
      return { ok: true, message: `project ${id}`, data: { id } };
    },
  },
  {
    name: "open_project",
    description: "Switch to an existing project by id.",
    params: { id: { type: "string", required: true } },
    run: (args) => {
      openProject(str(args["id"]));
      return { ok: true, message: `opened ${args["id"]}`, data: snapshot() };
    },
  },
  {
    name: "scene_map",
    description:
      "Spatial snapshot of a scene (default: current): canvas width/height in game pixels (origin top-left, +x right, +y down) and every visible object as {path, x, y, w, h, kind, solid, sprite}. Use before placing or moving anything; pair with find_space for a free spot.",
    params: {
      scene: { type: "string", description: "Scene id, default current" },
    },
    run: (args) => {
      const r = resolveScene(args["scene"]);
      if ("err" in r) return { ok: false, message: r.err };
      let rects: LeafRect[];
      try {
        rects = leafRects(r.id);
      } catch (e) {
        return { ok: false, message: (e as Error).message };
      }
      return {
        ok: true,
        message: `${r.id} ${r.p.width}×${r.p.height}, ${rects.length} objects`,
        data: { scene: r.id, width: r.p.width, height: r.p.height, objects: rects },
      };
    },
  },
  {
    name: "find_space",
    description:
      "Find a free 8px-snapped spot for a w×h pixel object (defaults 8×8) on a scene: inside the canvas and not overlapping solid objects (avoid 'all' dodges every object instead). Returns {x, y}; ok:false when nothing fits. Pass nearX/nearY to prefer a spot near a point.",
    params: {
      w: { type: "number", description: "Pixels wide, default 8" },
      h: { type: "number", description: "Pixels tall, default 8" },
      scene: { type: "string", description: "Scene id, default current" },
      nearX: { type: "number", description: "Prefer spots near this x" },
      nearY: { type: "number", description: "Prefer spots near this y" },
      avoid: { type: "string", description: "solid|all, default solid" },
    },
    run: (args) => {
      const r = resolveScene(args["scene"]);
      if ("err" in r) return { ok: false, message: r.err };
      const w = Math.max(1, Math.round(num(args["w"], 8)));
      const h = Math.max(1, Math.round(num(args["h"], 8)));
      if (w > r.p.width || h > r.p.height)
        return { ok: false, message: `${w}×${h} exceeds canvas ${r.p.width}×${r.p.height}` };
      let rects: LeafRect[];
      try {
        rects = leafRects(r.id);
      } catch (e) {
        return { ok: false, message: (e as Error).message };
      }
      const pool = str(args["avoid"]) === "all" ? rects : rects.filter((o) => o.solid);
      const nx = num(args["nearX"], r.p.width / 2);
      const ny = num(args["nearY"], r.p.height / 2);
      let best: { x: number; y: number; d: number } | null = null;
      let checked = 0;
      for (let y = 0; y + h <= r.p.height; y += 8) {
        for (let x = 0; x + w <= r.p.width; x += 8) {
          checked++;
          const cand = { x, y, w, h };
          if (pool.some((o) => rectsOverlap(cand, o))) continue;
          const d = (x + w / 2 - nx) ** 2 + (y + h / 2 - ny) ** 2;
          if (!best || d < best.d) best = { x, y, d };
        }
      }
      if (!best) return { ok: false, message: `no free ${w}×${h} spot on ${r.id} (${checked} tried)` };
      return { ok: true, message: `free ${w}×${h} at ${best.x},${best.y}`, data: { x: best.x, y: best.y, scene: r.id } };
    },
  },
  {
    name: "check_space",
    description:
      "Test a w×h rect at x,y on a scene (default: current): reports inside-canvas plus overlapping object paths (all) and the solid subset. Use to validate a placement before put_on_scene/place_instance/move_object.",
    params: {
      x: { type: "number", required: true },
      y: { type: "number", required: true },
      w: { type: "number", description: "Pixels wide, default 8" },
      h: { type: "number", description: "Pixels tall, default 8" },
      scene: { type: "string", description: "Scene id, default current" },
    },
    run: (args) => {
      const r = resolveScene(args["scene"]);
      if ("err" in r) return { ok: false, message: r.err };
      const w = Math.max(1, Math.round(num(args["w"], 8)));
      const h = Math.max(1, Math.round(num(args["h"], 8)));
      const x = Math.round(num(args["x"]));
      const y = Math.round(num(args["y"]));
      let rects: LeafRect[];
      try {
        rects = leafRects(r.id);
      } catch (e) {
        return { ok: false, message: (e as Error).message };
      }
      const cand = { x, y, w, h };
      const overlaps = rects.filter((o) => rectsOverlap(cand, o)).map((o) => o.path);
      const solid = rects.filter((o) => o.solid && rectsOverlap(cand, o)).map((o) => o.path);
      const inside = x >= 0 && y >= 0 && x + w <= r.p.width && y + h <= r.p.height;
      return {
        ok: true,
        message: inside ? (solid.length === 0 ? "fits" : `blocked by ${solid.join(",")}`) : "outside canvas",
        data: { inside, fits: inside && solid.length === 0, overlaps, solid },
      };
    },
  },
  {
    name: "read_file",
    description:
      "Read source with line numbers: a script (game.ux), custom.ux, a generated file (main.ux, devices.ux) or a library module (lib/fix16.ux). Read a script before rewriting it, and read around a line check_build reports. Long files: pass from/to (max 400 lines per call).",
    params: {
      path: { type: "string", required: true, description: "File name, e.g. chess.ux, main.ux, lib/screen.ux" },
      from: { type: "number", description: "First line (default 1)" },
      to: { type: "number", description: "Last line (default from+399)" },
    },
    run: (args) => {
      const src = sourceOf(str(args["path"]).trim());
      if (!src) return { ok: false, message: `no file '${str(args["path"])}' (scripts: ${(projectStore.get().scripts ?? []).map((s) => s.path).join(", ") || "none"})` };
      const total = src.text.split("\n").length;
      const from = Math.max(1, num(args["from"], 1));
      const to = Math.min(total, num(args["to"], from + 399), from + 399);
      return { ok: true, message: `${src.path} lines ${from}-${to} of ${total}`, data: { text: numbered(src.text, from, to) } };
    },
  },
  {
    name: "check_build",
    description:
      "Compile the project with the real ETAL compiler (server) and return its diagnostics [{file, line, msg}]. Run after validate and after every script change; fix every diagnostic (read_file around the line) and check again until it passes.",
    params: {},
    run: () => ({ ok: false, message: "check_build needs the agent loop (async)" }),
    runAsync: async () => {
      const p = projectStore.get();
      const errs = validateProject(p);
      if (errs.length > 0) return { ok: false, message: `validation: ${errs.join("; ")}` };
      const r = await compileProject(p, "web", "rom", "en");
      if (r.ok) return { ok: true, message: `compiles cleanly (${r.bytes?.length ?? 0} byte ROM)` };
      const diags = (r.diagnostics ?? []).map((d) => ({
        file: d.file ? d.file.slice(d.file.lastIndexOf("/") + 1) : null,
        line: d.line,
        msg: d.msg,
      }));
      return {
        ok: false,
        message: diags.length ? `${diags.length} compiler error(s): ${diags.slice(0, 8).map((d) => `${d.file ?? "?"}:${d.line ?? "?"} ${d.msg}`).join(" | ")}` : r.message,
        data: { diagnostics: diags, hint: "main.ux is generated: an error there usually comes from a block's code/call or a name clash — use preview_event / read_file main.ux around the line." },
      };
    },
  },
  {
    name: "describe",
    description: "Summarize the current project: scenes, sprites, anims, selection. Start here, then scene_map for positions.",
    params: {},
    run: () => ({ ok: true, message: "snapshot", data: snapshot() }),
  },
];

/** One of {def} (template) or {object} (top-level leaf of the
    current scene) must name the event owner. */
function ownerOf(args: Record<string, unknown>): EventOwner | null {
  const def = str(args["def"]);
  const object = str(args["object"]);
  const scene = str(args["scene"]);
  if ([def, object, scene].filter(Boolean).length !== 1) return null;
  if (def) return { def };
  if (object) return { leaf: object };
  return { scene };
}

/** "1.then.0.body" → [1, "then", 0, "body"]; "" → top level. */
function parsePath(s: string): BlockPath | null {
  if (!s) return [];
  const out: BlockPath = [];
  const segs = s.split(".");
  if (segs.length % 2 !== 0) return null;
  for (let i = 0; i < segs.length; i += 2) {
    const idx = segs[i];
    const br = segs[i + 1];
    if (!/^\d+$/.test(idx) || (br !== "then" && br !== "else" && br !== "body")) return null;
    out.push(Number(idx), br);
  }
  return out;
}

/** Agent-loop entry: awaits network tools, runs the rest in place. */
export async function runToolAsync(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool?.runAsync) return runTool(name, args);
  try {
    return await tool.runAsync(args);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export function runTool(name: string, args: Record<string, unknown>): ToolResult {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { ok: false, message: `unknown tool ${name}` };
  try {
    return tool.run(args);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
