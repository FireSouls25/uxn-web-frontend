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
}

export type ObjectKind = "player" | "static" | "movable";

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
}

/** Leaf node with resolved defaults. */
export type SceneObject = SceneNode & { sprite: string; kind: ObjectKind };

const MAX_DEPTH = 8;

/** Depth-first flatten with accumulated offsets. Throws on cycles,
    depth overflow, or slot overflow — validation surfaces these. */
export function flattenScene(p: Project, sceneId: string): FlatLeaf[] {
  const scenes = new Map(p.scenes.map((s) => [s.id, s]));
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
        out.push({ ...n, path, x: n.x + ox, y: n.y + oy, kind: n.kind ?? "static", sprite: n.sprite ?? "" });
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
  /** Frame collections over sprite ids. */
  anims: Animation[];
  /** Up to 4 voices, played once on boot. Absent = silent. */
  sound?: { voices: Voice[] };
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
const RESERVED_PREFIX = ["atick_", "afr_", "spr_", "tick_"];

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
      if (!isBranch && !o.sprite) errs.push(`node '${o.id}': leaf needs a sprite`);
      if (!isBranch) {
        if (!spriteIds.has(o.sprite as string)) errs.push(`node '${o.id}': unknown sprite '${o.sprite}'`);
        if (o.anim && !animIds.has(o.anim)) errs.push(`node '${o.id}': unknown animation '${o.anim}'`);
        // The emitter draws with the leaf sprite's tile width; an
        // animation of other-sized frames would tear at the seams.
        if (o.anim && o.sprite) {
          const leaf = spriteDims.get(o.sprite as string);
          const frames = animDims.get(o.anim);
          if (leaf && frames && (leaf[0] !== frames[0] || leaf[1] !== frames[1]))
            errs.push(`node '${o.id}': sprite must match animation '${o.anim}' size`);
        }
      }
      if (o.tick) errs.push(...validateCustomCode(o.tick).map((e) => `node '${o.id}' tick: ${e}`));
      if (o.kind !== undefined && o.kind !== "player" && o.kind !== "static" && o.kind !== "movable")
        errs.push(`node '${o.id}': bad kind '${(o as { kind: unknown }).kind}'`);
      if (o.kind === "movable" && !o.solid) errs.push(`node '${o.id}': movable requires solid`);
      if (o.controls && o.kind !== "player") errs.push(`node '${o.id}': controls require player kind`);
    }
    // Flattened view: cycles, depth, slot budget, player/driver caps.
    try {
      const flat = flattenScene(p, s.id);
      const players = flat.filter((o) => o.kind === "player");
      if (players.length > 1) errs.push(`scene '${s.id}': at most one player (0 allowed)`);
      const drivers = flat.filter((o) => o.controls);
      if (drivers.length > 1) errs.push(`scene '${s.id}': at most one keyboard driver`);
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

/** Voice indices with vol > 0 (max 4, validated). */
function usedVoices(p: Project): number[] {
  const out: number[] = [];
  (p.sound?.voices ?? []).forEach((v, i) => {
    if (i < 4 && v.vol > 0) out.push(i);
  });
  return out;
}

function flagsOf(o: SceneObject): number {
  return 1 | (o.solid ? 2 : 0) | (o.kind === "movable" ? 4 : 0);
}

/** Per-slot generated prefix: root scene + sanitized instance path. */
function slotTag(rootId: string, path: string): string {
  return `${rootId}_${path.replace(/\//g, "_")}`;
}

function emitSetup(rootId: string, leaves: FlatLeaf[], dims: Map<string, [number, number]>, withDims: boolean): string {
  const lines = [`setup_${rootId} :: fn() {`];
  for (let i = 0; i < leaves.length; i++) {
    const o = leaves[i];
    let line = `    ox[${i}] = ${o.x}; oy[${i}] = ${o.y}; ot[${i}] = &spr_${o.sprite}; oflags[${i}] = ${flagsOf(o)};`;
    // Dims ride along only where collision can read them (solid or
    // driven slots — the drive loop guards every read with the solid
    // flag, and the driver's own dims are literals). Besides saving
    // ROM, this keeps setup fns far under the assembler's
    // per-function reference budget (measured: 1200 OK, 1400 fails).
    if (withDims && (o.solid || o.kind === "movable" || o.controls)) {
      const [pw, ph] = dims.get(o.sprite) ?? [TILE_PX, TILE_PX];
      line += ` ow[${i}] = ${pw}; oh[${i}] = ${ph};`;
    }
    lines.push(line);
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
    for (let ty = 0; ty < th; ty++) {
      for (let tx = 0; tx < tw; tx++) {
        const off = (ty * tw + tx) * 16;
        lines.push(`    Screen.x = ox[${i}]${px(tx * TILE_PX)};`);
        lines.push(`    Screen.y = oy[${i}]${px(ty * TILE_PX)};`);
        lines.push(`    Screen.addr = ot[${i}]${px(off)};`);
        lines.push(`    Screen.sprite = 129;`);
      }
    }
  });
  lines.push(`}`);
  return lines.join("\n") + "\n";
}

function emitTickFn(tag: string, tick: string): string[] {
  return [
    `tick_${tag} :: fn(slot: u16) {`,
    ...String(tick ?? "")
      .split("\n")
      .map((line) => `    ${line}`),
    `}`,
  ];
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
    lines.push(`        afr_${tag} = afr_${tag} + 1;`);
    lines.push(`        if afr_${tag} >= ${F} { ${hold} }`);
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
    `            if oflags[j] & 2 != 0 {`,
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
    `                                    if oflags[k] & 2 != 0 {`,
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
  if (s.keys.length > 0) lines.push(`    k: u8 = kb[0]; kb[0] = 0;`);
  if (s.clicks.length > 0) {
    lines.push(`    mnow: u8 = Mouse.state | mb[0]; mb[0] = 0;`);
    lines.push(`    mpressed: u8 = mnow & (mouse_last ^ 255);`);
    lines.push(`    mouse_last = mnow;`);
    lines.push(`    mx: u16 = Mouse.x;`);
    lines.push(`    my: u16 = Mouse.y;`);
  }
  const driver = leaves.findIndex((o) => o.controls);
  if (driver >= 0) {
    const [pw, ph] = dims.get(leaves[driver].sprite) ?? [TILE_PX, TILE_PX];
    lines.push(...emitDrive(driver, w, h, leaves.length, pw, ph));
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
    lines.push(`    if mpressed & 1 != 0 {`);
    lines.push(`        if pt_in_rect(mx, my, ox[${i}], oy[${i}], ${cw}, ${ch}) {`);
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
  leaves.forEach((o, i) => {
    if (o.tick) lines.push(`    tick_${slotTag(s.id, o.path)}(${i});`);
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
  // dims decision below needs every leaf's driver flag.
  const flat = new Map(p.scenes.map((s) => [s.id, flattenScene(p, s.id)] as const));
  // Dims buffers exist only when something reads them (a keyboard
  // driver, or custom code naming them): unreferenced globals warn,
  // and warning-free assembly is a tested property.
  const customAll = [
    custom,
    ...p.scenes.flatMap((s) => [s.frameCode ?? "", ...s.nodes.map((o) => o.tick ?? "")]),
  ].join("\n");
  const needsDims =
    [...flat.values()].some((leaves) => leaves.some((o) => o.controls)) ||
    customAll.includes("ow[") ||
    customAll.includes("oh[") ||
    customAll.includes("overlapwh");
  out.push(`buffer ox[${MAX_OBJECTS}]: u16;`);
  out.push(`buffer oy[${MAX_OBJECTS}]: u16;`);
  out.push(`buffer ot[${MAX_OBJECTS}]: u16;`);
  out.push(`buffer oflags[${MAX_OBJECTS}]: u8;`);
  if (needsDims) {
    out.push(`buffer ow[${MAX_OBJECTS}]: u16;`);
    out.push(`buffer oh[${MAX_OBJECTS}]: u16;`);
  }
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
  out.push(`                Screen.x = ox[i];`);
  out.push(`                Screen.y = oy[i];`);
  out.push(`                Screen.addr = ot[i];`);
  out.push(`                Screen.sprite = 129;`);
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
      }
    }
  }
  out.push(``);
  // tiles for draw fns, pixels for setup/collide/click/drive.
  const tileDims = new Map(p.sprites.map((x) => [x.id, spriteTiles(x)] as const));
  const pxDims = new Map(p.sprites.map((x) => [x.id, spritePx(x)] as const));
  for (const s of scenes) {
    // Store order, not sorted: hierarchy drag-reorder defines draw order.
    const leaves = flat.get(s.id) as FlatLeaf[];
    for (const o of leaves) {
      if (o.tick) out.push(emitTickFn(slotTag(s.id, o.path), o.tick).join("\n") + "\n");
    }
    out.push(emitSetup(s.id, leaves, pxDims, needsDims));
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
        { id: "hero", x: 16, y: 40, sprite: "hero", kind: "player", controls: true },
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
