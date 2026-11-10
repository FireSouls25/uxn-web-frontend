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
import { glyphRows } from "./font";
import { STDLIB, importsOf, moduleExports, stdlibClosure } from "./stdlib";
import { emitEngineProject, sceneFlow, validateBehaviour } from "./engine";

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
  /** Sprite sheet: cell size in tiles (must divide w/h). A node shows
      one cell (SceneNode.cell, row-major over the grid) and measures
      as one cell; code still has the whole sheet at &spr_<id>, cell
      tiles at cellTileOffset(). Absent = the sprite is one cell. */
  cell?: { w: number; h: number };
}

/** Sheet cell size in tiles (the whole sprite when not a sheet). */
export function cellTiles(s: Sprite): [number, number] {
  return s.cell ? [s.cell.w, s.cell.h] : spriteTiles(s);
}

/** Number of cells in a sheet (1 when not a sheet). */
export function cellCount(s: Sprite): number {
  const [w, h] = spriteTiles(s);
  const [cw, ch] = cellTiles(s);
  return Math.max(1, Math.floor(w / cw) * Math.floor(h / ch));
}

/** Blob byte offset of tile (tx, ty) inside cell `cell`: cells run
    row-major over the sheet grid, tiles stay row-major over the whole
    sheet (16 bytes each), so a cell's rows are a sheet-width apart. */
export function cellTileOffset(s: Sprite, cell: number, tx = 0, ty = 0): number {
  const [w] = spriteTiles(s);
  const [cw, ch] = cellTiles(s);
  const perRow = Math.max(1, Math.floor(w / cw));
  const cx = cell % perRow;
  const cy = Math.floor(cell / perRow);
  return ((cy * ch + ty) * w + cx * cw + tx) * 16;
}

/** Varvara blending table (screen.c): pixel value 0–3 × blend 0–15
    → palette color. Blends 0, 5, 10 and 15 leave pixel 0 transparent
    (`opaque = blend % 5`); every other blend paints it. */
export const BLENDING: number[][] = [
  [0, 0, 0, 0, 1, 0, 1, 1, 2, 2, 0, 2, 3, 3, 3, 0],
  [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3],
  [1, 2, 3, 1, 1, 2, 3, 1, 1, 2, 3, 1, 1, 2, 3, 1],
  [2, 3, 1, 2, 2, 3, 1, 2, 2, 3, 1, 2, 2, 3, 1, 2],
];

/** Palette color a pixel paints under a blend, or null (transparent). */
export function blendColor(pixel: number, blend: number): number | null {
  const b = blend & 15;
  if (pixel === 0 && b % 5 === 0) return null;
  return BLENDING[pixel & 3][b];
}

/** How a node is drawn: Varvara's Screen.sprite byte bits. */
export interface DrawLook {
  flipX?: boolean;
  flipY?: boolean;
  /** Varvara blend 0–15 (palette remap + transparency). Absent = 1:
      identity, opaque — the engine's historic mode 129. */
  blend?: number;
}

/** What a node paints, pixel by pixel, exactly as the VM's tile
    writes do: the chosen cell, flips, then the blend remap (null =
    transparent, left out). Coordinates are footprint-relative. */
export function leafPaint(s: Sprite, look: DrawLook & { cell?: number }): Array<[number, number, number]> {
  const [tw, th] = cellTiles(s);
  const out: Array<[number, number, number]> = [];
  const cell = look.cell ?? 0;
  const blend = look.blend ?? 1;
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      // Sheet tile index → pixel base (pixels are tile-major too).
      const tile = cellTileOffset(s, cell, tx, ty) / 16;
      const dx = look.flipX ? tw - 1 - tx : tx;
      const dy = look.flipY ? th - 1 - ty : ty;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const c = blendColor((s.pixels[tile * 64 + y * 8 + x] ?? 0) & 3, blend);
          if (c === null) continue;
          const px = look.flipX ? 7 - x : x;
          const py = look.flipY ? 7 - y : y;
          out.push([dx * 8 + px, dy * 8 + py, c]);
        }
      }
    }
  }
  return out;
}

/** Screen.sprite byte for a look: 2bpp, flips, blend. */
export function lookMode(l: DrawLook): number {
  return 0x80 | (l.flipY ? 0x20 : 0) | (l.flipX ? 0x10 : 0) | ((l.blend ?? 1) & 15);
}

/** Sprite dimensions in tiles, legacy-safe. */
export function spriteTiles(s: Sprite): [number, number] {
  return [s.w ?? 1, s.h ?? 1];
}

/** Node footprint in pixels: one cell for sheets, else the sprite. */
export function spritePx(s: Sprite): [number, number] {
  const [w, h] = cellTiles(s);
  return [w * TILE_PX, h * TILE_PX];
}

/** Pixel dims for a sprite id; unknown id → 8×8 so mid-edit states
    (deleted sprite, typing id) still render instead of crashing. */
export function spritePxOf(p: Project, id: string): [number, number] {
  const s = p.sprites.find((x) => x.id === id);
  return s ? spritePx(s) : [TILE_PX, TILE_PX];
}

/** A placed object's footprint in pixels: its sprite cell, or its
    text (8px per char) when it's a text-only object. */
export function leafPxOf(p: Project, leaf: { sprite?: string; label?: string }): [number, number] {
  if (leaf.sprite) return spritePxOf(p, leaf.sprite);
  return [Math.max(1, (leaf.label ?? "").length) * TILE_PX, TILE_PX];
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

/* ---------------------------------------------------------------
   Behaviour model (v2). Objects react to EVENTS with lists of
   ACTIONS; every number an action takes is a VALUE (a literal, a
   variable, a property, the mouse, a random number, arithmetic or a
   script function), and every test is a CONDITION. Scenes carry the
   same events (scene start, every frame, keys, mouse, messages), so
   there is one place for behaviour, not seven.
   --------------------------------------------------------------- */

/** When an object (or scene) reacts.
    create   — scene start (scenes run theirs before their objects')
    step     — every frame
    destroy  — just before a destroy action removes it
    key      — a named key or a controller button was pressed
    click    — mouse pressed on this object (scenes: anywhere)
    release  — mouse button released (anywhere)
    collide  — overlapping a target (other = the object hit)
    alarm    — timer 0–3 ran out (armed by "start timer")
    message  — someone sent this message */
export type EventTrigger = "create" | "step" | "destroy" | "key" | "click" | "release" | "collide" | "alarm" | "message";

/** Controller buttons (Controller.button bits). Arrows are buttons on
    Varvara — keyboard keys have no held state, buttons do. */
export const BUTTONS = { a: 1, b: 2, select: 4, start: 8, up: 16, down: 32, left: 64, right: 128 } as const;
export type ButtonName = keyof typeof BUTTONS;

export type MathOp = "+" | "-" | "*" | "/" | "%";
/** Object properties a value can read. */
export type PropName = "x" | "y" | "cell" | "w" | "h";
/** Whose variable/property: this object, or the one it collided with. */
export type Who = "self" | "other";

/** A number. Plain numbers are literals (negative ones only in move
    deltas); everything else is computed at runtime, all u16. */
export type Value = number | ValueExpr;
export type ValueExpr =
  | { k: "var"; name: string }
  | { k: "my"; name: string; of?: Who }
  | { k: "prop"; prop: PropName; of?: Who }
  | { k: "mouse"; axis: "x" | "y" }
  | { k: "random"; max: Value }
  | { k: "math"; op: MathOp; a: Value; b: Value }
  | { k: "call"; fn: string; args: Value[] };

export type CmpOp = "eq" | "neq" | "lt" | "lte" | "gt" | "gte";

/** A test for if-actions. */
export type Cond =
  | { k: "cmp"; a: Value; op: CmpOp; b: Value }
  | { k: "held"; button: ButtonName }
  | { k: "touching"; target: string }
  | { k: "mouse_over" }
  | { k: "mouse_down" }
  | { k: "all"; of: Cond[] }
  | { k: "any"; of: Cond[] }
  | { k: "not"; c: Cond };

/** One action. Grouped in the editor as Motion, Looks, Sound,
    Scenes, Objects, Data, Flow and Code. */
export type Block =
  | { op: "move"; dx: Value; dy: Value }
  | { op: "set_pos"; x: Value; y: Value }
  | { op: "glide"; x: Value; y: Value; frames: number }
  | { op: "sprite"; sprite: string; cell?: Value }
  | { op: "cell"; cell: Value }
  | { op: "look"; blend?: number; flipX?: boolean; flipY?: boolean }
  | { op: "show" }
  | { op: "hide" }
  | { op: "text"; text: string; value?: Value }
  | { op: "play"; sound: string }
  | { op: "song"; song: string }
  | { op: "song_stop" }
  | { op: "goto"; scene: string }
  | { op: "overlay"; scene: string }
  | { op: "back" }
  | { op: "wait"; ticks: Value; slot?: number }
  | { op: "destroy"; target?: string }
  | { op: "spawn"; def: string; x: Value; y: Value }
  | { op: "send"; message: string }
  | { op: "set"; name: string; scope?: "global" | Who; mode: "set" | "add" | "sub"; value: Value }
  | { op: "if"; cond: Cond; then: Block[]; else?: Block[] }
  | { op: "repeat"; times: Value; index?: string; body: Block[] }
  | { op: "call"; fn: string; args: Value[] }
  | { op: "jump"; power: Value }
  | { op: "code"; code: string };
export type BlockOp = Block["op"];

/** Address of a block inside an event: descent segments through if/
    repeat bodies (`[1, "then", 0]` = blocks[1].then[0]); a lone `[i]`
    addresses top level. Empty paths are never valid. */
export type BlockPath = (number | "then" | "else" | "body")[];

/** A named u16 game variable (score, health, flags): one `var_<id>`
    buffer slot, initialized once in `start()`. Template variables use
    the same shape (`init` = default for every instance). */
export interface GameVar {
  id: string;
  /** Boot value, 0–65535. */
  init: number;
}

/** One song step: MIDI pitch 0–107 (127 = rest) held for len ticks.
    Mirrors lib/song.ux Note (pitch u8, len u8). */
export interface SongNote {
  pitch: number;
  len: number;
}
/** One of four sequencer voices: up to 16 steps looping, one shared
    square wave at vol. Empty notes = silent voice (skipped). */
export interface SongTrack {
  notes: SongNote[];
  vol: number;
}
/** A named 4-voice loop: data blobs per voice plus a generated
    start fn; play_song points the shared live buffers at it. */
export interface SongDef {
  id: string;
  tracks: SongTrack[];
}

export interface ObjectEvent {
  /** Stable id for agent/UI targeting (ev_N). */
  id: string;
  trigger: EventTrigger;
  /** key trigger: named input id (keyboard)… */
  key?: string;
  /** …or a controller button (arrows, A/B, start/select). */
  button?: ButtonName;
  /** collide trigger: any|solid|player|movable|def:<id>. */
  target?: string;
  /** alarm trigger: timer 0–3 (default 0). */
  alarm?: number;
  /** message trigger: the message name. */
  message?: string;
  blocks: Block[];
}


/** A user script module: a whole `.ux` file emitted beside main.ux
    and imported by it. Scripts may import each other and any
    standard-library module (`import "screen.ux"`). */
export interface ScriptFile {
  path: string;
  code: string;
}

/** Who runs the frame.
    engine: scenes, objects and blocks run; hooks splice into the loop.
    script: custom_frame() IS the loop — the engine only boots (theme,
    screen, variables), wires the vectors to the hooks and exports the
    assets the code names (spr_<id>, snd_<id>(), var_<id>, KEY_<ID>). */
export type LoopMode = "engine" | "script";

/** Hook names the engine calls when defined (custom.ux or any script). */
export const HOOKS = ["custom_setup", "custom_frame", "custom_draw", "custom_key", "custom_mouse"] as const;
export type HookName = (typeof HOOKS)[number];

/** Canvas chrome positions: where scene/object blocks sit on the
    free-form Blocks canvas. Pure UI state — validation and emit
    ignore it, migration passes it through untouched. */
export interface CanvasPos {
  x: number;
  y: number;
}
export interface CanvasLayout {
  scenes?: Record<string, CanvasPos>;
  objects?: Record<string, Record<string, CanvasPos>>;
}

/** An object template: the GameMaker Object in our Object ≠ Sprite ≠
    Instance split. A def owns default art, physics flags, animation
    and tick script; scene leaves either inline all of that (today's
    behavior) or carry `def` and override per field. Events arrive in
    Phase 2; the tick default already makes defs useful now. */
export interface ObjectDef {
  id: string;
  /** Default art ("" = a text-only object: it shows its text). */
  sprite: string;
  /** Template variables: every instance gets its own copy, starting
      at `init` (instances may override the start value). */
  vars?: GameVar[];
  /** Default text drawn at the object (instances may override). */
  label?: string;
  kind: ObjectKind;
  solid?: boolean;
  controls?: boolean;
  anim?: string;
  /** The def's events; instances inherit them whole. */
  events?: ObjectEvent[];
  /** Default hitbox; a leaf mask replaces it whole (boxes don't merge). */
  mask?: HitBox;
  /** Default sheet cell / look for instances (local values win). */
  cell?: number;
  flipX?: boolean;
  flipY?: boolean;
  blend?: number;
  /** Built-in movement: `platformer` = arrows run, up/A/space jumps,
      gravity, solid tiles and solid objects block; `walker` = patrols
      left/right with gravity, turning at walls and ledges. */
  movement?: Movement;
  /** Pixels per frame sideways (1–4, default 2 platformer / 1 walker). */
  speed?: number;
  /** Jump strength 1–8 (default 5): height ≈ 3·j·(j+1)/2 px. */
  jump?: number;
  /** Fixed to the screen: ignores the camera (HUD text, lives). */
  hud?: boolean;
}

export type Movement = "platformer" | "walker";

/** A scene's tile layer: a grid of cells from one sheet sprite whose
    cells are single 8×8 tiles. Big levels cost one data byte per
    cell instead of an object slot each, and the camera scrolls it. */
export interface Tilemap {
  sprite: string;
  cols: number;
  rows: number;
  /** cols·rows entries, row-major: 0 = empty, n = sheet cell n-1. */
  tiles: number[];
  /** Sheet cells (0-based) that block movement. */
  solid: number[];
  /** Draw blend (default 1, opaque). */
  blend?: number;
}

/** World size of a scene: its tilemap, else the screen. */
export function worldSize(p: Project, s: Scene): [number, number] {
  if (s.tilemap) return [Math.max(p.width, s.tilemap.cols * 8), Math.max(p.height, s.tilemap.rows * 8)];
  return [p.width, p.height];
}

/** Tilemap from text rows: each char maps through `legend` to a
    1-based tile (unknown chars and spaces are empty). */
export function tilesFromRows(rows: string[], legend: Record<string, number>): { cols: number; rows: number; tiles: number[] } {
  const cols = Math.max(...rows.map((r) => r.length));
  const tiles: number[] = [];
  for (const r of rows) for (let c = 0; c < cols; c++) tiles.push(legend[r[c] ?? " "] ?? 0);
  return { cols, rows: rows.length, tiles };
}

/** The def library, legacy-safe: pre-def projects simply have none. */
export function projectDefs(p: Project): ObjectDef[] {
  return p.objectDefs ?? [];
}

export interface NamedInput {
  id: string;
  /** Raw key code (32 = space, 27 = escape). */
  key: number;
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
  /** Leaves only: text drawn at the object (1–24 printable ASCII).
      A leaf with text and no sprite is a text object. Falls back to
      the template's label; text actions change it at runtime. */
  label?: string;
  /** Leaves only: start values for template variables (by name). */
  vars?: Record<string, number>;
  /** Leaves only: hitbox override (def leaves: default on the def). */
  mask?: HitBox;
  /** Leaves only: which cell of a sheet sprite to show (default 0). */
  cell?: number;
  /** Leaves only: mirror horizontally / vertically. */
  flipX?: boolean;
  flipY?: boolean;
  /** Leaves only: Varvara blend 0–15 (see DrawLook). */
  blend?: number;
  /** Leaves only: instance of ObjectDef. Every field above (except
      id/x/y, which are always instance state) falls back to the def
      when locally absent — explicit local values always win. */
  def?: string;
  /** Inline leaves only: this leaf's events (instances use their
      def's — a local list on an instance is a validation error). */
  events?: ObjectEvent[];
  /** Leaves only: fixed to the screen, ignores the camera. */
  hud?: boolean;
}

export interface Scene {
  id: string;
  /** Godot-like node tree: sprite leaves and subscene branches. */
  nodes: SceneNode[];
  /** Scene-level events (the level's "controller"): scene start,
      every frame, keys, mouse anywhere, timers, messages. */
  events?: ObjectEvent[];
  /** Spare object slots for spawn actions in this scene (default:
      16 when the project spawns anything, else 0). */
  pool?: number;
  /** Tile layer drawn under the objects; sets the world size. */
  tilemap?: Tilemap;
  /** Camera: keeps the first live instance of `follow` (a template
      id) centered, clamped to the world. Without it the view stays
      at the top-left. */
  camera?: { follow?: string };
}

export interface FlatLeaf extends SceneNode {
  /** Dotted instance path (board/sq_a1), unique per flattening. */
  path: string;
  /** Scene that defines this node (differs from the root for nodes
      inside subscenes) — inline objects are keyed by it. */
  home: string;
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
/** Cell/look fields of a node or object (sprite-independent part;
    the cell range is checked on flattened leaves, where the sprite is
    resolved). */
function validateLook(o: DrawLook & { cell?: number }, at: string): string[] {
  const errs: string[] = [];
  if (o.blend !== undefined && (!Number.isInteger(o.blend) || o.blend < 0 || o.blend > 15))
    errs.push(`${at}: blend must be 0–15`);
  if (o.cell !== undefined && (!Number.isInteger(o.cell) || o.cell < 0 || o.cell > 255))
    errs.push(`${at}: cell must be 0–255`);
  return errs;
}

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
          home: id,
          x: n.x + ox,
          y: n.y + oy,
          kind: n.kind ?? def?.kind ?? "static",
          sprite: n.sprite ?? def?.sprite ?? "",
          solid: n.solid ?? def?.solid,
          controls: n.controls ?? def?.controls,
          anim: n.anim ?? def?.anim,
          label: n.label ?? def?.label,
          mask: n.mask ?? def?.mask,
          cell: n.cell ?? def?.cell,
          flipX: n.flipX ?? def?.flipX,
          flipY: n.flipY ?? def?.flipY,
          blend: n.blend ?? def?.blend,
          hud: n.hud ?? def?.hud,
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
  /** Scene background: palette index 0–3 blitted over the whole
      screen every frame (draw_bg). Defaults to 0. */
  bg?: number;
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
  /** Named song loops (Phase 12). Absent = none yet; song blocks
      reference these by id. */
  songs?: SongDef[];
  /** Free-canvas block positions (Blocks view). Absent = cascade
      defaults; ignored by validation and emit. */
  layout?: CanvasLayout;
  /** Named u16 variables (Phase B). Absent = none yet; set/if
      blocks and snippets share the `var_<id>[0]` cells. */
  vars?: GameVar[];
  /** Visual only: raw top-level ETAL spliced into main.ux (custom.ux).
      May define any HOOKS fn (called when present); `import` lines are
      hoisted to the top of main.ux. */
  customCode?: string;
  /** Visual only: extra script modules, imported by main.ux in order. */
  scripts?: ScriptFile[];
  /** Visual only: frame ownership. Absent = engine. */
  loop?: LoopMode;
  /** The game draws its own mouse pointer, so the web build hides the
      browser's over the game (what native uxn always does). Off by
      default: engine-loop games don't draw one. */
  gameCursor?: boolean;
  /** Code only: the file set, passed through untouched. */
  codeFiles?: Record<string, string>;
  /** Code only: entry file (default main.ux). */
  entry?: string;
  updatedAt: number;
}

/** Generated identifiers custom code must not redeclare (engine loop).
    Public runtime state code may READ and WRITE: ox oy ot om ow oh
    oflags odef ocell ocount scene self other, var_<id>[0], iv_<id>[slot];
    everything private is prefixed e_. Only declarations are checked —
    uses are the point. The compiler remains the final arbiter. */
const RESERVED_EXACT = new Set([
  "ox", "oy", "ot", "om", "ow", "oh", "otw", "oth", "osw", "oflags", "odef", "osp", "ocell",
  "omx", "omy", "omw", "omh", "otx", "onv", "onf", "ogx", "ogy", "ogn", "oan", "oaf", "oak", "oad",
  "ocount", "scene", "self", "other", "scene_go", "start", "main", "on_frame", "on_key", "on_mouse", "sq32", "sg_on",
  "custom_setup", "custom_frame",
]);
const RESERVED_PREFIX = ["e_", "spr_", "var_", "iv_", "SC_"];
const RESERVED_RE = [/^oa[0-3]$/, /^st[0-3]$/, /^sg_(pos|wait|len|vol)\d$/, /^sgl[pl]\d$/];

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
    if ((HOOKS as readonly string[]).includes(name)) continue;
    if (RESERVED_EXACT.has(name) || RESERVED_PREFIX.some((p) => name.startsWith(p)) || RESERVED_RE.some((r) => r.test(name))) {
      errs.push(`custom code collides with generated name '${name}'`);
    }
  }
  return errs;
}

export const MAX_OBJECTS = 128;
const IDENT = /^[A-Za-z][A-Za-z0-9_]*$/;
/** Project ids are storage keys (slugs like `my-game-2`), never code. */
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

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
    migrateBehaviour(base);
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

type Raw = Record<string, unknown>;
const OLD_CMP_BTN: Record<string, ButtonName> = { up: "up", down: "down", left: "left", right: "right" };

/** v2 behaviour model: one home for behaviour (events), values instead
    of constants. Folds every older mechanism into events, in place:
    - scene click bindings → the object's click event (or a scene click
      event for nested/template objects), key bindings → scene key events
    - per-object tick scripts → step events, creation code → create
      events, scene frame code → a scene step event (all as Code
      actions; `slot` became `self`)
    - snippets + run blocks → Code actions with the snippet's text
    - button note blocks (they never did anything) are dropped
    - old if conditions {left, op, right} → {k: "cmp"} / {k: "held"}
    Idempotent: already-converted projects pass through unchanged. */
export function migrateBehaviour(base: Raw): void {
  const snippets = new Map(((base["snippets"] ?? []) as Raw[]).map((x) => [String(x["id"]), String(x["code"] ?? "")]));
  const code = (text: string): Block => ({ op: "code", code: text.replace(/\bslot\b/g, "self") });
  const operand = (o: Raw | undefined): Value => {
    if (!o) return 0;
    if (o["kind"] === "var") return { k: "var", name: String(o["name"]) };
    if (o["kind"] === "pos") return { k: "prop", prop: o["axis"] === "y" ? "y" : "x" };
    if (o["kind"] === "const") return Number(o["value"]) || 0;
    return 0;
  };
  const fixBlocks = (blocks: unknown): Block[] => {
    if (!Array.isArray(blocks)) return [];
    const out: Block[] = [];
    for (const raw of blocks as Raw[]) {
      if (!raw || typeof raw !== "object") continue;
      const op = raw["op"];
      if (op === "button") continue;
      if (op === "run") {
        out.push(code(snippets.get(String(raw["snippet"])) ?? ""));
        continue;
      }
      if (op === "code") {
        out.push(code(String(raw["code"] ?? "")));
        continue;
      }
      if (op === "if") {
        let cond = raw["cond"] as Raw | undefined;
        if (cond && !("k" in cond)) {
          const l = cond["left"] as Raw | undefined;
          const r = cond["right"] as Raw | undefined;
          if (l?.["kind"] === "btn" || r?.["kind"] === "btn") {
            const btn = (l?.["kind"] === "btn" ? l : r) as Raw;
            const other = (l?.["kind"] === "btn" ? r : l) as Raw | undefined;
            const held: Cond = { k: "held", button: OLD_CMP_BTN[String(btn["dir"])] ?? "up" };
            const wantDown = (cond["op"] === "eq") === (Number(other?.["value"] ?? 1) !== 0);
            cond = (wantDown ? held : { k: "not", c: held }) as unknown as Raw;
          } else cond = { k: "cmp", a: operand(l), op: cond["op"] ?? "eq", b: operand(r) } as unknown as Raw;
        }
        out.push({ op: "if", cond: cond as unknown as Cond, then: fixBlocks(raw["then"]), ...(raw["else"] ? { else: fixBlocks(raw["else"]) } : {}) });
        continue;
      }
      if (op === "repeat") {
        out.push({ ...(raw as unknown as Block), body: fixBlocks(raw["body"]) } as Block);
        continue;
      }
      if (op === "destroy") {
        const t = raw["target"];
        out.push(t === undefined || t === "self" ? { op: "destroy" } : typeof t === "string" && t.startsWith("def:") ? { op: "destroy", target: t } : { op: "destroy", target: "other" });
        continue;
      }
      out.push(raw as unknown as Block);
    }
    return out;
  };
  const fixEvents = (events: unknown): ObjectEvent[] => {
    if (!Array.isArray(events)) return [];
    return (events as Raw[]).map((e) => ({ ...(e as object), blocks: fixBlocks(e["blocks"]) }) as ObjectEvent);
  };
  let n = 0;
  const evId = (taken: ObjectEvent[]): string => {
    let id = `ev_m${n++}`;
    while (taken.some((e) => e.id === id)) id = `ev_m${n++}`;
    return id;
  };
  const addTo = (events: ObjectEvent[], trigger: EventTrigger, blocks: Block[], extra: Partial<ObjectEvent> = {}): void => {
    const same = events.find((e) => e.trigger === trigger && e.key === extra.key && e.button === extra.button && e.message === extra.message);
    if (same && trigger !== "key" && trigger !== "click") same.blocks.push(...blocks);
    else events.push({ id: evId(events), trigger, blocks, ...extra });
  };
  for (const d of (base["objectDefs"] ?? []) as Raw[]) {
    d["events"] = fixEvents(d["events"]);
    if (typeof d["tick"] === "string" && d["tick"].trim()) addTo(d["events"] as ObjectEvent[], "step", [code(d["tick"])]);
    delete d["tick"];
  }
  for (const sc of (base["scenes"] ?? []) as Raw[]) {
    const sEvents = fixEvents(sc["events"]);
    const nodes = (sc["nodes"] ?? []) as Raw[];
    for (const nd of nodes) {
      if (nd["scene"]) continue;
      nd["events"] = fixEvents(nd["events"]);
      if (typeof nd["tick"] === "string" && nd["tick"].trim()) {
        if (nd["def"]) addTo(sEvents, "step", [code(`( was ${String(nd["id"])}'s tick script )\n${nd["tick"]}`)]);
        else addTo(nd["events"] as ObjectEvent[], "step", [code(nd["tick"])]);
      }
      if (typeof nd["initCode"] === "string" && nd["initCode"].trim() && !nd["def"]) addTo(nd["events"] as ObjectEvent[], "create", [code(nd["initCode"])]);
      delete nd["tick"];
      delete nd["initCode"];
    }
    for (const c of (sc["clicks"] ?? []) as Raw[]) {
      const target = nodes.find((x) => x["id"] === c["object"] && !x["scene"] && !x["def"]);
      const go: Block = { op: "goto", scene: String(c["goto"]) };
      if (target) {
        const evs = (target["events"] ?? []) as ObjectEvent[];
        target["events"] = evs;
        evs.push({ id: evId(evs), trigger: "click", blocks: [go] });
      } else addTo(sEvents, "click", [go]);
    }
    for (const k of (sc["keys"] ?? []) as Raw[]) {
      addTo(sEvents, "key", [{ op: "goto", scene: String(k["goto"]) }], { key: String(k["input"] ?? "") });
    }
    if (typeof sc["frameCode"] === "string" && sc["frameCode"].trim()) addTo(sEvents, "step", [code(sc["frameCode"])]);
    for (const nd of nodes) {
      if (!nd["scene"] && !nd["def"] && Array.isArray(nd["events"]) && (nd["events"] as unknown[]).length === 0) delete nd["events"];
    }
    delete sc["clicks"];
    delete sc["keys"];
    delete sc["frameCode"];
    if (sEvents.length > 0) sc["events"] = sEvents;
    else delete sc["events"];
  }
  delete base["snippets"];
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
    for (const k of ((s as unknown as Raw)["keys"] ?? []) as Array<{ input?: string; key: number }>) {
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

/** Max steps per song voice. The live track buffers are 16 bytes per
    voice, so this is a RAM cap as much as a UI one: 4 voices x 16
    steps x 2 buffers = 128 bytes of main RAM. */
export const MAX_SONG_STEPS = 16;

/** A step is MIDI pitch 0–107; this is the rest marker lib/song.ux
    uses and what the emitter skips firing. */
export const SONG_REST = 127;

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

/** Scene overview data: every scene as a node, every scene change
    (go to / overlay actions in object and scene events) as a labeled
    edge. Broken scenes still list. Nodes come out BFS-ordered from
    the start scene. Pure: the map canvas renders this directly. */
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
  for (const e of sceneFlow(p)) {
    if (!sceneIds.has(e.to)) continue;
    const label = `${e.kind === "overlay" ? "⧉ " : ""}${e.trigger} ${e.via}`;
    const key = `${e.from}→${e.to}|${label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ from: e.from, to: e.to, label });
  }
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

/* ---- Scripts, hooks, standard library (the scripting surface) ---- */

/** File names the emitter owns; scripts can't take them. */
export const GENERATED_FILES = ["main.ux", "devices.ux", "custom.ux", "assets.ux"] as const;
const SCRIPT_PATH = /^[A-Za-z][A-Za-z0-9_]*\.ux$/;
export const MAX_SCRIPTS = 32;
const MAX_SCRIPT_BYTES = 64 * 1024;
/** Script loop: the only names the engine emits besides assets. */
const SCRIPT_RESERVED_EXACT = new Set(["start", "main", "on_frame", "on_key", "on_mouse", "snd_wave"]);
const SCRIPT_RESERVED_PREFIX = ["spr_", "snd_", "var_", "KEY_", "SPR_", "scn_", "SCN_", "draw_scene_"];

/** Bytes per scn_<scene> row (script loop): x hi, x lo, y hi, y lo,
    sprite index (SPR_<ID>), cell, Screen.sprite mode, draw kind. */
export const SCN_ROW = 8;

/** Script-loop scene module: a layout table code can read and a
    draw fn, for one scene. Rows are the flattened leaves (subscenes
    included, offsets applied) in hierarchy order. The draw fn walks
    the table and dispatches on a per-scene "kind" (sprite + cell +
    mode), so the ROM holds one tile-write block per kind instead of
    one per node — a 64-square board costs two blocks. */
function emitSceneModule(p: Project, sceneId: string): { code: string[]; sprites: Set<string> } {
  const leaves = flattenScene(p, sceneId);
  const spriteIdx = new Map(p.sprites.map((x, i) => [x.id, i] as const));
  const spriteById = new Map(p.sprites.map((x) => [x.id, x] as const));
  const kinds: Array<{ sprite: Sprite; cell: number; mode: number; flipX: boolean; flipY: boolean }> = [];
  const kindOf = new Map<string, number>();
  const rows: number[] = [];
  for (const o of leaves) {
    const spr = spriteById.get(o.sprite);
    if (!spr) continue;
    const cell = o.cell ?? 0;
    const mode = lookMode(o);
    const key = `${o.sprite}|${cell}|${mode}`;
    if (!kindOf.has(key)) {
      kindOf.set(key, kinds.length);
      kinds.push({ sprite: spr, cell, mode, flipX: !!o.flipX, flipY: !!o.flipY });
    }
    rows.push(o.x >> 8, o.x & 255, o.y >> 8, o.y & 255, spriteIdx.get(o.sprite) ?? 0, cell, mode, kindOf.get(key) as number);
  }
  const id = sceneId;
  const n = rows.length / SCN_ROW;
  const code: string[] = [];
  code.push(`( scene '${id}': ${n} nodes from the Scene editor. scn_${id} rows are SCN_ROW bytes: x hi, x lo, y hi, y lo, sprite (SPR_*), cell, Screen.sprite mode, draw kind. draw_scene_${id}() paints them all. )`);
  code.push(`SCN_${id.toUpperCase()}_COUNT :: ${n};`);
  if (n === 0) {
    code.push(`draw_scene_${id} :: fn() {`, `}`, ``);
    return { code, sprites: new Set() };
  }
  code.push(`data scn_${id} = [${rows.join(", ")}];`);
  code.push(`draw_scene_${id} :: fn() {`);
  code.push(`    r: u16 = 0;`);
  code.push(`    x: u16 = 0;`);
  code.push(`    y: u16 = 0;`);
  code.push(`    while r < ${rows.length} {`);
  code.push(`        x = scn_${id}[r];`);
  code.push(`        x = (x << 8) | scn_${id}[r + 1];`);
  code.push(`        y = scn_${id}[r + 2];`);
  code.push(`        y = (y << 8) | scn_${id}[r + 3];`);
  kinds.forEach((kd, ki) => {
    // Kind read in place (no local): every fn local is a zero-page
    // byte for the whole program, and games run near the 256 cap.
    code.push(`        ${ki === 0 ? "if" : "} elif"} scn_${id}[r + 7] == ${ki} {`);
    const [tw, th] = cellTiles(kd.sprite);
    for (let ty = 0; ty < th; ty++) {
      for (let tx = 0; tx < tw; tx++) {
        const dx = kd.flipX ? tw - 1 - tx : tx;
        const dy = kd.flipY ? th - 1 - ty : ty;
        const off = cellTileOffset(kd.sprite, kd.cell, tx, ty);
        code.push(`            Screen.x = x${dx ? ` + ${dx * TILE_PX}` : ""};`);
        code.push(`            Screen.y = y${dy ? ` + ${dy * TILE_PX}` : ""};`);
        code.push(`            Screen.addr = &spr_${kd.sprite.id}${off ? ` + ${off}` : ""};`);
        code.push(`            Screen.sprite = ${kd.mode};`);
      }
    }
  });
  code.push(`        }`);
  code.push(`        r = r + ${SCN_ROW};`);
  code.push(`    }`);
  code.push(`}`);
  code.push(``);
  return { code, sprites: new Set(kinds.map((k) => k.sprite.id)) };
}

export function loopOf(p: Project): LoopMode {
  return p.loop === "script" ? "script" : "engine";
}

/** custom.ux + every script, as (file, code) pairs in import order. */
export function userSources(p: Project): Array<{ file: string; code: string }> {
  return [{ file: "custom.ux", code: p.customCode ?? "" }, ...(p.scripts ?? []).map((s) => ({ file: s.path, code: s.code }))];
}

/** Hooks defined anywhere in the user's code (top-level `name ::`). */
export function definedHooks(p: Project): Set<HookName> {
  const all = userSources(p)
    .map((x) => x.code)
    .join("\n");
  return new Set(HOOKS.filter((h) => new RegExp(`^\\s*${h}\\s*::`, "m").test(all)));
}

/** Standard-library modules this project ships (transitive closure
    of every user import that names one). */
export function usedStdlib(p: Project): string[] {
  const own = new Set((p.scripts ?? []).map((s) => s.path));
  const roots = userSources(p).flatMap((x) => importsOf(x.code));
  return stdlibClosure(roots, own);
}

/** Unindented top-level declarations only (locals don't collide). */
function topLevelNames(code: string): string[] {
  const out: string[] = [];
  let depth = 0;
  for (const raw of code.split("\n")) {
    const line = raw.split("( ")[0];
    if (depth === 0) {
      const m =
        line.match(/^(?:buffer|data|device|group|struct|macro)\s+([A-Za-z][A-Za-z0-9_]*)/) ??
        line.match(/^([A-Za-z][A-Za-z0-9_]*)\s*:/);
      if (m) out.push(m[1]);
    }
    for (const ch of line) {
      if (ch === "{") depth++;
      else if (ch === "}") depth = Math.max(0, depth - 1);
    }
  }
  return out;
}

function scriptLoopCollisions(file: string, code: string): string[] {
  const errs: string[] = [];
  for (const name of topLevelNames(code)) {
    if (SCRIPT_RESERVED_EXACT.has(name) || SCRIPT_RESERVED_PREFIX.some((x) => name.startsWith(x)))
      errs.push(`${file}: '${name}' is generated by the script loop — rename it`);
  }
  return errs;
}

export function validateScripts(p: Project): string[] {
  const errs: string[] = [];
  if (p.loop !== undefined && p.loop !== "engine" && p.loop !== "script") errs.push(`bad loop '${String(p.loop)}'`);
  const scripts = p.scripts ?? [];
  if (scripts.length > MAX_SCRIPTS) errs.push(`at most ${MAX_SCRIPTS} scripts`);
  const paths = new Set<string>();
  for (const sc of scripts) {
    if (!SCRIPT_PATH.test(sc.path)) errs.push(`bad script name '${sc.path}' (letters, digits, _ and .ux)`);
    else if ((GENERATED_FILES as readonly string[]).includes(sc.path))
      errs.push(`script '${sc.path}' would replace a generated file`);
    else if (sc.path in STDLIB) errs.push(`script '${sc.path}' shadows the library module of that name`);
    if (paths.has(sc.path)) errs.push(`duplicate script '${sc.path}'`);
    paths.add(sc.path);
    if (typeof sc.code !== "string") errs.push(`script '${sc.path}' has no code`);
    else if (sc.code.length > MAX_SCRIPT_BYTES) errs.push(`script '${sc.path}' exceeds 64KB`);
  }
  for (const { file, code } of userSources(p)) {
    for (const imp of importsOf(code)) {
      if (imp === "devices.ux" || paths.has(imp) || imp in STDLIB) continue;
      if (imp === "assets.ux" && loopOf(p) === "script") continue;
      errs.push(`${file}: import "${imp}" not found (add a script or pick a library module)`);
    }
  }
  const loop = loopOf(p);
  const hooks = definedHooks(p);
  if (loop === "script") {
    if (!hooks.has("custom_frame")) errs.push("script loop needs a custom_frame() hook — it runs every frame");
    if (hooks.has("custom_draw")) errs.push("custom_draw() is engine-loop only — draw from custom_frame() in the script loop");
    for (const { file, code } of userSources(p)) errs.push(...scriptLoopCollisions(file, code));
  } else {
    for (const sc of scripts) {
      for (const e of validateCustomCode(sc.code)) errs.push(`${sc.path}: ${e}`);
    }
    for (const mod of usedStdlib(p)) {
      const names = new Set(moduleExports(STDLIB[mod]).map((x) => x.name));
      for (const name of names) {
        if (validateCustomCode(`${name}: u8 = 0;`).length > 0)
          errs.push(`library ${mod} declares '${name}', which the engine loop owns — switch to the script loop to import it`);
      }
    }
  }
  return errs;
}

export function validateProject(p: Project): string[] {
  const errs: string[] = [];
  if (!p.name || /["\\]/.test(p.name)) errs.push("name must be non-empty without quotes/backslashes");
  if (!p.author || /["\\]/.test(p.author)) errs.push("author must be non-empty without quotes/backslashes");
  if (p.kind !== "visual" && p.kind !== "code") errs.push(`bad kind '${(p as { kind: unknown }).kind}'`);
  if (!PROJECT_ID.test(p.id)) errs.push(`bad project id '${p.id}'`);
  const theme = p.theme ?? { r: THEME_R, g: THEME_G, b: THEME_B };
  for (const [ch, v] of [["r", theme.r], ["g", theme.g], ["b", theme.b]] as const) {
    if (!Number.isInteger(v) || v < 0 || v > 65535) errs.push(`theme.${ch} must be 0–65535`);
  }
  if (p.bg !== undefined && (!Number.isInteger(p.bg) || p.bg < 0 || p.bg > 3)) {
    errs.push("bg must be a palette index 0–3");
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
  if (p.customCode && (p.loop ?? "engine") === "engine") errs.push(...validateCustomCode(p.customCode));
  errs.push(...validateScripts(p));
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
    // Node footprint (one cell for sheets): masks, swaps and frames
    // all compare what a node actually shows.
    spriteDims.set(s.id, s.cell ? [s.cell.w, s.cell.h] : [w, h]);
    if (s.cell !== undefined) {
      const { w: cw, h: ch } = s.cell;
      if (!Number.isInteger(cw) || !Number.isInteger(ch) || cw < 1 || ch < 1 || w % cw !== 0 || h % ch !== 0)
        errs.push(`sprite '${s.id}': sheet cell ${cw}×${ch} must evenly divide the ${w}×${h} sprite`);
    }
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
  const vars = p.vars ?? [];
  const varIds = new Set(vars.map((v) => v.id));
  if (varIds.size !== vars.length) errs.push("duplicate variable id");
  for (const v of vars) {
    if (!IDENT.test(v.id)) errs.push(`bad variable id '${v.id}'`);
    if (!u16(v.init)) errs.push(`variable '${v.id}': init must be 0–65535`);
  }
  const songs = p.songs ?? [];
  const songIds = new Set(songs.map((s) => s.id));
  if (songIds.size !== songs.length) errs.push("duplicate song id");
  for (const s of songs) {
    if (!IDENT.test(s.id)) errs.push(`bad song id '${s.id}'`);
    if (!Array.isArray(s.tracks) || s.tracks.length !== 4) {
      errs.push(`song '${s.id}': needs exactly 4 tracks`);
      continue;
    }
    let notes = 0;
    s.tracks.forEach((tr, vi) => {
      if (!Number.isInteger(tr.vol) || tr.vol < 0 || tr.vol > 255)
        errs.push(`song '${s.id}' voice ${vi}: vol must be 0–255`);
      if (!Array.isArray(tr.notes) || tr.notes.length > MAX_SONG_STEPS)
        errs.push(`song '${s.id}' voice ${vi}: at most ${MAX_SONG_STEPS} steps`);
      for (const n of tr.notes ?? []) {
        if (!Number.isInteger(n.pitch) || !((n.pitch >= 0 && n.pitch <= 107) || n.pitch === SONG_REST))
          errs.push(`song '${s.id}' voice ${vi}: pitch must be 0–107 or 127 (rest)`);
        if (!Number.isInteger(n.len) || n.len < 1 || n.len > 255)
          errs.push(`song '${s.id}' voice ${vi}: len must be 1–255`);
        notes++;
      }
    });
    if (notes === 0) errs.push(`song '${s.id}' has no notes`);
  }
  const defs = projectDefs(p);
  const defIds = new Set(defs.map((d) => d.id));
  if (defIds.size !== defs.length) errs.push("duplicate object id");
  for (const d of defs) {
    if (!IDENT.test(d.id)) errs.push(`bad object id '${d.id}'`);
    if (d.sprite ? !spriteIds.has(d.sprite) : !d.label) errs.push(d.sprite ? `object '${d.id}': unknown sprite '${d.sprite}'` : `object '${d.id}': needs a sprite or text`);
    if (d.label !== undefined && (d.label.length === 0 || d.label.length > 24 || /[^\x20-\x7e]/.test(d.label)))
      errs.push(`object '${d.id}': text must be 1–24 printable ASCII chars`);
    if (d.kind !== "player" && d.kind !== "static" && d.kind !== "movable")
      errs.push(`object '${d.id}': bad kind '${(d as { kind: unknown }).kind}'`);
    if (d.kind === "movable" && !d.solid) errs.push(`object '${d.id}': movable requires solid`);
    if (d.controls && d.kind !== "player") errs.push(`object '${d.id}': controls require player kind`);
    if (d.anim && !animIds.has(d.anim)) errs.push(`object '${d.id}': unknown animation '${d.anim}'`);
    errs.push(...validateLook(d, `object '${d.id}'`));
    if (d.mask) {
      const tiles = spriteDims.get(d.sprite);
      const dims: [number, number] | undefined = tiles && [tiles[0] * TILE_PX, tiles[1] * TILE_PX];
      if (dims && !maskFits(d.mask, dims))
        errs.push(`object '${d.id}': mask must fit inside its ${dims[0]}×${dims[1]}px sprite`);
    }
  }
  if (sceneIds.size !== p.scenes.length) errs.push("duplicate scene id");
  if (!sceneIds.has(p.start)) errs.push(`start scene '${p.start}' missing`);
  if (!PROJECT_ID.test(p.id)) errs.push(`bad project id '${p.id}'`);
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
      if (!isBranch && !o.sprite && !o.def && !o.label) errs.push(`node '${o.id}': needs a sprite, text or an object template`);
      if (!isBranch) {
        if (o.sprite && !spriteIds.has(o.sprite)) errs.push(`node '${o.id}': unknown sprite '${o.sprite}'`);
        if (o.def && !defIds.has(o.def)) errs.push(`node '${o.id}': unknown object '${o.def}'`);
        if (o.anim && !animIds.has(o.anim)) errs.push(`node '${o.id}': unknown animation '${o.anim}'`);
      }
      if (o.label !== undefined && (typeof o.label !== "string" || o.label.length === 0 || o.label.length > 24 || /[^\x20-\x7e]/.test(o.label)))
        errs.push(`node '${o.id}': label must be 1–24 printable ASCII chars`);
      if (o.kind !== undefined && o.kind !== "player" && o.kind !== "static" && o.kind !== "movable")
        errs.push(`node '${o.id}': bad kind '${(o as { kind: unknown }).kind}'`);
      errs.push(...validateLook(o, `node '${o.id}'`));
    }
    // Flattened view: defs resolved, so physics rules, size matches
    // and caps all check effective values (a def can supply any of
    // them). Paths pinpoint nested leaves.
    try {
      const flat = flattenScene(p, s.id);
      const spriteById = new Map(p.sprites.map((x) => [x.id, x]));
      for (const o of flat) {
        const spr = spriteById.get(o.sprite);
        if (spr && (o.cell ?? 0) >= cellCount(spr))
          errs.push(`scene '${s.id}': '${o.path}' shows cell ${o.cell} but sprite '${spr.id}' has ${cellCount(spr)}`);
        if (spr?.cell && o.anim) errs.push(`scene '${s.id}': '${o.path}' animates a sheet sprite — animations swap whole sprites`);
      }
      for (const o of flat) {
        if (o.mask) {
          const tiles = spriteDims.get(o.sprite);
          const dims: [number, number] | undefined = tiles && [tiles[0] * TILE_PX, tiles[1] * TILE_PX];
          if (dims && !maskFits(o.mask, dims))
            errs.push(`scene '${s.id}': '${o.path}' hitbox must fit inside its ${dims[0]}×${dims[1]}px sprite`);
        }
        if (o.sprite && !spriteIds.has(o.sprite)) errs.push(`scene '${s.id}': '${o.path}' unknown sprite '${o.sprite}'`);
        if (!o.sprite && !o.label) errs.push(`scene '${s.id}': '${o.path}' needs a sprite or text`);
        if (o.anim && !animIds.has(o.anim)) errs.push(`scene '${s.id}': '${o.path}' unknown animation '${o.anim}'`);
        for (const [name, val] of Object.entries(o.vars ?? {})) {
          if (!u16(val)) errs.push(`scene '${s.id}': '${o.path}' variable '${name}' must be 0–65535`);
          const def = o.def ? defs.find((d) => d.id === o.def) : undefined;
          if (!def?.vars?.some((v) => v.id === name)) errs.push(`scene '${s.id}': '${o.path}' has no variable '${name}'`);
        }
      }
    } catch (e) {
      errs.push(`scene '${s.id}': ${(e as Error).message}`);
    }
    if (s.pool !== undefined && (!Number.isInteger(s.pool) || s.pool < 0 || s.pool > MAX_OBJECTS))
      errs.push(`scene '${s.id}': spawn slots must be 0–${MAX_OBJECTS}`);
  }
  errs.push(...validateBehaviour(p));
  return errs;
}

export const DEVICES_ENGINE = `( generated devices: System + Screen + Controller + Mouse. )
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

export function audioBlock(name: string, page: number): string {
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

export const SQ32 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255];

export function emitProject(p: Project): Record<string, string> {
  const errs = validateProject(p);
  if (errs.length > 0) throw new Error(`invalid project: ${errs.join("; ")}`);
  if (p.kind === "code") return { ...(p.codeFiles ?? {}) };
  // import lines in custom.ux hoist to the top of main.ux; the rest
  // splices where it always did (old projects have none: same bytes).
  const customLines = (p.customCode ?? "").split("\n");
  const hoisted = customLines.filter((l) => /^\s*import\s+"/.test(l)).map((l) => l.trim());
  const custom = customLines
    .filter((l) => !/^\s*import\s+"/.test(l))
    .join("\n")
    .trim();
  const hooks = definedHooks(p);
  if (loopOf(p) === "script") return emitScriptProject(p, custom, hoisted, hooks);
  return emitEngineProject(p, custom, moduleImports([], hoisted), moduleImports(p.scripts ?? [], hoisted), hooks, moduleFiles(p));
}

/** Import lines for `scripts` (or `hoisted` lines when scripts is
    empty), skipping devices.ux and anything in `already`. */
function moduleImports(scripts: ScriptFile[], already: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>(scripts.length > 0 ? ["import \"devices.ux\"", ...already] : ["import \"devices.ux\""]);
  for (const line of scripts.length > 0 ? scripts.map((sc) => `import "${sc.path}"`) : already) {
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}

/** Script modules + the library modules they reach, as file entries. */
function moduleFiles(p: Project): Record<string, string> {
  const files: Record<string, string> = {};
  for (const sc of p.scripts ?? []) files[sc.path] = sc.code;
  for (const mod of usedStdlib(p)) files[mod] = STDLIB[mod];
  return files;
}

const DATETIME_DEVICE = `device DateTime 192 {
    year: 2
    month: 1
    day: 1
    hour: 1
    minute: 1
    second: 1
    dotw: 1
    doty: 2
    isdst: 1
}
`;

/** Script loop: every standard device is declared (unused devices
    cost nothing and don't warn), so code can touch any of them. */
function emitScriptDevices(): string {
  let s = DEVICES_ENGINE.replace("( generated devices: System + Screen + Controller + Mouse. )", "( generated devices (script loop): System, Screen, Controller, Mouse, Audio0-3, DateTime. )");
  for (let v = 0; v < 4; v++) s += audioBlock(`Audio${v}`, 48 + v * 16);
  return s + DATETIME_DEVICE;
}

/** Engine symbols a script may name, per mode. Shared by the emitter
    (what to export) and the Code page reference panel (what to show). */
export function scriptAssetNames(p: Project): { sprites: string[]; sounds: string[]; vars: string[]; inputs: string[]; scenes: string[] } {
  return {
    scenes: [...p.scenes].map((x) => x.id).sort(),
    sprites: [...p.sprites].map((x) => x.id).sort(),
    sounds: [...(p.sounds ?? [])].map((x) => x.id).sort(),
    vars: [...(p.vars ?? [])].map((x) => x.id).sort(),
    inputs: [...p.inputs].map((x) => x.id).sort(),
  };
}

/** Script-loop lowering: no scene runtime at all. The engine boots
    (theme, screen, variables), hands every frame to custom_frame(),
    routes the key/mouse vectors to their hooks, and exports only the
    assets the code actually names — unreferenced data would warn,
    and warning-free assembly is a tested property. */
function emitScriptProject(p: Project, custom: string, hoisted: string[], hooks: Set<HookName>): Record<string, string> {
  const all = userSources(p)
    .map((x) => x.code)
    .join("\n");
  const named = (sym: string): boolean => new RegExp(`(^|[^A-Za-z0-9_])${sym}($|[^A-Za-z0-9_])`).test(all);
  // assets.ux comes first so every script and hook can use it
  // (globals must be declared before use).
  const assets: string[] = [];
  assets.push(`( generated by uxn-forge: the assets your scripts name. Do not edit — repaint sprites, retune sounds, lay out scenes and set variable inits in the studio. )`);
  assets.push(`import "devices.ux"`);
  assets.push(``);
  // Scenes the code names (draw_scene_<id>, scn_<id>, SCN_<ID>_COUNT)
  // ship as modules; the sprites they draw ship with them.
  const sceneMods = [...p.scenes]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .filter((sc) => named(`draw_scene_${sc.id}`) || named(`scn_${sc.id}`) || named(`SCN_${sc.id.toUpperCase()}_COUNT`))
    .map((sc) => emitSceneModule(p, sc.id));
  const sceneSprites = new Set(sceneMods.flatMap((m) => [...m.sprites]));
  for (const o of [...p.sprites].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (named(`spr_${o.id}`) || sceneSprites.has(o.id)) assets.push(`data spr_${o.id} = [${spriteToPlanar(o).join(", ")}];`);
  }
  // Sprite indices for scene rows (constants cost nothing unused).
  if (sceneMods.length > 0 || p.sprites.some((o) => named(`SPR_${o.id.toUpperCase()}`))) {
    p.sprites.forEach((o, i) => assets.push(`SPR_${o.id.toUpperCase()} :: ${i};`));
  }
  const sounds = [...(p.sounds ?? [])].sort((a, b) => (a.id < b.id ? -1 : 1)).filter((x) => named(`snd_${x.id}`));
  if (sounds.length > 0) assets.push(`data snd_wave = [${SQ32.join(", ")}];`);
  const vars = [...(p.vars ?? [])].sort((a, b) => (a.id < b.id ? -1 : 1)).filter((v) => named(`var_${v.id}`));
  for (const v of vars) assets.push(`buffer var_${v.id}[1]: u16;`);
  for (const inp of [...p.inputs].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    assets.push(`KEY_${inp.id.toUpperCase()} :: ${inp.key};`);
  }
  assets.push(``);
  if (sceneMods.length > 0) {
    assets.push(`SCN_ROW :: ${SCN_ROW};`);
    assets.push(``);
    for (const m of sceneMods) assets.push(...m.code);
  }
  for (const snd of sounds) {
    assets.push(`snd_${snd.id} :: fn() {`);
    snd.voices.forEach((v, vi) => {
      if (vi >= 4 || v.vol <= 0) return;
      assets.push(`    Audio${vi}.addr = &snd_wave;`);
      assets.push(`    Audio${vi}.length = 32;`);
      assets.push(`    Audio${vi}.volume = ${v.vol};`);
      assets.push(`    Audio${vi}.adsr = 4369;`);
      assets.push(`    Audio${vi}.pitch = ${128 + v.note};`);
    });
    assets.push(`}`);
    assets.push(``);
  }
  const out: string[] = [];
  out.push(`( generated by uxn-forge from project '${p.name}' — script loop, do not edit. )`);
  out.push(`import "devices.ux"`);
  out.push(`import "assets.ux"`);
  for (const line of moduleImports([], hoisted)) if (line !== `import "assets.ux"`) out.push(line);
  for (const line of moduleImports(p.scripts ?? [], [...hoisted, `import "assets.ux"`])) out.push(line);
  out.push(``);
  out.push(`meta { title: "${p.name}", author: "${p.author}" }`);
  out.push(``);
  if (custom) {
    out.push(`( --- custom.ux : hooks + top-level declarations --- )`);
    out.push(custom);
    out.push(``);
  }
  out.push(`on_frame :: event() {`);
  out.push(`    custom_frame();`);
  out.push(`}`);
  out.push(``);
  if (hooks.has("custom_key")) {
    out.push(`on_key :: event() {`);
    out.push(`    custom_key();`);
    out.push(`}`);
    out.push(``);
  }
  if (hooks.has("custom_mouse")) {
    out.push(`on_mouse :: event() {`);
    out.push(`    custom_mouse();`);
    out.push(`}`);
    out.push(``);
  }
  const theme = p.theme ?? { r: THEME_R, g: THEME_G, b: THEME_B };
  out.push(`start :: fn() {`);
  out.push(`    System.r = ${theme.r};`);
  out.push(`    System.g = ${theme.g};`);
  out.push(`    System.b = ${theme.b};`);
  out.push(`    Screen.width = ${p.width};`);
  out.push(`    Screen.height = ${p.height};`);
  out.push(`    Screen.x = 0;`);
  out.push(`    Screen.y = 0;`);
  out.push(`    Screen.pixel = ${128 | ((p.bg ?? 0) & 3)};`);
  for (const v of vars) out.push(`    var_${v.id}[0] = ${(p.vars ?? []).find((x) => x.id === v.id)?.init ?? 0};`);
  if (hooks.has("custom_setup")) out.push(`    custom_setup();`);
  out.push(`    Screen.vector = &on_frame;`);
  if (hooks.has("custom_key")) out.push(`    Controller.vector = &on_key;`);
  if (hooks.has("custom_mouse")) out.push(`    Mouse.vector = &on_mouse;`);
  out.push(`}`);
  out.push(``);
  out.push(`main :: event() {`);
  out.push(`    start();`);
  out.push(`}`);
  out.push(``);
  return { "devices.ux": emitScriptDevices(), "assets.ux": assets.join("\n"), "main.ux": out.join("\n"), ...moduleFiles(p) };
}

/** custom.ux for a fresh script-loop project: a sprite you steer
    with the arrows. Small on purpose — every line is the contract. */
export const SCRIPT_STARTER = `( Script loop: this code owns every frame. The engine already set
  the palette and screen size; your studio assets are named
  spr_<sprite>, snd_<sound>(), var_<variable>[0] and KEY_<INPUT>.
  Hooks: custom_setup (boot), custom_frame (every frame, required),
  custom_key / custom_mouse (input vectors). Split code into more
  scripts with + and import library modules by name. )
import "screen.ux"

px: u16 = 32;
py: u16 = 32;

custom_frame :: fn() {
    b: u8 = Controller.button;
    if b & 16 != 0 { py = py - 1; }
    if b & 32 != 0 { py = py + 1; }
    if b & 64 != 0 { px = px - 1; }
    if b & 128 != 0 { px = px + 1; }
    clear(128);
    blit(px, py, &spr_hero, 129);
}
`;

/** A fresh script module: imports what most scripts need. */
export function scriptTemplate(path: string): string {
  return `( ${path} — imported by main.ux. Put fns, globals and data here;
  call them from the hooks in custom.ux or from other scripts. )
import "devices.ux"
`;
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
          events: [{ id: "ev_click", trigger: "click", blocks: [{ op: "play", sound: "blip" }, { op: "goto", scene: "play" }] }],
        },
        { id: "wall", x: 64, y: 64, sprite: "wall", kind: "static", solid: true },
        { id: "coin", x: 96, y: 96, sprite: "coin", kind: "movable", solid: true, anim: "spin" },
        { id: "hint", x: 8, y: 8, label: "SPACE: PLAY" },
      ],
      events: [{ id: "ev_jump", trigger: "key", key: "jump", blocks: [{ op: "goto", scene: "play" }] }],
    },
    {
      id: "play",
      nodes: [{ id: "hero", x: 8, y: 8, sprite: "hero", kind: "player", controls: true }],
      events: [{ id: "ev_back", trigger: "key", key: "back", blocks: [{ op: "goto", scene: "title" }] }],
    },
  ],
};
