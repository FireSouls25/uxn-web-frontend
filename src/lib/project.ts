/* Project → ETAL emitter.
   A low-code project (scenes of 8px objects + click/key bindings that
   switch scenes, physics flags, sprite-library animations, boot jingle)
   lowers to dependency-free ETAL: two files, no imports beyond siblings,
   only constructs the backend compiler accepts. Sprites are 1×1 to
   4×4 tiles of 8×8 2bpp (16 planar bytes per tile, channel one then
   channel two — the .chr layout), drawn tile by tile with mode 129
   (2bpp, blend-1 identity: all four palette colors addressable,
   opaque). Deterministic by construction: sorted ids, fixed slot
   pool, literal everything. */

import { pixelsToPlanar, monoToPixels, THEME_R, THEME_G, THEME_B } from "./palette";

/** One sprite → ROM blob: each 8×8 tile becomes 16 planar bytes
    (channel one, then two), tiles concatenated in row-major order so
    tile (tx + ty*w) starts at blob offset (tx + ty*w)*16 — the layout
    the per-scene draw fns assume for addr arithmetic. */
export function spriteToPlanar(s: Sprite): number[] {
  const [w, h] = spriteTiles(s);
  const out: number[] = [];
  for (let t = 0; t < w * h; t++) out.push(...pixelsToPlanar(s.pixels.slice(t * 64, (t + 1) * 64)));
  return out;
}

export const TILE_PX = 8;
/** Max sprite extent per axis, in tiles (32px). The Screen device
    draws 8×8 tiles; bigger sprites are consecutive tiles (see
    spriteToPlanar + per-scene draw fns). Beyond 4×4 the ROM and
    per-frame port writes stop being worth it on Uxn screens. */
export const MAX_SPRITE_TILES = 4;

export interface Sprite {
  id: string;
  /** Width/height in 8px tiles. Absent = 1×1 (every pre-size project). */
  w?: number;
  h?: number;
  /** 64*w*h color indices 0–3, row-major; tile (tx + ty*w) lives at
      offset (tx + ty*w)*64, matching blob order for auto-addr draws. */
  pixels: number[];
}

/** Sprite dimensions in tiles, legacy-safe. */
export function spriteTiles(s: Sprite): [number, number] {
  return [s.w ?? 1, s.h ?? 1];
}

/** Sprite dimensions in pixels. */
export function spritePx(s: Sprite): [number, number] {
  const [w, h] = spriteTiles(s);
  return [w * TILE_PX, h * TILE_PX];
}

/** Pixel dims for a sprite id; unknown id → 8×8 so mid-edit states
    (deleted sprite, typing id) still render instead of crashing. */
export function spritePxOf(p: Project, id: string): [number, number] {
  const s = p.sprites.find((x) => x.id === id);
  return s ? spritePx(s) : [TILE_PX, TILE_PX];
}

export interface Animation {
  id: string;
  /** Sprite ids, played in order. */
  frames: string[];
  /** Ticks per frame (60Hz frames). */
  rate: number;
  loop: boolean;
  /** Bounce at the ends instead of wrapping (requires loop + 2+ frames). */
  pingpong?: boolean;
}

/** Hitbox mask in sprite pixels: the body for collision AND clicks
    (the full sprite stays the canvas/drive bounds — generous world,
    precise hitbox). Absent = whole sprite. */
export interface HitBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ObjectKind = "player" | "static" | "movable";

/** Loop moments an object can react to (GameMaker events, Uxn-sized).
    create runs on scene enter; step every frame; key/click/collide on
    input and overlap; alarm when the slot countdown hits 0; destroy
    runs its statements when a destroy block fires. */
export type EventTrigger = "create" | "step" | "destroy" | "key" | "collide" | "click" | "alarm";

export interface BlockMove {
  op: "move";
  dx: number;
  dy: number;
}
export interface BlockPos {
  op: "set_pos";
  x: number;
  y: number;
}
export interface BlockPlay {
  op: "play";
  /** Named sound id (Phase 3: one-shot SFX from the library). */
  sound: string;
}
export interface BlockGoto {
  op: "goto";
  scene: string;
}
export interface BlockDestroy {
  op: "destroy";
}
export interface BlockWait {
  op: "wait";
  ticks: number;
}

/** One visual action = one ETAL lowering (see previewBlocks). No
    `if`, no variables in v1: events ARE the conditionals, and the
    tick textarea remains the code hatch for the rest. */
export type Block = BlockMove | BlockPos | BlockPlay | BlockGoto | BlockDestroy | BlockWait;

export interface ObjectEvent {
  /** Stable id for agent/UI targeting (ev_N). */
  id: string;
  trigger: EventTrigger;
  /** key trigger: named input id. */
  key?: string;
  /** collide trigger: any|solid|player|movable|def:<id>. */
  target?: string;
  blocks: Block[];
}

/** An object template: the GameMaker Object in our Object ≠ Sprite ≠
    Instance split. A def owns default art, physics flags, animation
    and tick script; scene leaves either inline all of that (today's
    behavior) or carry `def` and override per field. Events arrive in
    Phase 2; the tick default already makes defs useful now. */
export interface ObjectDef {
  id: string;
  sprite: string;
  kind: ObjectKind;
  solid?: boolean;
  controls?: boolean;
  anim?: string;
  tick?: string;
  /** The def's events; instances inherit them whole. */
  events?: ObjectEvent[];
  /** Default hitbox; a leaf mask replaces it whole (boxes don't merge). */
  mask?: HitBox;
}

/** The def library, legacy-safe: pre-def projects simply have none. */
export function projectDefs(p: Project): ObjectDef[] {
  return p.objectDefs ?? [];
}

export interface ClickBinding {
  object: string;
  goto: string;
}

/** A named keyboard input: the GameMaker key-picker / Godot input-map
    equivalent. Bindings reference the id; the emitter resolves it to
    the raw Controller.key code, so renaming never breaks wiring. */
export interface NamedInput {
  id: string;
  /** Raw key code (32 = space, 27 = escape). */
  key: number;
}

export interface KeyBinding {
  /** Named input id (preferred). Absent = legacy raw code below. */
  input?: string;
  /** Controller.key code (32 = space, 27 = escape). */
  key: number;
  goto: string;
}

/** Effective key code for a binding: named input wins, legacy raw
    code is the fallback. Unknown input id → raw code (validated). */
export function bindingKey(p: Project, k: KeyBinding): number {
  return (p.inputs ?? []).find((i) => i.id === k.input)?.key ?? k.key;
}

export interface SceneNode {
  /** Instance id, unique within the parent scene. */
  id: string;
  /** Leaf: sprite id. Branch: subscene id. Exactly one is set. */
  sprite?: string;
  scene?: string;
  /** Position (leaves) or origin offset (branches). */
  x: number;
  y: number;
  /** Leaves only; see ObjectKind. */
  kind?: ObjectKind;
  /** Leaves only. */
  solid?: boolean;
  /** Leaves only (player kind only). */
  controls?: boolean;
  /** Leaves only. */
  anim?: string;
  /** Leaves only: per-object script, wrapped as tick_<root>_<path>. */
  tick?: string;
  /** Leaves only: creation code — ETAL statements spliced after the
      leaf's create-event blocks in its create fn (GameMaker Creation
      Code: per-instance patch, runs on scene enter). Always instance
      state, never inherited from a def. */
  initCode?: string;
  /** Leaves only: hitbox override (def leaves: default on the def). */
  mask?: HitBox;
  /** Leaves only: instance of ObjectDef. Every field above (except
      id/x/y, which are always instance state) falls back to the def
      when locally absent — explicit local values always win. */
  def?: string;
  /** Inline leaves only: this leaf's events (instances use their
      def's — a local list on an instance is a validation error). */
  events?: ObjectEvent[];
}

export interface Scene {
  id: string;
  /** Godot-like node tree: sprite leaves and subscene branches. */
  nodes: SceneNode[];
  clicks: ClickBinding[];
  keys: KeyBinding[];
  /** Per-scene script: statements spliced at the end of this scene's
      frame fn (after input/drive/ticks, before drawing). Full access
      to generated state (ox[], ocount, scene fns). */
  frameCode?: string;
}

export interface FlatLeaf extends SceneNode {
  /** Dotted instance path (board/sq_a1), unique per flattening. */
  path: string;
  kind: ObjectKind;
  sprite: string;
  /** Effective events: the def's for instances, the leaf's own for
      inlines. The emitter, validation and tools all read this. */
  events: ObjectEvent[];
}

/** Leaf node with resolved defaults. */
export type SceneObject = SceneNode & { sprite: string; kind: ObjectKind };

const MAX_DEPTH = 8;

/** Depth-first flatten with accumulated offsets. Throws on cycles,
    depth overflow, or slot overflow — validation surfaces these. */
export function flattenScene(p: Project, sceneId: string): FlatLeaf[] {
  const scenes = new Map(p.scenes.map((s) => [s.id, s]));
  const defs = new Map(projectDefs(p).map((d) => [d.id, d]));
  const out: FlatLeaf[] = [];
  const visit = (id: string, ox: number, oy: number, trail: string[], prefix: string[], depth: number): void => {
    if (trail.includes(id)) throw new Error(`scene cycle: ${[...trail, id].join(" → ")}`);
    if (depth > MAX_DEPTH) throw new Error(`scene nesting past ${MAX_DEPTH}`);
    const scene = scenes.get(id);
    if (!scene) throw new Error(`unknown scene '${id}'`);
    for (const n of scene.nodes) {
      const path = [...prefix, n.id].join("/");
      if (n.scene) {
        visit(n.scene, ox + n.x, oy + n.y, [...trail, id], [...prefix, n.id], depth + 1);
      } else {
        // Def-backed leaves resolve here — local fields over def
        // defaults — so emitter, canvas and validation all see
        // effective values from one place. Unknown defs resolve to
        // nothing (validation reports them); flatten never throws
        // for data reasons.
        const def = n.def ? defs.get(n.def) : undefined;
        out.push({
          ...n,
          path,
          x: n.x + ox,
          y: n.y + oy,
          kind: n.kind ?? def?.kind ?? "static",
          sprite: n.sprite ?? def?.sprite ?? "",
          solid: n.solid ?? def?.solid,
          controls: n.controls ?? def?.controls,
          anim: n.anim ?? def?.anim,
          tick: n.tick ?? def?.tick,
          mask: n.mask ?? def?.mask,
          events: def ? (def.events ?? []) : (n.events ?? []),
        });
      }
    }
  };
  visit(sceneId, 0, 0, [], [], 0);
  if (out.length > MAX_OBJECTS) throw new Error(`scene '${sceneId}' flattens to ${out.length} slots (max ${MAX_OBJECTS})`);
  return out;
}

export interface Voice {
  /** MIDI note 0–107 (Uxn pitch bytes). */
  note: number;
  /** 0 = silent. */
  vol: number;
}

/** A named one-shot sound: up to 4 voices, index = Audio device
    (same convention as the boot mix). Triggered by play blocks;
    polyphony is the Uxn hardware (last write wins per device). */
export interface SoundDef {
  id: string;
  voices: Voice[];
}

export interface Project {
  id: string;
  /** visual: scenes lowered by the emitter. code: hand-written files. */
  kind: "visual" | "code";
  /** Locked examples render every editor read-only. */
  locked?: boolean;
  name: string;
  author: string;
  width: number;
  height: number;
  /** System palette theme (12-bit channels). Defaults to the demo theme. */
  theme?: { r: number; g: number; b: number };
  start: string;
  scenes: Scene[];
  /** Named keyboard inputs (Phase 0: press-a-key picker + migration). */
  inputs: NamedInput[];
  /** Shared sprite library (1×1 up to 4×4 tiles of 8×8 2bpp). */
  sprites: Sprite[];
  /** Object template library (Phase 1: the GameMaker Object). Absent
      = pre-def project; leaves then inline everything as before. */
  objectDefs?: ObjectDef[];
  /** Frame collections over sprite ids. */
  anims: Animation[];
  /** Up to 4 voices, played once on boot. Absent = silent. */
  sound?: { voices: Voice[] };
  /** Named one-shot SFX library (Phase 3). Absent = none yet. */
  sounds?: SoundDef[];
  /** Visual only: raw top-level ETAL spliced into main.ux. May define
      custom_setup() and/or custom_frame() hooks (called when present). */
  customCode?: string;
  /** Code only: the file set, passed through untouched. */
  codeFiles?: Record<string, string>;
  /** Code only: entry file (default main.ux). */
  entry?: string;
  updatedAt: number;
}

/** Generated identifiers custom code must not redeclare. Only actual
    top-level declarations are inspected — *uses* like ox[slot] inside
    tick bodies are the whole point and always pass. The backend
    compiler remains the final arbiter (duplicates fail loudly). */
const RESERVED_EXACT = new Set([
  "ox", "oy", "ot", "oflags", "ocount", "scene", "kb", "mb", "mouse_last",
  "dpad", "draw_all", "pt_in_rect", "overlap88", "scene_go", "start", "main", "sq32",
  "custom_setup", "custom_frame",
]);
const RESERVED_PREFIX = ["atick_", "afr_", "adir_", "spr_", "tick_"];

function declaredNames(code: string): string[] {
  const names: string[] = [];
  for (const raw of code.split("\n")) {
    const line = raw.split("( ")[0];
    // Keyword declarations first: the generic pattern would otherwise
    // match the keyword itself (`buffer ox` → "buffer", missing ox).
    let m = line.match(/^\s*(?:buffer|data|device|group|struct|macro|import|meta)\s+([A-Za-z][A-Za-z0-9_]*)/);
    if (m) {
      names.push(m[1]);
      continue;
    }
    m = line.match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*:/);
    if (m) names.push(m[1]);
  }
  return names;
}

export function validateCustomCode(code: string): string[] {
  const errs: string[] = [];
  if (code.length > 32 * 1024) errs.push("custom code exceeds 32KB");
  for (const name of declaredNames(code)) {
    if (name === "custom_setup" || name === "custom_frame") continue;
    if (
      RESERVED_EXACT.has(name) ||
      name.startsWith("SC_") ||
      RESERVED_PREFIX.some((p) => name.startsWith(p)) ||
      name.endsWith("_frame")
    ) {
      errs.push(`custom code collides with generated name '${name}'`);
    }
  }
  return errs;
}

export const MAX_OBJECTS = 128;
const IDENT = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Upgrade a pre-library project: inline 1bpp tiles become sprites. */
export function migrateProject(raw: Record<string, unknown>): Project {
  const p = { ...(raw as object) } as Record<string, unknown>;
  if (Array.isArray(p["sprites"]) && Array.isArray(p["anims"])) {
    const base = {
      kind: "visual",
      sound: { voices: [] },
      updatedAt: 0,
      ...(p as object),
    } as unknown as Record<string, unknown>;
    // objects: → nodes: rename from the flat era (kind filled in).
    base["scenes"] = ((base["scenes"] ?? []) as Array<Record<string, unknown>>).map((s) => {
      if (Array.isArray(s["objects"]) && !Array.isArray(s["nodes"])) {
        const nodes = (s["objects"] as Array<Record<string, unknown>>).map((o) => ({
          kind: "static",
          ...(o as object),
        }));
        const { objects: _drop, ...rest } = s;
        void _drop;
        return { ...rest, nodes };
      }
      return s;
    });
    const modernScenes = (base["scenes"] ?? []) as Scene[];
    base["inputs"] = migrateInputs(modernScenes, base["inputs"]);
    const modernDefs = (base["objectDefs"] ?? []) as ObjectDef[];
    base["sounds"] = migrateSounds(modernScenes, modernDefs, base["sounds"]);
    return base as unknown as Project;
  }
  const sprites: Sprite[] = [];
  const scenes = ((p["scenes"] ?? []) as Array<Record<string, unknown>>).map((s) => {
    const sid = String(s["id"] ?? "scene");
    const nodes = ((s["objects"] ?? s["nodes"] ?? []) as Array<Record<string, unknown>>).map((o) => {
      const oid = String(o["id"] ?? "obj");
      const tile = o["tile"];
      const pixels =
        Array.isArray(tile) && tile.length === 8
          ? monoToPixels((tile as unknown[]).map((b) => Number(b)))
          : Array<number>(64).fill(1);
      const spriteId = `${sid}_${oid}`.replace(/[^A-Za-z0-9_]/g, "_");
      if (!o["sprite"] && !o["scene"] && !sprites.some((x) => x.id === spriteId))
        sprites.push({ id: spriteId, pixels });
      const next = { ...(o as object) } as Record<string, unknown>;
      delete next["tile"];
      const wasMovable = next["movable"] === true;
      const wasPlayer = next["player"] === true;
      delete next["movable"];
      delete next["player"];
      if (!next["kind"]) next["kind"] = wasMovable ? "movable" : wasPlayer ? "player" : "static";
      if (wasMovable) next["solid"] = true;
      if (!next["sprite"] && !next["scene"]) next["sprite"] = spriteId;
      return next as unknown as SceneNode;
    });
    const nextScene = { ...(s as object) } as Record<string, unknown>;
    delete nextScene["objects"];
    return { ...nextScene, nodes } as Scene;
  });
  return {
    id: typeof p["id"] === "string" ? (p["id"] as string) : "demo",
    kind: "visual",
    name: typeof p["name"] === "string" ? (p["name"] as string) : "Migrated",
    author: typeof p["author"] === "string" ? (p["author"] as string) : "uxn-forge",
    width: typeof p["width"] === "number" ? (p["width"] as number) : 128,
    height: typeof p["height"] === "number" ? (p["height"] as number) : 128,
    start: typeof p["start"] === "string" ? (p["start"] as string) : (scenes[0]?.id ?? "main"),
    scenes,
    inputs: migrateInputs(scenes, p["inputs"]),
    sprites,
    anims: [],
    sound: (p["sound"] as Project["sound"]) ?? { voices: [] },
    updatedAt: 0,
  };
}

/** Phase 0 migration: every raw-code key binding gets a named input
    (`key_<code>`, shared per code), so the UI can store input ids
    while old projects keep byte-identical behavior. Deterministic:
    scenes in order, codes in encounter order. */
/** Phase 3 migration: literal play blocks `{voice, note, vol}` become
    named sounds, so the block has one form going forward. Same
    (voice, note, vol) shares one synthesized sound
    (`sfx_<voice>_<note>_<vol>`); behavior is byte-identical, only the
    spelling changes. Deterministic: defs, then scenes in order. */
function migrateSounds(scenes: Scene[], defs: ObjectDef[], existing: unknown): SoundDef[] {
  const sounds: SoundDef[] = Array.isArray(existing)
    ? (existing as SoundDef[]).filter((s) => s && typeof s.id === "string" && Array.isArray(s.voices))
    : [];
  const byContent = new Map<string, SoundDef>();
  for (const s of sounds) {
    if (s.voices.length !== 4) continue;
    const live = s.voices.map((v, i) => ({ ...v, i })).filter((v) => v.vol > 0);
    if (live.length !== 1) continue;
    const key = `${live[0].i}_${live[0].note}_${live[0].vol}`;
    if (!byContent.has(key)) byContent.set(key, s);
  }
  const convert = (blocks: Block[] | undefined): void => {
    if (!Array.isArray(blocks)) return;
    blocks.forEach((b, i) => {
      const raw = b as unknown as Record<string, unknown>;
      if (raw["op"] !== "play" || typeof raw["sound"] === "string") return;
      const voice = Number.isInteger(raw["voice"]) ? (raw["voice"] as number) : 0;
      const note = Number.isInteger(raw["note"]) ? (raw["note"] as number) : 60;
      const vol = Number.isInteger(raw["vol"]) ? (raw["vol"] as number) : 120;
      const key = `${voice}_${note}_${vol}`;
      let found = byContent.get(key);
      if (!found) {
        let id = `sfx_${key}`;
        let n = 2;
        while (sounds.some((s) => s.id === id)) id = `sfx_${key}_${n++}`;
        const voices = [0, 1, 2, 3].map((vi) => (vi === voice ? { note, vol } : { note: 0, vol: 0 }));
        found = { id, voices };
        sounds.push(found);
        byContent.set(key, found);
      }
      blocks[i] = { op: "play", sound: found.id };
    });
  };
  for (const d of defs) for (const e of d.events ?? []) convert(e.blocks);
  for (const s of scenes) for (const o of s.nodes) {
    if (!o.scene) for (const e of o.events ?? []) convert(e.blocks);
  }
  return sounds;
}

function migrateInputs(scenes: Scene[], existing: unknown): NamedInput[] {
  const inputs: NamedInput[] = Array.isArray(existing)
    ? (existing as NamedInput[]).filter((i) => i && typeof i.id === "string" && Number.isInteger(i.key))
    : [];
  const byKey = new Map<number, NamedInput>();
  for (const i of inputs) if (!byKey.has(i.key)) byKey.set(i.key, i);
  for (const s of scenes) {
    for (const k of s.keys ?? []) {
      if (k.input) continue;
      let found = byKey.get(k.key);
      if (!found) {
        const id = `key_${k.key}`;
        found = inputs.some((i) => i.id === id)
          ? { id: `${id}_${inputs.length}`, key: k.key }
          : { id, key: k.key };
        inputs.push(found);
        byKey.set(k.key, found);
      }
      k.input = found.id;
    }
  }
  return inputs;
}

function u16(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 65535;
}

/** A hitbox is pixel offsets inside its sprite: non-negative origin,
    positive size, fully contained. Integers only (ports take ints). */
function maskFits(m: HitBox, dims: [number, number]): boolean {
  const [w, h] = dims;
  for (const v of [m.x, m.y, m.w, m.h]) if (!Number.isInteger(v)) return false;
  return m.x >= 0 && m.y >= 0 && m.w >= 1 && m.h >= 1 && m.x + m.w <= w && m.y + m.h <= h;
}

/** Max static collide pairs per scene (see the pair counting below).
    Keeps generated frame fns far under the assembler reference
    budget (~1200) no matter how the statements stack. */
export const MAX_COLLIDE_PAIRS = 48;

const TRIGGERS: EventTrigger[] = ["create", "step", "destroy", "key", "collide", "click", "alarm"];

function validateBlocks(blocks: Block[], label: string, sceneIds: Set<string>, soundIds: Set<string>): string[] {
  const errs: string[] = [];
  (blocks ?? []).forEach((b, i) => {
    const at = `${label} block ${i}`;
    if (b.op === "move") {
      if (!Number.isInteger(b.dx) || !Number.isInteger(b.dy)) errs.push(`${at}: dx/dy must be integers`);
    } else if (b.op === "set_pos") {
      if (!u16(b.x) || !u16(b.y)) errs.push(`${at}: x/y must be 0–65535`);
    } else if (b.op === "play") {
      if (typeof b.sound !== "string" || !soundIds.has(b.sound))
        errs.push(`${at}: play needs a known sound`);
    } else if (b.op === "goto") {
      if (!sceneIds.has(b.scene)) errs.push(`${at}: goto unknown scene '${b.scene}'`);
    } else if (b.op === "destroy") {
      void b;
    } else if (b.op === "wait") {
      if (!Number.isInteger(b.ticks) || b.ticks < 1 || b.ticks > 255)
        errs.push(`${at}: ticks must be 1–255`);
    } else {
      errs.push(`${label} block ${i}: unknown op '${(b as { op: unknown }).op}'`);
    }
  });
  return errs;
}

function validTarget(target: string, defIds: Set<string>): boolean {
  if (target === "any" || target === "solid" || target === "player" || target === "movable") return true;
  return target.startsWith("def:") && defIds.has(target.slice(4));
}

function validateEvents(
  events: ObjectEvent[],
  label: string,
  sceneIds: Set<string>,
  inputIds: Set<string>,
  defIds: Set<string>,
  soundIds: Set<string>,
): string[] {
  const errs: string[] = [];
  const ids = new Set((events ?? []).map((e) => e.id));
  if (ids.size !== (events ?? []).length) errs.push(`${label}: duplicate event id`);
  const seen = new Set<string>();
  for (const e of events ?? []) {
    if (!IDENT.test(e.id)) errs.push(`${label}: bad event id '${e.id}'`);
    if (!TRIGGERS.includes(e.trigger)) errs.push(`${label} '${e.id}': bad trigger '${(e as { trigger: unknown }).trigger}'`);
    if (e.trigger === "key" && (e.key === undefined || !inputIds.has(e.key)))
      errs.push(`${label} '${e.id}': key event needs a known input`);
    if (e.trigger === "collide" && (e.target === undefined || !validTarget(e.target, defIds)))
      errs.push(`${label} '${e.id}': collide target must be any|solid|player|movable|def:<id>`);
    const sig = `${e.trigger}|${e.key ?? ""}|${e.target ?? ""}`;
    if (seen.has(sig)) errs.push(`${label}: duplicate ${e.trigger} event`);
    seen.add(sig);
    errs.push(...validateBlocks(e.blocks ?? [], `${label} '${e.id}'`, sceneIds, soundIds));
  }
  return errs;
}

export interface SceneMapEdge {
  from: string;
  to: string;
  label: string;
}
export interface SceneMapNode {
  id: string;
  /** Flattened leaf count, -1 when the chain is broken mid-edit. */
  leaves: number;
  broken: boolean;
  /** BFS depth from the start scene (-1 = unreachable). Drives columns. */
  depth: number;
}
export interface SceneMap {
  nodes: SceneMapNode[];
  edges: SceneMapEdge[];
}

/** Scene overview data: every scene as a node, every transition as a
    labeled edge — bindings AND goto blocks in leaf events (defs
    included, via resolved flat leaves). Broken scenes still list
    (with their bindings, no event edges); unknown gotos are skipped.
    Nodes come out BFS-ordered from the start scene. Pure: the map
    canvas renders this without touching the store. */
export function buildSceneMap(p: Project): SceneMap {
  const sceneIds = new Set(p.scenes.map((s) => s.id));
  const nodes: SceneMapNode[] = p.scenes.map((s) => {
    let leaves = -1;
    try {
      leaves = flattenScene(p, s.id).length;
    } catch {
      leaves = -1;
    }
    return { id: s.id, leaves, broken: leaves < 0, depth: -1 };
  });
  const edges: SceneMapEdge[] = [];
  const seen = new Set<string>();
  const push = (from: string, to: string, label: string): void => {
    if (!sceneIds.has(to)) return;
    const key = `${from}→${to}|${label}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to, label });
  };
  for (const s of p.scenes) {
    for (const c of s.clicks) push(s.id, c.goto, `click ${c.object}`);
    for (const k of s.keys) push(s.id, k.goto, `key ${k.input ?? k.key}`);
    let flat: FlatLeaf[];
    try {
      flat = flattenScene(p, s.id);
    } catch {
      continue;
    }
    for (const o of flat) {
      for (const e of o.events) {
        for (const b of e.blocks) {
          if (b.op !== "goto") continue;
          push(s.id, b.scene, `${e.trigger} ${o.def ?? o.id}`);
        }
      }
    }
  }
  // BFS depths from the start scene for column layout.
  const depth = new Map<string, number>([[p.start, 0]]);
  const queue = [p.start];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    const d = depth.get(cur) as number;
    for (const e of edges) {
      if (e.from !== cur || depth.has(e.to)) continue;
      depth.set(e.to, d + 1);
      queue.push(e.to);
    }
  }
  for (const n of nodes) n.depth = depth.get(n.id) ?? -1;
  const rank = new Map(nodes.map((n, i) => [n.id, i]));
  nodes.sort((a, b) => (a.depth < 0 ? 1e9 : a.depth) - (b.depth < 0 ? 1e9 : b.depth) || (rank.get(a.id) as number) - (rank.get(b.id) as number));
  return { nodes, edges };
}

/** Masked rect args for overlap/click sites: the full sprite rect by
    default, mask offsets when set. Drive deliberately keeps full
    bounds (generous world, precise hitbox — see the plan). Zero
    offsets collapse so output stays identical for unmasked leaves. */
function hitArgs(
  xBase: string,
  yBase: string,
  wBase: string | number,
  hBase: string | number,
  mask: HitBox | undefined,
): [string, string, string | number, string | number] {
  if (!mask) return [xBase, yBase, wBase, hBase];
  const x = mask.x === 0 ? xBase : `${xBase} + ${mask.x}`;
  const y = mask.y === 0 ? yBase : `${yBase} + ${mask.y}`;
  return [x, y, mask.w, mask.h];
}

/** Static collide matching: kinds and def identity are all known at
    emit time (leaves carry resolved kind + raw def ref), so pairs
    unroll without any runtime tags. */
export function matchTarget(t: FlatLeaf, index: number, self: number, target: string): boolean {
  if (index === self) return false;
  if (target === "any") return true;
  if (target === "solid") return !!t.solid;
  if (target === "player" || target === "movable") return t.kind === target;
  return target.startsWith("def:") && t.def === target.slice(4);
}

export function validateProject(p: Project): string[] {
  const errs: string[] = [];
  if (!p.name || /["\\]/.test(p.name)) errs.push("name must be non-empty without quotes/backslashes");
  if (!p.author || /["\\]/.test(p.author)) errs.push("author must be non-empty without quotes/backslashes");
  if (p.kind !== "visual" && p.kind !== "code") errs.push(`bad kind '${(p as { kind: unknown }).kind}'`);
  if (!IDENT.test(p.id)) errs.push(`bad project id '${p.id}'`);
  const theme = p.theme ?? { r: THEME_R, g: THEME_G, b: THEME_B };
  for (const [ch, v] of [["r", theme.r], ["g", theme.g], ["b", theme.b]] as const) {
    if (!Number.isInteger(v) || v < 0 || v > 65535) errs.push(`theme.${ch} must be 0–65535`);
  }
  if (p.kind === "code") {
    const files = p.codeFiles ?? {};
    const entry = p.entry ?? "main.ux";
    if (!files[entry]) errs.push(`entry '${entry}' missing from code files`);
    for (const path of Object.keys(files)) {
      if (path.startsWith("/") || path.split("/").includes(".."))
        errs.push(`code file '${path}': relative paths only, no '..'`);
    }
    return errs;
  }
  if (p.customCode) errs.push(...validateCustomCode(p.customCode));
  if (!u16(p.width) || !u16(p.height) || p.width === 0 || p.height === 0)
    errs.push("width/height must be 1–65535");
  const sceneIds = new Set(p.scenes.map((s) => s.id));
  const spriteIds = new Set(p.sprites.map((s) => s.id));
  if (spriteIds.size !== p.sprites.length) errs.push("duplicate sprite id");
  const spriteDims = new Map<string, [number, number]>();
  for (const s of p.sprites) {
    if (!IDENT.test(s.id)) errs.push(`bad sprite id '${s.id}'`);
    const w = s.w ?? 1;
    const h = s.h ?? 1;
    if (!Number.isInteger(w) || w < 1 || w > MAX_SPRITE_TILES)
      errs.push(`sprite '${s.id}': width must be 1–${MAX_SPRITE_TILES} tiles`);
    if (!Number.isInteger(h) || h < 1 || h > MAX_SPRITE_TILES)
      errs.push(`sprite '${s.id}': height must be 1–${MAX_SPRITE_TILES} tiles`);
    spriteDims.set(s.id, [w, h]);
    if (s.pixels.length !== 64 * w * h || s.pixels.some((v) => v !== 0 && v !== 1 && v !== 2 && v !== 3))
      errs.push(`sprite '${s.id}': needs ${64 * w * h} pixels of 0–3`);
  }
  const inputIds = new Set((p.inputs ?? []).map((i) => i.id));
  if (inputIds.size !== (p.inputs ?? []).length) errs.push("duplicate input id");
  for (const i of p.inputs ?? []) {
    if (!IDENT.test(i.id)) errs.push(`bad input id '${i.id}'`);
    if (!Number.isInteger(i.key) || i.key < 0 || i.key > 255) errs.push(`input '${i.id}': key must be 0–255`);
  }
  const animIds = new Set(p.anims.map((a) => a.id));
  if (animIds.size !== p.anims.length) errs.push("duplicate animation id");
  const animDims = new Map<string, [number, number]>();
  for (const a of p.anims) {
    if (!IDENT.test(a.id)) errs.push(`bad animation id '${a.id}'`);
    if (a.frames.length === 0 || a.frames.length > 16) errs.push(`animation '${a.id}': 1–16 frames`);
    for (const f of a.frames) if (!spriteIds.has(f)) errs.push(`animation '${a.id}': unknown sprite '${f}'`);
    if (!Number.isInteger(a.rate) || a.rate < 1 || a.rate > 255)
      errs.push(`animation '${a.id}': rate must be 1–255`);
    if (a.pingpong && (!a.loop || a.frames.length < 2))
      errs.push(`animation '${a.id}': pingpong needs loop and 2+ frames`);
    // Frames swap the whole sprite address at runtime, so mixed-size
    // frames would shear: every frame shares the first frame's tiles.
    const first = spriteDims.get(a.frames[0] ?? "");
    if (first) {
      animDims.set(a.id, first);
      for (const f of a.frames.slice(1)) {
        const d = spriteDims.get(f);
        if (d && (d[0] !== first[0] || d[1] !== first[1]))
          errs.push(`animation '${a.id}': frame '${f}' must match ${first[0]}×${first[1]} tiles`);
      }
    }
  }
  const sounds = p.sounds ?? [];
  const soundIds = new Set(sounds.map((s) => s.id));
  if (soundIds.size !== sounds.length) errs.push("duplicate sound id");
  for (const s of sounds) {
    if (!IDENT.test(s.id)) errs.push(`bad sound id '${s.id}'`);
    if (s.voices.length > 4) errs.push(`sound '${s.id}': at most 4 voices (Uxn limit)`);
    s.voices.forEach((v, i) => {
      if (!Number.isInteger(v.note) || v.note < 0 || v.note > 107)
        errs.push(`sound '${s.id}' voice ${i}: note must be 0–107`);
      if (!Number.isInteger(v.vol) || v.vol < 0 || v.vol > 255)
        errs.push(`sound '${s.id}' voice ${i}: vol must be 0–255`);
    });
    // A silent sound lowers to zero lines: the event fn would be
    // skipped while dispatch still calls it (assembly failure on a
    // VALID project). Reject the hole instead of working around it.
    if (s.voices.every((v) => v.vol === 0)) errs.push(`sound '${s.id}' is silent (all voices vol 0)`);
  }
  const defs = projectDefs(p);
  const defIds = new Set(defs.map((d) => d.id));
  if (defIds.size !== defs.length) errs.push("duplicate object id");
  for (const d of defs) {
    if (!IDENT.test(d.id)) errs.push(`bad object id '${d.id}'`);
    if (!spriteIds.has(d.sprite)) errs.push(`object '${d.id}': unknown sprite '${d.sprite}'`);
    if (d.kind !== "player" && d.kind !== "static" && d.kind !== "movable")
      errs.push(`object '${d.id}': bad kind '${(d as { kind: unknown }).kind}'`);
    if (d.kind === "movable" && !d.solid) errs.push(`object '${d.id}': movable requires solid`);
    if (d.controls && d.kind !== "player") errs.push(`object '${d.id}': controls require player kind`);
    if (d.anim && !animIds.has(d.anim)) errs.push(`object '${d.id}': unknown animation '${d.anim}'`);
    if (d.tick) errs.push(...validateCustomCode(d.tick).map((e) => `object '${d.id}' tick: ${e}`));
    if (d.mask) {
      const tiles = spriteDims.get(d.sprite);
      const dims: [number, number] | undefined = tiles && [tiles[0] * TILE_PX, tiles[1] * TILE_PX];
      if (dims && !maskFits(d.mask, dims))
        errs.push(`object '${d.id}': mask must fit inside its ${dims[0]}×${dims[1]}px sprite`);
    }
    errs.push(...validateEvents(d.events ?? [], `object '${d.id}'`, sceneIds, inputIds, defIds, soundIds));
  }
  if (sceneIds.size !== p.scenes.length) errs.push("duplicate scene id");
  if (!sceneIds.has(p.start)) errs.push(`start scene '${p.start}' missing`);
  if (!IDENT.test(p.id)) errs.push(`bad project id '${p.id}'`);
  const voices = p.sound?.voices ?? [];
  if (voices.length > 4) errs.push("at most 4 voices (Uxn limit)");
  voices.forEach((v, i) => {
    if (!Number.isInteger(v.note) || v.note < 0 || v.note > 107)
      errs.push(`voice ${i}: note must be 0–107`);
    if (!Number.isInteger(v.vol) || v.vol < 0 || v.vol > 255)
      errs.push(`voice ${i}: vol must be 0–255`);
  });
  for (const s of p.scenes) {
    if (!IDENT.test(s.id)) errs.push(`bad scene id '${s.id}'`);
    if (s.nodes.length > MAX_OBJECTS) errs.push(`scene '${s.id}' has >${MAX_OBJECTS} nodes`);
    const nodeIds = new Set(s.nodes.map((o) => o.id));
    if (nodeIds.size !== s.nodes.length) errs.push(`scene '${s.id}': duplicate node id`);
    for (const o of s.nodes) {
      if (!IDENT.test(o.id)) errs.push(`bad node id '${o.id}'`);
      if (!u16(o.x) || !u16(o.y)) errs.push(`node '${o.id}': x/y must be 0–65535`);
      const isBranch = !!o.scene;
      if (isBranch && !o.sprite && !sceneIds.has(o.scene as string))
        errs.push(`node '${o.id}': unknown subscene '${o.scene}'`);
      if (isBranch && o.sprite) errs.push(`node '${o.id}': sprite and subscene are exclusive`);
      if (isBranch && o.def) errs.push(`node '${o.id}': objects are leaves only, not branches`);
      if (isBranch && o.events?.length) errs.push(`node '${o.id}': events are leaves only, not branches`);
      if (!isBranch && o.def && (o.events?.length ?? 0) > 0)
        errs.push(`node '${o.id}': instances carry no events — edit object '${o.def}'`);
      if (!isBranch && !o.def)
        errs.push(...validateEvents(o.events ?? [], `node '${o.id}'`, sceneIds, inputIds, defIds, soundIds));
      if (!isBranch && !o.sprite && !o.def) errs.push(`node '${o.id}': leaf needs a sprite or an object`);
      if (!isBranch) {
        if (o.sprite && !spriteIds.has(o.sprite)) errs.push(`node '${o.id}': unknown sprite '${o.sprite}'`);
        if (o.def && !defIds.has(o.def)) errs.push(`node '${o.id}': unknown object '${o.def}'`);
        if (o.anim && !animIds.has(o.anim)) errs.push(`node '${o.id}': unknown animation '${o.anim}'`);
      }
      if (o.tick) errs.push(...validateCustomCode(o.tick).map((e) => `node '${o.id}' tick: ${e}`));
      if (o.initCode)
        errs.push(...validateCustomCode(o.initCode).map((e) => `node '${o.id}' creation code: ${e}`));
      if (o.kind !== undefined && o.kind !== "player" && o.kind !== "static" && o.kind !== "movable")
        errs.push(`node '${o.id}': bad kind '${(o as { kind: unknown }).kind}'`);
    }
    // Flattened view: defs resolved, so physics rules, size matches
    // and caps all check effective values (a def can supply any of
    // them). Paths pinpoint nested leaves.
    try {
      const flat = flattenScene(p, s.id);
      const players = flat.filter((o) => o.kind === "player");
      if (players.length > 1) errs.push(`scene '${s.id}': at most one player (0 allowed)`);
      const drivers = flat.filter((o) => o.controls);
      if (drivers.length > 1) errs.push(`scene '${s.id}': at most one keyboard driver`);
      let pairs = 0;
      for (const o of flat) {
        if (o.kind === "movable" && !o.solid)
          errs.push(`scene '${s.id}': '${o.path}' movable requires solid`);
        if (o.controls && o.kind !== "player")
          errs.push(`scene '${s.id}': '${o.path}' controls require player kind`);
        if (o.mask) {
          const tiles = spriteDims.get(o.sprite);
          const dims: [number, number] | undefined = tiles && [tiles[0] * TILE_PX, tiles[1] * TILE_PX];
          if (dims && !maskFits(o.mask, dims))
            errs.push(`scene '${s.id}': '${o.path}' mask must fit inside its ${dims[0]}×${dims[1]}px sprite`);
        }
        const hasWait = o.events.some((e) => e.blocks.some((b) => b.op === "wait"));
        const hasAlarm = o.events.some((e) => e.trigger === "alarm" && e.blocks.length > 0);
        if (hasWait && !hasAlarm)
          errs.push(`scene '${s.id}': '${o.path}' waits with no alarm event to fire`);
        for (const e of o.events) {
          if (e.trigger !== "collide" || e.blocks.length === 0) continue;
          const hits = flat.filter((t, j) => matchTarget(t, j, flat.indexOf(o), e.target ?? ""));
          if (hits.length === 0)
            errs.push(`scene '${s.id}': '${o.path}' collide '${e.target}' matches nothing`);
          pairs += hits.length;
        }
        if (!spriteIds.has(o.sprite))
          errs.push(`scene '${s.id}': '${o.path}' unknown sprite '${o.sprite}'`);
        if (o.anim && !animIds.has(o.anim))
          errs.push(`scene '${s.id}': '${o.path}' unknown animation '${o.anim}'`);
        // The emitter draws with the leaf sprite's tile width; an
        // animation of other-sized frames would tear at the seams.
        if (o.anim && o.sprite) {
          const leaf = spriteDims.get(o.sprite);
          const frames = animDims.get(o.anim);
          if (leaf && frames && (leaf[0] !== frames[0] || leaf[1] !== frames[1]))
            errs.push(`scene '${s.id}': '${o.path}' sprite must match animation '${o.anim}' size`);
        }
      }
      if (pairs > MAX_COLLIDE_PAIRS)
        errs.push(
          `scene '${s.id}': ${pairs} collide pairs (max ${MAX_COLLIDE_PAIRS}) — narrow targets or split the scene`,
        );
      const paths = new Set(flat.map((o) => o.path));
      for (const c of s.clicks) {
        if (!paths.has(c.object)) errs.push(`scene '${s.id}': click on unknown node '${c.object}'`);
        if (!sceneIds.has(c.goto)) errs.push(`scene '${s.id}': goto unknown scene '${c.goto}'`);
      }
    } catch (e) {
      errs.push(`scene '${s.id}': ${(e as Error).message}`);
    }
    for (const k of s.keys) {
      if (!Number.isInteger(k.key) || k.key < 0 || k.key > 255)
        errs.push(`scene '${s.id}': key must be 0–255`);
      if (k.input !== undefined && !inputIds.has(k.input))
        errs.push(`scene '${s.id}': key binding on unknown input '${k.input}'`);
      if (!sceneIds.has(k.goto)) errs.push(`scene '${s.id}': key goto unknown scene '${k.goto}'`);
    }
    if (s.frameCode) errs.push(...validateCustomCode(s.frameCode).map((e) => `scene '${s.id}' code: ${e}`));
  }
  return errs;
}

const DEVICES = `( generated devices: System + Screen + Controller + Mouse. )
device System 0 {
    vector: 2
    expansion: 2
    wst: 1
    rst: 1
    metadata: 2
    r: 2
    g: 2
    b: 2
    debug: 1
    state: 1
}
device Screen 32 {
    vector: 2
    width: 2
    height: 2
    auto: 1
    pad: 1
    x: 2
    y: 2
    addr: 2
    pixel: 1
    sprite: 1
}
device Controller 128 {
    vector: 2
    button: 1
    key: 1
}
device Mouse 144 {
    vector: 2
    x: 2
    y: 2
    state: 1
    pad: 3
    scrollx: 2
    scrolly: 2
}
`;

function audioBlock(name: string, page: number): string {
  return `device ${name} ${page} {
    vector: 2
    position: 2
    output: 1
    pad: 3
    adsr: 2
    length: 2
    addr: 2
    volume: 1
    pitch: 1
}
`;
}

const SQ32 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255];

function emitDevices(p: Project): string {
  let s = DEVICES;
  usedVoices(p).forEach((v) => {
    s += audioBlock(`Audio${v}`, 48 + v * 16);
  });
  return s;
}

/** Voice indices with vol > 0 (max 4, validated), plus every voice
    a play block names: one-shot SFX reuse the boot sample. Runs after
    validation, so flattening never throws here. */
function usedVoices(p: Project): number[] {
  const out = new Set<number>();
  (p.sound?.voices ?? []).forEach((v, i) => {
    if (i < 4 && v.vol > 0) out.add(i);
  });
  const snds = soundMap(p);
  for (const s of p.scenes) {
    for (const o of flattenScene(p, s.id)) {
      for (const e of o.events) {
        for (const b of e.blocks) {
          if (b.op !== "play") continue;
          snds.get(b.sound)?.voices.forEach((v, i) => {
            if (i < 4 && v.vol > 0) out.add(i);
          });
        }
      }
    }
  }
  return [...out].sort((a, b) => a - b);
}

function flagsOf(o: SceneObject): number {
  // bit0 present, bit1 solid, bit2 movable, bit3 alive (destroy clears
  // it; draw/drive/collide/handlers all honor it — see Phase 2).
  return 1 | (o.solid ? 2 : 0) | (o.kind === "movable" ? 4 : 0) | 8;
}

/** Per-slot generated prefix: root scene + sanitized instance path. */
function slotTag(rootId: string, path: string): string {
  return `${rootId}_${path.replace(/\//g, "_")}`;
}

function emitSetup(
  rootId: string,
  leaves: FlatLeaf[],
  dims: Map<string, [number, number]>,
  withDims: boolean,
  withAlarm: boolean,
): string {
  const lines = [`setup_${rootId} :: fn() {`];
  for (let i = 0; i < leaves.length; i++) {
    const o = leaves[i];
    let line = `    ox[${i}] = ${o.x}; oy[${i}] = ${o.y}; ot[${i}] = &spr_${o.sprite}; oflags[${i}] = ${flagsOf(o)};`;
    // Dims ride along for every leaf when anything reads them: move
    // clamps and overlap address arbitrary (often non-solid) slots,
    // so the solid-only shortcut from Phase 0 had to go. Uniform
    // lines keep setup fns around 7 refs/leaf — under the assembler
    // budget (~1200) with room to spare at realistic scene sizes.
    if (withDims) {
      const [pw, ph] = dims.get(o.sprite) ?? [TILE_PX, TILE_PX];
      line += ` ow[${i}] = ${pw}; oh[${i}] = ${ph};`;
    }
    if (withAlarm && o.events.some((e) => e.trigger === "alarm" && e.blocks.length > 0))
      line += ` oat[${i}] = 0;`;
    lines.push(line);
  }
  for (let i = 0; i < leaves.length; i++) {
    const o = leaves[i];
    // Create fn runs when it has blocks OR instance code (both run
    // on scene enter, blocks first) — same condition as emission.
    if (o.events.some((e) => e.trigger === "create" && e.blocks.length > 0) || o.initCode)
      lines.push(`    create_${slotTag(rootId, o.path)}(${i});`);
  }
  lines.push(`    ocount = ${leaves.length};`);
  lines.push(`}`);
  return lines.join("\n") + "\n";
}

/** Per-scene draw: one straight-line tile write per 8×8 tile
    (Screen.sprite = 129 each), row-major, tile (tx, ty) at
    addr + (ty*w + tx)*16. Literals everywhere — no new ETAL
    features, no auto-port dependency, identical bytes for 1×1
    sprites. Animation frames share the leaf's tile width
    (validated), so ot swaps stay aligned.
    dims maps sprite id → [tiles wide, tiles tall] (NOT pixels). */
function emitDrawScene(s: Scene, leaves: FlatLeaf[], dims: Map<string, [number, number]>): string {
  const lines = [`draw_${s.id} :: fn() {`];
  leaves.forEach((o, i) => {
    const [tw, th] = dims.get(o.sprite) ?? [1, 1];
    const px = (v: number): string => (v === 0 ? "" : ` + ${v}`);
    // Destroyed leaves go quiet (alive bit); the guard costs one
    // reference per leaf — nothing next to the tile writes.
    lines.push(`    if oflags[${i}] & 8 != 0 {`);
    for (let ty = 0; ty < th; ty++) {
      for (let tx = 0; tx < tw; tx++) {
        const off = (ty * tw + tx) * 16;
        lines.push(`        Screen.x = ox[${i}]${px(tx * TILE_PX)};`);
        lines.push(`        Screen.y = oy[${i}]${px(ty * TILE_PX)};`);
        lines.push(`        Screen.addr = ot[${i}]${px(off)};`);
        lines.push(`        Screen.sprite = 129;`);
      }
    }
    lines.push(`    }`);
  });
  lines.push(`}`);
  return lines.join("\n") + "\n";
}

export interface BlockCtx {
  /** Slot variable (`slot`) or literal index. */
  slot: string;
  /** Canvas size for move clamps. */
  w: number;
  h: number;
  /** Destroy-event fn to call first, when the leaf has one. */
  destroyFn?: string;
  /** Named sounds for play blocks (unknown id previews as a comment;
      emit never sees one — validation throws first). */
  sounds: Map<string, SoundDef>;
}

/** Named sounds by id (unknown ids are a validation error; the
    preview degrades to a comment line instead of throwing). */
export function soundMap(p: Project): Map<string, SoundDef> {
  return new Map((p.sounds ?? []).map((s) => [s.id, s]));
}

/** One block = fixed ETAL lines. THE lowering: the UI live preview
    and the emitter both call this, so what you see is what assembles.
    Move clamps read ow/oh (emitted whenever blocks need them); every
    other op is literals. No locals, no globals — leaf fns stay
    dependency-free and far under the assembler reference budget. */
export function previewBlocks(blocks: Block[], ctx: BlockCtx): string[] {
  const { slot, w, h } = ctx;
  const lines: string[] = [];
  for (const b of blocks) {
    if (b.op === "move") {
      if (b.dx > 0) lines.push(`if ox[${slot}] + ow[${slot}] < ${w + 1} { ox[${slot}] = ox[${slot}] + ${b.dx}; }`);
      else if (b.dx < 0) lines.push(`if ox[${slot}] >= ${-b.dx} { ox[${slot}] = ox[${slot}] - ${-b.dx}; }`);
      if (b.dy > 0) lines.push(`if oy[${slot}] + oh[${slot}] < ${h + 1} { oy[${slot}] = oy[${slot}] + ${b.dy}; }`);
      else if (b.dy < 0) lines.push(`if oy[${slot}] >= ${-b.dy} { oy[${slot}] = oy[${slot}] - ${-b.dy}; }`);
    } else if (b.op === "set_pos") {
      lines.push(`ox[${slot}] = ${b.x}; oy[${slot}] = ${b.y};`);
    } else if (b.op === "play") {
      const snd = ctx.sounds.get(b.sound);
      if (!snd) {
        lines.push(`( unknown sound '${b.sound}' )`);
      } else {
        snd.voices.forEach((v, vi) => {
          if (vi >= 4 || v.vol <= 0) return;
          lines.push(`Audio${vi}.addr = &sq32;`);
          lines.push(`Audio${vi}.length = 32;`);
          lines.push(`Audio${vi}.volume = ${v.vol};`);
          lines.push(`Audio${vi}.adsr = 4369;`);
          lines.push(`Audio${vi}.pitch = ${128 + v.note};`);
        });
      }
    } else if (b.op === "goto") {
      lines.push(`setup_${b.scene}();`);
      lines.push(`scene_go(SC_${b.scene.toUpperCase()});`);
    } else if (b.op === "destroy") {
      if (ctx.destroyFn) lines.push(`${ctx.destroyFn}(${slot});`);
      lines.push(`oflags[${slot}] = oflags[${slot}] & 247;`);
    } else if (b.op === "wait") {
      lines.push(`oat[${slot}] = ${b.ticks};`);
    } else {
      throw new Error(`unknown block '${(b as { op: unknown }).op}'`);
    }
  }
  return lines;
}

/** Destroy-event fn name for a leaf: def destroy fns live per template
    (`destroy_def_<id>`, emitted once globally), inline ones per leaf
    (`destroy_<tag>`). Shared by the emitter, the UI preview and
    preview_event, so all three agree on the call. */
export function destroyFnName(
  defs: Map<string, ObjectDef>,
  leaf: FlatLeaf,
  tag: string,
): string | undefined {
  if (leaf.def) {
    const evs = defs.get(leaf.def)?.events ?? [];
    return evs.some((e) => e.trigger === "destroy" && e.blocks.length > 0) ? `destroy_def_${leaf.def}` : undefined;
  }
  return leaf.events.some((e) => e.trigger === "destroy" && e.blocks.length > 0) ? `destroy_${tag}` : undefined;
}

/** An event owner for previews and tools: a template, or a top-level
    leaf path of the preview scene. */
export interface PreviewOwner {
  def?: string;
  leaf?: string;
}

/** Exact body lines for one event, as the emitter writes them
    (slot-relative; headers omitted). Collide shows its matched
    targets as a comment plus the lowered blocks — the pair
    scaffolding itself is visible in emit_files output. */
export function previewOwnerEvent(
  p: Project,
  sceneId: string,
  owner: PreviewOwner,
  eventId: string,
): string[] | null {
  let leaves: FlatLeaf[];
  try {
    leaves = flattenScene(p, sceneId);
  } catch {
    return null;
  }
  const defs = new Map(projectDefs(p).map((d) => [d.id, d]));
  let events: ObjectEvent[];
  let destroyFn: string | undefined;
  if (owner.def !== undefined) {
    const def = defs.get(owner.def);
    if (!def) return null;
    events = def.events ?? [];
    destroyFn = (def.events ?? []).some((e) => e.trigger === "destroy" && e.blocks.length > 0)
      ? `destroy_def_${def.id}`
      : undefined;
  } else if (owner.leaf !== undefined) {
    const leaf = leaves.find((l) => l.path === owner.leaf);
    if (!leaf) return null;
    events = leaf.events;
    destroyFn = destroyFnName(defs, leaf, slotTag(sceneId, leaf.path));
  } else {
    return null;
  }
  const ev = events.find((e) => e.id === eventId);
  if (!ev) return null;
  const lines = previewBlocks(ev.blocks, { slot: "slot", w: p.width, h: p.height, destroyFn, sounds: soundMap(p) });
  if (ev.trigger === "collide") {
    const hits = leaves.filter((t, j) => matchTarget(t, j, -1, ev.target ?? "")).map((t) => t.path);
    return [`( collide ${ev.target} → ${hits.join(", ") || "nothing"} )`, ...lines];
  }
  return lines;
}

/** Per-leaf event fns for one scene. Every event becomes a small
    `slot`-param fn — the frame only dispatches — so generated fns
    stay far under the assembler reference budget no matter how many
    leaves share a scene. Step blocks share the historic `tick_<tag>`
    name with legacy tick text (blocks first); destroyed leaves never
    reach these fns (dispatch sites guard the alive bit). Destroy fns
    for defs emit once globally (see below), inline ones per leaf. */
function emitLeafEvents(
  rootId: string,
  leaves: FlatLeaf[],
  w: number,
  h: number,
  defs: Map<string, ObjectDef>,
  sounds: Map<string, SoundDef>,
): string[] {
  const lines: string[] = [];
  const ind = (ss: string[]): string[] => ss.map((l) => `    ${l}`);
  leaves.forEach((o, i) => {
    const tag = slotTag(rootId, o.path);
    const ctx: BlockCtx = { slot: "slot", w, h, destroyFn: destroyFnName(defs, o, tag), sounds };
    const fn = (name: string, stmts: string[]): void => {
      if (stmts.length === 0) return;
      lines.push(`${name} :: fn(slot: u16) {`, ...ind(stmts), `}`);
    };
    // Create: blocks first, instance code after — same condition as
    // the setup call site, so the fn always exists when called.
    const createEv = o.events.find((e) => e.trigger === "create");
    const createBody = [
      ...(createEv && createEv.blocks.length > 0 ? previewBlocks(createEv.blocks, ctx) : []),
      ...(o.initCode ? String(o.initCode).split("\n") : []),
    ];
    if (createBody.length > 0) fn(`create_${tag}`, createBody);
    for (const e of o.events) {
      if (e.blocks.length === 0 || e.trigger === "create") continue;
      if (e.trigger === "destroy" && !o.def) fn(`destroy_${tag}`, previewBlocks(e.blocks, ctx));
      else if (e.trigger === "alarm") fn(`alarm_${tag}`, previewBlocks(e.blocks, ctx));
      else if (e.trigger === "key" && e.key) fn(`key_${tag}_${e.key}`, previewBlocks(e.blocks, ctx));
      else if (e.trigger === "click") fn(`click_${tag}`, previewBlocks(e.blocks, ctx));
    }
    let ci = 0;
    for (const e of o.events) {
      if (e.trigger !== "collide" || e.blocks.length === 0) continue;
      const [sx, sy, sw, sh] = hitArgs("ox[slot]", "oy[slot]", "ow[slot]", "oh[slot]", o.mask);
      const body: string[] = [`if oflags[slot] & 8 != 0 {`];
      leaves.forEach((t, j) => {
        if (!matchTarget(t, j, i, e.target ?? "")) return;
        const [jx, jy, jw, jh] = hitArgs(`ox[${j}]`, `oy[${j}]`, `ow[${j}]`, `oh[${j}]`, t.mask);
        body.push(`    if overlapwh(${sx}, ${sy}, ${sw}, ${sh}, ${jx}, ${jy}, ${jw}, ${jh}) {`);
        for (const s of previewBlocks(e.blocks, ctx)) body.push(`        ${s}`);
        body.push(`    }`);
      });
      body.push(`}`);
      fn(`collide_${tag}_${ci++}`, body);
    }
    // Step: blocks first, legacy tick text after, one historic name.
    const stepEv = o.events.find((e) => e.trigger === "step");
    const stepLines =
      stepEv && stepEv.blocks.length > 0 ? previewBlocks(stepEv.blocks, ctx).map((l) => `    ${l}`) : [];
    if (stepLines.length > 0 || o.tick) {
      lines.push(
        `tick_${tag} :: fn(slot: u16) {`,
        ...stepLines,
        ...String(o.tick ?? "")
          .split("\n")
          .map((line) => `    ${line}`),
        `}`,
      );
    }
  });
  return lines;
}

/** Destroy fns for templates with destroy events: one fn per def
    (instances share it — statements are slot-relative). Inline
    leaves get theirs in emitLeafEvents. */
function emitDefEvents(p: Project): string[] {
  const lines: string[] = [];
  for (const d of projectDefs(p)) {
    const ev = (d.events ?? []).find((e) => e.trigger === "destroy" && e.blocks.length > 0);
    if (!ev) continue;
    lines.push(`destroy_def_${d.id} :: fn(slot: u16) {`);
    for (const l of previewBlocks(ev.blocks, { slot: "slot", w: p.width, h: p.height, sounds: soundMap(p) })) lines.push(`    ${l}`);
    lines.push(`}`);
  }
  return lines;
}

function emitAnim(rootId: string, leaves: FlatLeaf[], anims: Map<string, Animation>): string[] {
  const lines: string[] = [];
  leaves.forEach((o, i) => {
    if (!o.anim) return;
    const a = anims.get(o.anim);
    if (!a) return;
    const tag = slotTag(rootId, o.path);
    const F = a.frames.length;
    const hold = a.loop ? `afr_${tag} = 0;` : `afr_${tag} = ${F - 1};`;
    lines.push(`    atick_${tag} = atick_${tag} + 1;`);
    lines.push(`    if atick_${tag} >= ${a.rate} {`);
    lines.push(`        atick_${tag} = 0;`);
    if (a.pingpong) {
      // Bounce at the ends (validated: loop + 2+ frames, so F - 2 is
      // safe and the reverse branch always has somewhere to go).
      // One if/else: the flip must not fall through to a reverse
      // step in the same tick.
      lines.push(`        if adir_${tag} == 0 {`);
      lines.push(`            afr_${tag} = afr_${tag} + 1;`);
      lines.push(`            if afr_${tag} >= ${F} { afr_${tag} = ${F - 2}; adir_${tag} = 1; }`);
      lines.push(`        }`);
      lines.push(`        else {`);
      lines.push(`            if afr_${tag} == 0 { afr_${tag} = 1; adir_${tag} = 0; }`);
      lines.push(`            else { afr_${tag} = afr_${tag} - 1; }`);
      lines.push(`        }`);
    } else {
      lines.push(`        afr_${tag} = afr_${tag} + 1;`);
      lines.push(`        if afr_${tag} >= ${F} { ${hold} }`);
    }
    lines.push(`    }`);
    a.frames.forEach((f, fi) => {
      lines.push(`    if afr_${tag} == ${fi} { ot[${i}] = &spr_${f}; }`);
    });
  });
  return lines;
}

function emitDrive(pi: number, w: number, h: number, n: number, pw: number, ph: number): string[] {
  // Keyboard drive + collide-and-push for the player slot. The
  // player's own bounds are literals (static slot); pushed objects
  // read their pixel dims from ow/oh (dynamic slot).
  const lines = [
    `    dpad: u8 = Controller.button;`,
    `    nx: u16 = ox[${pi}]; ny: u16 = oy[${pi}];`,
    `    if dpad & 64 != 0 { if nx >= 1 { nx = nx - 1; } }`,
    `    if dpad & 128 != 0 { if nx < ${Math.max(1, w - pw)} { nx = nx + 1; } }`,
    `    if dpad & 16 != 0 { if ny >= 1 { ny = ny - 1; } }`,
    `    if dpad & 32 != 0 { if ny < ${Math.max(1, h - ph)} { ny = ny + 1; } }`,
    `    ox_old: u16 = ox[${pi}]; oy_old: u16 = oy[${pi}];`,
    `    ox[${pi}] = nx; oy[${pi}] = ny;`,
    `    blocked: u8 = 0;`,
    `    for j in 0..${n} {`,
    `        if j != ${pi} {`,
    `            if oflags[j] & 10 == 10 {`,
    `                if overlapwh(ox[${pi}], oy[${pi}], ${pw}, ${ph}, ox[j], oy[j], ow[j], oh[j]) {`,
    `                    if oflags[j] & 4 != 0 {`,
    `                        jx: u16 = ox[j]; jy: u16 = oy[j];`,
    `                        if dpad & 64 != 0 { if jx >= 1 { jx = jx - 1; } }`,
    `                        if dpad & 128 != 0 { if jx + ow[j] < ${w + 1} { jx = jx + 1; } }`,
    `                        if dpad & 16 != 0 { if jy >= 1 { jy = jy - 1; } }`,
    `                        if dpad & 32 != 0 { if jy + oh[j] < ${h + 1} { jy = jy + 1; } }`,
    `                        free: u8 = 1;`,
    `                        for k in 0..${n} {`,
    `                            if k != ${pi} {`,
    `                                if k != j {`,
    `                                    if oflags[k] & 10 == 10 {`,
    `                                        if overlapwh(jx, jy, ow[j], oh[j], ox[k], oy[k], ow[k], oh[k]) { free = 0; }`,
    `                                    }`,
    `                                }`,
    `                            }`,
    `                        }`,
    `                        if free != 0 { ox[j] = jx; oy[j] = jy; } else { blocked = 1; }`,
    `                    } else { blocked = 1; }`,
    `                }`,
    `            }`,
    `        }`,
    `    }`,
    `    if blocked != 0 { ox[${pi}] = ox_old; oy[${pi}] = oy_old; }`,
  ];
  return lines;
}

function emitFrame(
  s: Scene,
  leaves: FlatLeaf[],
  w: number,
  h: number,
  anims: Map<string, Animation>,
  frameHook: boolean,
  p: Project,
  dims: Map<string, [number, number]>,
): string {
  const lines = [`${s.id}_frame :: fn() {`];
  const live = (t: EventTrigger): FlatLeaf[] => leaves.filter((o) => o.events.some((e) => e.trigger === t && e.blocks.length > 0));
  if (s.keys.length > 0 || live("key").length > 0) lines.push(`    k: u8 = kb[0]; kb[0] = 0;`);
  if (s.clicks.length > 0 || live("click").length > 0) {
    lines.push(`    mnow: u8 = Mouse.state | mb[0]; mb[0] = 0;`);
    lines.push(`    mpressed: u8 = mnow & (mouse_last ^ 255);`);
    lines.push(`    mouse_last = mnow;`);
    lines.push(`    mx: u16 = Mouse.x;`);
    lines.push(`    my: u16 = Mouse.y;`);
  }
  const driver = leaves.findIndex((o) => o.controls);
  if (driver >= 0) {
    const [pw, ph] = dims.get(leaves[driver].sprite) ?? [TILE_PX, TILE_PX];
    lines.push(`    if oflags[${driver}] & 8 != 0 {`);
    lines.push(...emitDrive(driver, w, h, leaves.length, pw, ph).map((l) => `    ${l}`));
    lines.push(`    }`);
  }
  lines.push(...emitAnim(s.id, leaves, anims));
  const byObject = new Map<string, number>();
  leaves.forEach((o, i) => {
    if (!byObject.has(o.id)) byObject.set(o.id, i);
    byObject.set(o.path, i);
  });
  for (const c of [...s.clicks].sort((a, b) => (a.object < b.object ? -1 : 1))) {
    const i = byObject.get(c.object) as number;
    const [cw, ch] = dims.get(leaves[i].sprite) ?? [TILE_PX, TILE_PX];
    const [rx, ry, rw, rh] = hitArgs(`ox[${i}]`, `oy[${i}]`, cw, ch, leaves[i].mask);
    lines.push(`    if mpressed & 1 != 0 {`);
    lines.push(`        if pt_in_rect(mx, my, ${rx}, ${ry}, ${rw}, ${rh}) {`);
    lines.push(`            setup_${c.goto}();`);
    lines.push(`            scene_go(SC_${c.goto.toUpperCase()});`);
    lines.push(`        }`);
    lines.push(`    }`);
  }
  for (const k of [...s.keys].sort((a, b) => bindingKey(p, a) - bindingKey(p, b))) {
    lines.push(`    if k == ${bindingKey(p, k)} {`);
    lines.push(`        setup_${k.goto}();`);
    lines.push(`        scene_go(SC_${k.goto.toUpperCase()});`);
    lines.push(`    }`);
  }
  // Object handlers, in loop order: key → click → step → collide →
  // alarm. Every dispatch guards the alive bit (destroyed leaves go
  // quiet); the fns themselves carry the statements, so the frame
  // stays small no matter how the scene fills up.
  leaves.forEach((o, i) => {
    for (const e of o.events) {
      if (e.trigger !== "key" || e.blocks.length === 0 || !e.key) continue;
      const code = (p.inputs ?? []).find((ii) => ii.id === e.key)?.key ?? 0;
      lines.push(`    if k == ${code} {`);
      lines.push(`        if oflags[${i}] & 8 != 0 {`);
      lines.push(`            key_${slotTag(s.id, o.path)}_${e.key}(${i});`);
      lines.push(`        }`);
      lines.push(`    }`);
    }
  });
  if (live("click").length > 0) {
    lines.push(`    if mpressed & 1 != 0 {`);
    leaves.forEach((o, i) => {
      if (!o.events.some((e) => e.trigger === "click" && e.blocks.length > 0)) return;
      const [cw, ch] = dims.get(o.sprite) ?? [TILE_PX, TILE_PX];
      const [rx, ry, rw, rh] = hitArgs(`ox[${i}]`, `oy[${i}]`, cw, ch, o.mask);
      lines.push(`        if pt_in_rect(mx, my, ${rx}, ${ry}, ${rw}, ${rh}) {`);
      lines.push(`            if oflags[${i}] & 8 != 0 {`);
      lines.push(`                click_${slotTag(s.id, o.path)}(${i});`);
      lines.push(`            }`);
      lines.push(`        }`);
    });
    lines.push(`    }`);
  }
  leaves.forEach((o, i) => {
    const stepEv = o.events.find((e) => e.trigger === "step");
    if ((stepEv && stepEv.blocks.length > 0) || o.tick)
      lines.push(`    if oflags[${i}] & 8 != 0 { tick_${slotTag(s.id, o.path)}(${i}); }`);
  });
  leaves.forEach((o, i) => {
    let ci = 0;
    for (const e of o.events) {
      if (e.trigger !== "collide" || e.blocks.length === 0) continue;
      lines.push(`    if oflags[${i}] & 8 != 0 { collide_${slotTag(s.id, o.path)}_${ci}(${i}); }`);
      ci++;
    }
  });
  leaves.forEach((o, i) => {
    if (!o.events.some((e) => e.trigger === "alarm" && e.blocks.length > 0)) return;
    lines.push(`    if oat[${i}] > 0 {`);
    lines.push(`        oat[${i}] = oat[${i}] - 1;`);
    lines.push(`        if oat[${i}] == 0 {`);
    lines.push(`            alarm_${slotTag(s.id, o.path)}(${i});`);
    lines.push(`        }`);
    lines.push(`    }`);
  });
  if (frameHook) lines.push(`    custom_frame();`);
  if (s.frameCode) {
    lines.push(`    ( --- scene script: ${s.id} --- )`);
    for (const line of s.frameCode.split("\n")) lines.push(`    ${line}`);
  }
  // Empty scenes have no draw fn: the shared loop draws zero slots.
  lines.push(leaves.length > 0 ? `    draw_${s.id}();` : `    draw_all();`);
  lines.push(`}`);
  return lines.join("\n") + "\n";
}

export function emitProject(p: Project): Record<string, string> {
  const errs = validateProject(p);
  if (errs.length > 0) throw new Error(`invalid project: ${errs.join("; ")}`);
  if (p.kind === "code") return { ...(p.codeFiles ?? {}) };
  const custom = (p.customCode ?? "").trim();
  const hasSetupHook = /custom_setup\s*::/.test(custom);
  const hasFrameHook = /custom_frame\s*::/.test(custom);
  const scenes = [...p.scenes].sort((a, b) => (a.id < b.id ? -1 : 1));
  const indexOf = new Map(scenes.map((s, i) => [s.id, i]));

  const out: string[] = [];
  out.push(`( generated by uxn-forge from project '${p.name}' — do not edit. )`);
  out.push(`import "devices.ux"`);
  out.push(``);
  out.push(`meta { title: "${p.name}", author: "${p.author}" }`);
  out.push(``);
  if (custom) {
    out.push(`( --- custom.ux : user-authored top-level declarations --- )`);
    out.push(custom);
    out.push(``);
  }
  for (const s of scenes) out.push(`SC_${s.id.toUpperCase()} :: ${indexOf.get(s.id)};`);
  out.push(``);
  const animMap = new Map(p.anims.map((a) => [a.id, a]));
  // Only referenced sprites become ROM blobs: gallery-only tiles
  // stay out of the build (and out of unused-data warnings).
  // Validated projects flatten cleanly, so this never throws here.
  const usedSprites = new Set<string>();
  for (const s of p.scenes) {
    for (const x of flattenScene(p, s.id)) {
      usedSprites.add(x.sprite);
      if (x.anim) for (const f of animMap.get(x.anim)?.frames ?? []) usedSprites.add(f);
    }
  }
  for (const o of [...p.sprites].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!usedSprites.has(o.id)) continue;
    out.push(`data spr_${o.id} = [${spriteToPlanar(o).join(", ")}];`);
  }
  if (usedVoices(p).length > 0) {
    out.push(`data sq32 = [${SQ32.join(", ")}];`);
  }
  out.push(``);
  // Flattened once up front: setup/draw/frame all read it, and the
  // buffer decisions below need every leaf's flags and events.
  const flat = new Map(p.scenes.map((s) => [s.id, flattenScene(p, s.id)] as const));
  const flatEvents = [...flat.values()].flatMap((leaves) => leaves.flatMap((o) => o.events));
  // Dims/alarm buffers exist only when something reads them (a
  // keyboard driver, move/collide blocks, or custom code naming
  // them): unreferenced globals warn, and warning-free assembly is
  // a tested property.
  const customAll = [
    custom,
    ...p.scenes.flatMap((s) => [s.frameCode ?? "", ...s.nodes.map((o) => o.tick ?? "")]),
  ].join("\n");
  const needsDims =
    [...flat.values()].some((leaves) => leaves.some((o) => o.controls)) ||
    flatEvents.some(
      (e) =>
        e.blocks.length > 0 &&
        (e.trigger === "collide" || e.blocks.some((b) => b.op === "move")),
    ) ||
    customAll.includes("ow[") ||
    customAll.includes("oh[") ||
    customAll.includes("overlapwh");
  const needsAlarm =
    flatEvents.some(
      (e) => e.blocks.length > 0 && (e.trigger === "alarm" || e.blocks.some((b) => b.op === "wait")),
    ) || customAll.includes("oat[");
  out.push(`buffer ox[${MAX_OBJECTS}]: u16;`);
  out.push(`buffer oy[${MAX_OBJECTS}]: u16;`);
  out.push(`buffer ot[${MAX_OBJECTS}]: u16;`);
  out.push(`buffer oflags[${MAX_OBJECTS}]: u8;`);
  if (needsDims) {
    out.push(`buffer ow[${MAX_OBJECTS}]: u16;`);
    out.push(`buffer oh[${MAX_OBJECTS}]: u16;`);
  }
  if (needsAlarm) out.push(`buffer oat[${MAX_OBJECTS}]: u8;`);
  out.push(`ocount: u8 = 0;`);
  out.push(`scene: u8 = 0;`);
  const needsKey = scenes.some((x) => x.keys.length > 0);
  const needsMouse = scenes.some((x) => x.clicks.length > 0);
  if (needsKey) out.push(`kb: [1] u8;`);
  if (needsMouse) {
    out.push(`mb: [1] u8;`);
    out.push(`mouse_last: u8 = 0;`);
  }
  out.push(``);
  out.push(`scene_go :: fn(id: u8) {`);
  out.push(`    scene = id;`);
  out.push(`}`);
  out.push(``);
  out.push(`pt_in_rect :: fn(px: u16, py: u16, rx: u16, ry: u16, rw: u16, rh: u16) -> u8 {`);
  out.push(`    if px >= rx && px < rx + rw && py >= ry && py < ry + rh {`);
  out.push(`        return 1;`);
  out.push(`    }`);
  out.push(`    return 0;`);
  out.push(`}`);
  out.push(``);
  out.push(`overlap88 :: fn(ax: u16, ay: u16, bx: u16, by: u16) -> u8 {`);
  out.push(`    if ax < bx + 8 && bx < ax + 8 && ay < by + 8 && by < ay + 8 {`);
  out.push(`        return 1;`);
  out.push(`    }`);
  out.push(`    return 0;`);
  out.push(`}`);
  out.push(``);
  if (needsDims) {
    out.push(`overlapwh :: fn(ax: u16, ay: u16, aw: u16, ah: u16, bx: u16, by: u16, bw: u16, bh: u16) -> u8 {`);
    out.push(`    if ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah {`);
    out.push(`        return 1;`);
    out.push(`    }`);
    out.push(`    return 0;`);
    out.push(`}`);
    out.push(``);
  }
  out.push(`draw_all :: fn() {`);
  out.push(`    for i in 0..${MAX_OBJECTS} {`);
  out.push(`        if i < ocount {`);
  out.push(`            if oflags[i] & 1 != 0 {`);
  out.push(`                if oflags[i] & 8 != 0 {`);
  out.push(`                    Screen.x = ox[i];`);
  out.push(`                    Screen.y = oy[i];`);
  out.push(`                    Screen.addr = ot[i];`);
  out.push(`                    Screen.sprite = 129;`);
  out.push(`                }`);
  out.push(`            }`);
  out.push(`        }`);
  out.push(`    }`);
  out.push(`}`);
  out.push(``);
  for (const s of scenes) {
    for (const o of flat.get(s.id) as FlatLeaf[]) {
      if (o.anim && animMap.has(o.anim)) {
        const tag = slotTag(s.id, o.path);
        out.push(`atick_${tag}: u8 = 0;`);
        out.push(`afr_${tag}: u8 = 0;`);
        if (animMap.get(o.anim)?.pingpong) out.push(`adir_${tag}: u8 = 0;`);
      }
    }
  }
  out.push(``);
  // tiles for draw fns, pixels for setup/collide/click/drive.
  const tileDims = new Map(p.sprites.map((x) => [x.id, spriteTiles(x)] as const));
  const pxDims = new Map(p.sprites.map((x) => [x.id, spritePx(x)] as const));
  const defs = new Map(projectDefs(p).map((d) => [d.id, d]));
  out.push(...emitDefEvents(p));
  for (const s of scenes) {
    // Store order, not sorted: hierarchy drag-reorder defines draw order.
    const leaves = flat.get(s.id) as FlatLeaf[];
    out.push(...emitLeafEvents(s.id, leaves, p.width, p.height, defs, soundMap(p)));
    out.push(emitSetup(s.id, leaves, pxDims, needsDims, needsAlarm));
    if (leaves.length > 0) out.push(emitDrawScene(s, leaves, tileDims));
    out.push(emitFrame(s, leaves, p.width, p.height, animMap, hasFrameHook, p, pxDims));
  }
  const arms = scenes.map((s) => `        ${indexOf.get(s.id)} => { ${s.id}_frame(); }`).join("\n");
  out.push(`on_frame :: event() {`);
  out.push(`    match scene {`);
  out.push(arms);
  out.push(`    }`);
  out.push(`}`);
  out.push(``);
  if (needsKey) {
    out.push(`on_key :: event() {`);
    out.push(`    kb[0] = Controller.key;`);
    out.push(`}`);
    out.push(``);
  }
  if (needsMouse) {
    out.push(`on_mouse :: event() {`);
    out.push(`    mb[0] = mb[0] | Mouse.state;`);
    out.push(`}`);
    out.push(``);
  }
  out.push(`start :: fn() {`);
  const theme = p.theme ?? { r: THEME_R, g: THEME_G, b: THEME_B };
  out.push(`    System.r = ${theme.r};`);
  out.push(`    System.g = ${theme.g};`);
  out.push(`    System.b = ${theme.b};`);
  out.push(`    Screen.width = ${p.width};`);
  out.push(`    Screen.height = ${p.height};`);
  out.push(`    Screen.x = 0;`);
  out.push(`    Screen.y = 0;`);
  out.push(`    Screen.pixel = 128;`);
  for (const v of usedVoices(p)) {
    const voice = (p.sound?.voices ?? [])[v];
    out.push(`    Audio${v}.addr = &sq32;`);
    out.push(`    Audio${v}.length = 32;`);
    out.push(`    Audio${v}.volume = ${voice.vol};`);
    out.push(`    Audio${v}.adsr = 4369;`);
    out.push(`    Audio${v}.pitch = ${128 + voice.note};`);
  }
  out.push(`    setup_${p.start}();`);
  if (hasSetupHook) out.push(`    custom_setup();`);
  out.push(`    scene_go(SC_${p.start.toUpperCase()});`);
  out.push(`    Screen.vector = &on_frame;`);
  if (needsKey) out.push(`    Controller.vector = &on_key;`);
  if (needsMouse) out.push(`    Mouse.vector = &on_mouse;`);
  out.push(`}`);
  out.push(``);
  out.push(`main :: event() {`);
  out.push(`    start();`);
  out.push(`}`);
  out.push(``);
  return { "devices.ux": emitDevices(p), "main.ux": out.join("\n") };
}

/* Sample project: title → play via click or space. */
const BLOCK = Array<number>(64).fill(1);
const WALL_ROWS = [255, 129, 129, 129, 129, 129, 129, 255];
const COIN_ROWS = [24, 60, 126, 255, 255, 126, 60, 24];
const COIN2_ROWS = [0, 24, 60, 126, 126, 60, 24, 0];

export const SAMPLE_PROJECT: Project = {
  id: "demo",
  kind: "visual",
  name: "Forge Demo",
  author: "uxn-forge",
  width: 128,
  height: 128,
  start: "title",
  updatedAt: 0,
  inputs: [
    { id: "jump", key: 32 },
    { id: "back", key: 27 },
  ],
  sound: { voices: [{ note: 72, vol: 120 }, { note: 0, vol: 0 }, { note: 0, vol: 0 }, { note: 0, vol: 0 }] },
  sounds: [
    { id: "blip", voices: [{ note: 0, vol: 0 }, { note: 84, vol: 120 }, { note: 0, vol: 0 }, { note: 0, vol: 0 }] },
  ],
  sprites: [
    { id: "hero", pixels: BLOCK },
    { id: "wall", pixels: monoToPixels(WALL_ROWS) },
    { id: "coin", pixels: monoToPixels(COIN_ROWS) },
    { id: "coin2", pixels: monoToPixels(COIN2_ROWS) },
  ],
  anims: [{ id: "spin", frames: ["coin", "coin2"], rate: 30, loop: true }],
  scenes: [
    {
      id: "title",
      nodes: [
        {
          id: "hero",
          x: 16,
          y: 40,
          sprite: "hero",
          kind: "player",
          controls: true,
          events: [{ id: "ev_click", trigger: "click", blocks: [{ op: "play", sound: "blip" }] }],
        },
        { id: "wall", x: 64, y: 64, sprite: "wall", kind: "static", solid: true },
        { id: "coin", x: 96, y: 96, sprite: "coin", kind: "movable", solid: true, anim: "spin" },
      ],
      clicks: [{ object: "hero", goto: "play" }],
      keys: [{ input: "jump", key: 32, goto: "play" }],
    },
    {
      id: "play",
      nodes: [{ id: "hero", x: 8, y: 8, sprite: "hero", kind: "player", controls: true }],
      clicks: [],
      keys: [{ input: "back", key: 27, goto: "title" }],
    },
  ],
};
