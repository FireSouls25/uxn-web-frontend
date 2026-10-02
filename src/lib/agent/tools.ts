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
  addBinding,
  addDef,
  addInstance,
  addNode,
  addObject,
  addScene,
  addSprite,
  createProject,
  deleteNode,
  extractObject,
  moveNode,
  openProject,
  patchDef,
  patchObject,
  projectStore,
  readList,
  renameObject,
  reorderNodes,
  sceneIdStore,
  selectionStore,
  setObjectPos,
  setSceneFrameCode,
  setSpritePixels,
  setTheme,
  setVoice,
} from "../store";
import { emitProject, projectDefs, validateProject } from "../project";
import type { ObjectKind } from "../project";

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
}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === "number" ? v : fallback);

function snapshot(): Record<string, unknown> {
  const p = projectStore.get();
  return {
    project: p.id,
    scene: sceneIdStore.get(),
    scenes: p.scenes.map((s) => s.id),
    sprites: p.sprites.map((s) => s.id),
    defs: projectDefs(p).map((d) => d.id),
    anims: p.anims.map((a) => a.id),
  };
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
      "Place a sprite as an object on a scene (default: current scene). Kinds: player (at most one per scene, 0 allowed), static (prop), movable (solid + pushable). Coordinates are pixels; clamped to canvas.",
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
      "Stamp an instance of an object template on a scene (default: current scene). Local fields override the def per instance; position is always instance state.",
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
      "Bind an event to a scene switch: click an object (press-in-rect, mouse left) or press a key code (32 space, 27 escape). Object may be a nested path like rack/jar.",
    params: {
      event: { type: "string", required: true, description: "click|key" },
      object: { type: "string", description: "Object id or nested path (click only)" },
      key: { type: "number", description: "Key code 0-255 (key only)" },
      goto: { type: "string", required: true, description: "Target scene id" },
    },
    run: (args) => {
      const p = projectStore.get();
      const goto = str(args["goto"]);
      if (!p.scenes.some((s) => s.id === goto)) return { ok: false, message: `unknown scene ${goto}` };
      if (str(args["event"]) === "key") {
        addBinding("key", null, goto, num(args["key"], 32));
      } else {
        addBinding("click", str(args["object"]), goto);
      }
      return { ok: true, message: `${args["event"]} → ${goto}` };
    },
  },
  {
    name: "script_object",
    description:
      "Attach a per-object ETAL script, wrapped as tick_<scene>_<id>(slot) and called every frame. Full access to generated state (ox[slot], scene fns). Reserved generated names rejected; compiler errors surface at export.",
    params: {
      object: { type: "string", required: true, description: "Top-level object id in current scene" },
      code: { type: "string", required: true, description: "ETAL statements" },
    },
    run: (args) => {
      patchObject(str(args["object"]), { tick: str(args["code"]) || undefined });
      return { ok: true, message: `script set on ${args["object"]}` };
    },
  },
  {
    name: "script_scene",
    description:
      "Attach a per-scene ETAL script, spliced at the end of the scene frame (after input/drive/ticks, before drawing). Same reserved names as custom code.",
    params: {
      scene: { type: "string", description: "Scene id, default current" },
      code: { type: "string", required: true, description: "ETAL statements" },
    },
    run: (args) => {
      const p = projectStore.get();
      const id = str(args["scene"]) || sceneIdStore.get();
      if (!p.scenes.some((s) => s.id === id)) return { ok: false, message: `unknown scene ${id}` };
      const prev = sceneIdStore.get();
      sceneIdStore.set(id);
      setSceneFrameCode(str(args["code"]));
      sceneIdStore.set(prev);
      return { ok: true, message: `scene script set on ${id}` };
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
    description: "Move a top-level object to absolute pixels (clamped to canvas).",
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
    name: "describe",
    description: "Summarize the current project: scenes, sprites, anims, selection. Start here.",
    params: {},
    run: () => ({ ok: true, message: "snapshot", data: snapshot() }),
  },
];

export function runTool(name: string, args: Record<string, unknown>): ToolResult {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { ok: false, message: `unknown tool ${name}` };
  try {
    return tool.run(args);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
