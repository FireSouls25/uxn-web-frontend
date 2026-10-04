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
  addBinding,
  addBlock,
  addDef,
  addEvent,
  addInstance,
  addNode,
  addObject,
  addScene,
  addSound,
  addSprite,
  createProject,
  deleteBlock,
  deleteEvent,
  deleteNode,
  deleteSound,
  extractObject,
  moveNode,
  openProject,
  patchAnimation,
  patchDef,
  patchObject,
  projectStore,
  readList,
  renameObject,
  renameSound,
  reorderNodes,
  sceneIdStore,
  selectionStore,
  setMask,
  setObjectPos,
  setSceneFrameCode,
  setSoundVoice,
  setSpritePixels,
  setTheme,
  setVoice,
} from "../store";
import { emitProject, previewOwnerEvent, projectDefs, validateProject } from "../project";
import type { Block, EventTrigger, ObjectKind } from "../project";
import type { EventOwner } from "../store";

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
    sounds: (p.sounds ?? []).map((s) => s.id),
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
    name: "add_event",
    description:
      "Add an event to a template ({def}) or an inline leaf ({object}, top-level of current scene). Triggers: create (scene enter), step (every frame), destroy, key (named input), collide (overlap vs any|solid|player|movable|def:<id>), click (press on it), alarm (slot countdown hits 0, set by wait blocks). One event per trigger+key/target.",
    params: {
      def: { type: "string", description: "Object template id (exactly one of def/object)" },
      object: { type: "string", description: "Inline leaf id (exactly one of def/object)" },
      trigger: { type: "string", required: true, description: "create|step|destroy|key|collide|click|alarm" },
      key: { type: "string", description: "Named input id (key trigger)" },
      target: { type: "string", description: "any|solid|player|movable|def:<id> (collide trigger)" },
    },
    run: (args) => {
      const owner = ownerOf(args);
      if (!owner) return { ok: false, message: "name exactly one of def/object" };
      const id = addEvent(owner, str(args["trigger"]) as EventTrigger, {
        key: str(args["key"]) || undefined,
        target: str(args["target"]) || undefined,
      });
      if (!id) return { ok: false, message: "event refused (unknown owner, trigger, key, or target)" };
      return { ok: true, message: `event ${id}`, data: { id } };
    },
  },
  {
    name: "add_block",
    description:
      "Append a visual action to an event (see add_event). Ops: move {dx,dy} (pixels, clamped), set_pos {x,y}, play {sound} (named one-shot SFX — see create_sound), goto {scene}, destroy (self), wait {ticks 1-255} (arms the alarm event), code {code} (raw ETAL statements, same gate as tick text), button {label, action} (labeled annotation, lowers to a comment). Every op lowers to fixed ETAL — use preview_event to see it.",
    params: {
      def: { type: "string", description: "Object template id (exactly one of def/object)" },
      object: { type: "string", description: "Inline leaf id (exactly one of def/object)" },
      event: { type: "string", required: true, description: "Event id from add_event" },
      op: { type: "string", required: true, description: "move|set_pos|play|goto|destroy|wait|code|button" },
      dx: { type: "number", description: "move: pixels" },
      dy: { type: "number", description: "move: pixels" },
      x: { type: "number", description: "set_pos: pixels" },
      y: { type: "number", description: "set_pos: pixels" },
      sound: { type: "string", description: "play: named sound id (see create_sound)" },
      scene: { type: "string", description: "goto: target scene" },
      ticks: { type: "number", description: "wait: 1-255" },
      code: { type: "string", description: "code: raw ETAL statements" },
      label: { type: "string", description: "button: 1-32 character label" },
      action: { type: "string", description: "button: named action (at most 64 characters)" },
      index: { type: "number", description: "Insert position, default append" },
    },
    run: (args) => {
      const owner = ownerOf(args);
      if (!owner) return { ok: false, message: "name exactly one of def/object" };
      const block = blockOf(args);
      if (!block) return { ok: false, message: `bad op or missing fields for '${args["op"]}'` };
      const ok = addBlock(owner, str(args["event"]), block, args["index"] === undefined ? undefined : num(args["index"]));
      if (!ok) return { ok: false, message: "block refused (unknown owner or event)" };
      return { ok: true, message: `${(block as Block).op} added`, data: {} };
    },
  },
  {
    name: "delete_event",
    description: "Delete an event (and its blocks) from a template or inline leaf.",
    params: {
      def: { type: "string", description: "Object template id (exactly one of def/object)" },
      object: { type: "string", description: "Inline leaf id (exactly one of def/object)" },
      event: { type: "string", required: true, description: "Event id" },
    },
    run: (args) => {
      const owner = ownerOf(args);
      if (!owner) return { ok: false, message: "name exactly one of def/object" };
      if (!deleteEvent(owner, str(args["event"]))) return { ok: false, message: "unknown owner or event" };
      return { ok: true, message: "event deleted" };
    },
  },
  {
    name: "delete_block",
    description: "Delete one block of an event by index.",
    params: {
      def: { type: "string", description: "Object template id (exactly one of def/object)" },
      object: { type: "string", description: "Inline leaf id (exactly one of def/object)" },
      event: { type: "string", required: true, description: "Event id" },
      index: { type: "number", required: true, description: "Block index" },
    },
    run: (args) => {
      const owner = ownerOf(args);
      if (!owner) return { ok: false, message: "name exactly one of def/object" };
      if (!deleteBlock(owner, str(args["event"]), num(args["index"]))) return { ok: false, message: "unknown owner, event, or index" };
      return { ok: true, message: "block deleted" };
    },
  },
  {
    name: "preview_event",
    description:
      "Show the exact ETAL an event lowers to (same function the emitter calls — preview and build cannot disagree).",
    params: {
      def: { type: "string", description: "Object template id (exactly one of def/object)" },
      object: { type: "string", description: "Inline leaf id (exactly one of def/object)" },
      event: { type: "string", required: true, description: "Event id" },
    },
    run: (args) => {
      const p = projectStore.get();
      const owner = ownerOf(args);
      if (!owner) return { ok: false, message: "name exactly one of def/object", data: {} };
      const lines = previewOwnerEvent(
        p,
        sceneIdStore.get(),
        "def" in owner ? { def: owner.def } : { leaf: owner.leaf },
        str(args["event"]),
      );
      if (!lines) return { ok: false, message: "unknown owner or event", data: {} };
      return { ok: true, message: lines.join("\n") || "(no blocks)", data: { etal: lines } };
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
    name: "creation_code",
    description:
      "Attach per-instance creation code: ETAL statements spliced after the leaf's create-event blocks in its create fn, run on scene enter (GameMaker Creation Code — the escape hatch that prevents template proliferation). Empty clears.",
    params: {
      object: { type: "string", required: true, description: "Top-level object id in current scene" },
      code: { type: "string", required: true, description: "ETAL statements" },
    },
    run: (args) => {
      const p = projectStore.get();
      const scene = p.scenes.find((s) => s.id === sceneIdStore.get());
      const node = scene?.nodes.find((o) => o.id === str(args["object"]) && !o.scene);
      if (!node) return { ok: false, message: `unknown object ${args["object"]}` };
      patchObject(node.id, { initCode: str(args["code"]) || undefined });
      return { ok: true, message: `creation code set on ${node.id}` };
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

/** One of {def} (template) or {object} (top-level leaf of the
    current scene) must name the event owner. */
function ownerOf(args: Record<string, unknown>): EventOwner | null {
  const def = str(args["def"]);
  const object = str(args["object"]);
  if (def && object) return null;
  if (def) return { def };
  if (object) return { leaf: object };
  return null;
}

function blockOf(args: Record<string, unknown>): Block | null {
  const op = str(args["op"]);
  if (op === "move") return { op, dx: num(args["dx"]), dy: num(args["dy"]) };
  if (op === "set_pos") return { op, x: num(args["x"]), y: num(args["y"]) };
  if (op === "play") {
    if (!str(args["sound"])) return null;
    return { op, sound: str(args["sound"]) };
  }
  if (op === "goto") {
    if (!str(args["scene"])) return null;
    return { op, scene: str(args["scene"]) };
  }
  if (op === "destroy") return { op };
  if (op === "wait") return { op, ticks: num(args["ticks"], 30) };
  if (op === "code") {
    if (!str(args["code"]).trim()) return null;
    return { op, code: str(args["code"]) };
  }
  if (op === "button") {
    if (!str(args["label"]).trim()) return null;
    return { op, label: str(args["label"]).slice(0, 32), action: str(args["action"]).slice(0, 64) };
  }
  return null;
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
