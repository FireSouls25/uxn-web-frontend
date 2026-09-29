/* Project → ETAL emitter.
   A low-code project (scenes of 8px objects + click/key bindings that
   switch scenes, physics flags, sprite-library animations, boot jingle)
   lowers to dependency-free ETAL: two files, no imports beyond siblings,
   only constructs the backend compiler accepts. Sprites are 8×8 2bpp
   (16 planar bytes, channel one then channel two — the .chr layout),
   blitted with mode 129 (2bpp, blend-1 identity: all four palette
   colors addressable, opaque). Deterministic by construction: sorted
   ids, fixed 16-slot pool, literal everything. */

import { pixelsToPlanar, monoToPixels } from "./palette";

export interface Sprite {
  id: string;
  /** 64 color indices 0–3, row-major. */
  pixels: number[];
}

export interface Animation {
  id: string;
  /** Sprite ids, played in order. */
  frames: string[];
  /** Ticks per frame (60Hz frames). */
  rate: number;
  loop: boolean;
}

export interface SceneObject {
  id: string;
  x: number;
  y: number;
  /** Sprite id from the project library. */
  sprite: string;
  /** Blocks the player (AABB, 8px). */
  solid?: boolean;
  /** Solid + pushable by the player when the landing cell is free. */
  movable?: boolean;
  /** Marks the player avatar (one per scene at most). */
  player?: boolean;
  /** Keyboard dpad drives this object (requires player). */
  controls?: boolean;
  /** Animation id from the project library. */
  anim?: string;
}

export interface ClickBinding {
  object: string;
  goto: string;
}

export interface KeyBinding {
  /** Controller.key code (32 = space, 27 = escape). */
  key: number;
  goto: string;
}

export interface Scene {
  id: string;
  objects: SceneObject[];
  clicks: ClickBinding[];
  keys: KeyBinding[];
}

export interface Voice {
  /** MIDI note 0–107 (Uxn pitch bytes). */
  note: number;
  /** 0 = silent. */
  vol: number;
}

export interface Project {
  id: string;
  name: string;
  author: string;
  width: number;
  height: number;
  start: string;
  scenes: Scene[];
  /** Shared 8×8 2bpp sprite library. */
  sprites: Sprite[];
  /** Frame collections over sprite ids. */
  anims: Animation[];
  /** Up to 4 voices, played once on boot. Absent = silent. */
  sound?: { voices: Voice[] };
  updatedAt: number;
}

export const MAX_OBJECTS = 16;
const IDENT = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Upgrade a pre-library project: inline 1bpp tiles become sprites. */
export function migrateProject(raw: Record<string, unknown>): Project {
  const p = { ...(raw as object) } as Record<string, unknown>;
  if (Array.isArray(p["sprites"]) && Array.isArray(p["anims"])) {
    return {
      sound: { voices: [] },
      updatedAt: 0,
      ...(p as object),
    } as Project;
  }
  const sprites: Sprite[] = [];
  const scenes = ((p["scenes"] ?? []) as Array<Record<string, unknown>>).map((s) => {
    const sid = String(s["id"] ?? "scene");
    const objects = ((s["objects"] ?? []) as Array<Record<string, unknown>>).map((o) => {
      const oid = String(o["id"] ?? "obj");
      const tile = o["tile"];
      const pixels =
        Array.isArray(tile) && tile.length === 8
          ? monoToPixels((tile as unknown[]).map((b) => Number(b)))
          : Array<number>(64).fill(1);
      const spriteId = `${sid}_${oid}`.replace(/[^A-Za-z0-9_]/g, "_");
      if (!sprites.some((x) => x.id === spriteId)) sprites.push({ id: spriteId, pixels });
      const next = { ...(o as object) } as Record<string, unknown>;
      delete next["tile"];
      return { ...next, sprite: spriteId } as SceneObject;
    });
    return { ...(s as object), objects } as Scene;
  });
  return {
    id: typeof p["id"] === "string" ? (p["id"] as string) : "demo",
    name: typeof p["name"] === "string" ? (p["name"] as string) : "Migrated",
    author: typeof p["author"] === "string" ? (p["author"] as string) : "uxn-forge",
    width: typeof p["width"] === "number" ? (p["width"] as number) : 128,
    height: typeof p["height"] === "number" ? (p["height"] as number) : 128,
    start: typeof p["start"] === "string" ? (p["start"] as string) : (scenes[0]?.id ?? "main"),
    scenes,
    sprites,
    anims: [],
    sound: (p["sound"] as Project["sound"]) ?? { voices: [] },
    updatedAt: 0,
  };
}

function u16(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 65535;
}

export function validateProject(p: Project): string[] {
  const errs: string[] = [];
  if (!p.name || /["\\]/.test(p.name)) errs.push("name must be non-empty without quotes/backslashes");
  if (!p.author || /["\\]/.test(p.author)) errs.push("author must be non-empty without quotes/backslashes");
  if (!u16(p.width) || !u16(p.height) || p.width === 0 || p.height === 0)
    errs.push("width/height must be 1–65535");
  const sceneIds = new Set(p.scenes.map((s) => s.id));
  const spriteIds = new Set(p.sprites.map((s) => s.id));
  if (spriteIds.size !== p.sprites.length) errs.push("duplicate sprite id");
  for (const s of p.sprites) {
    if (!IDENT.test(s.id)) errs.push(`bad sprite id '${s.id}'`);
    if (s.pixels.length !== 64 || s.pixels.some((v) => v !== 0 && v !== 1 && v !== 2 && v !== 3))
      errs.push(`sprite '${s.id}': needs 64 pixels of 0–3`);
  }
  const animIds = new Set(p.anims.map((a) => a.id));
  if (animIds.size !== p.anims.length) errs.push("duplicate animation id");
  for (const a of p.anims) {
    if (!IDENT.test(a.id)) errs.push(`bad animation id '${a.id}'`);
    if (a.frames.length === 0 || a.frames.length > 16) errs.push(`animation '${a.id}': 1–16 frames`);
    for (const f of a.frames) if (!spriteIds.has(f)) errs.push(`animation '${a.id}': unknown sprite '${f}'`);
    if (!Number.isInteger(a.rate) || a.rate < 1 || a.rate > 255)
      errs.push(`animation '${a.id}': rate must be 1–255`);
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
    if (s.objects.length > MAX_OBJECTS) errs.push(`scene '${s.id}' has >${MAX_OBJECTS} objects`);
    const objIds = new Set(s.objects.map((o) => o.id));
    if (objIds.size !== s.objects.length) errs.push(`scene '${s.id}': duplicate object id`);
    for (const o of s.objects) {
      if (!IDENT.test(o.id)) errs.push(`bad object id '${o.id}'`);
      if (!u16(o.x) || !u16(o.y)) errs.push(`object '${o.id}': x/y must be 0–65535`);
      if (!spriteIds.has(o.sprite)) errs.push(`object '${o.id}': unknown sprite '${o.sprite}'`);
      if (o.anim && !animIds.has(o.anim)) errs.push(`object '${o.id}': unknown animation '${o.anim}'`);
      if (o.movable && !o.solid) errs.push(`object '${o.id}': movable requires solid`);
      if (o.controls && !o.player) errs.push(`object '${o.id}': controls require player`);
      const tile = o.tile ?? [];
      if (tile.length !== 0 && tile.length !== 8) errs.push(`object '${o.id}': tile needs 8 rows`);
      if (tile.some((b) => !Number.isInteger(b) || b < 0 || b > 255))
        errs.push(`object '${o.id}': tile bytes must be 0–255`);
    }
    const drivers = s.objects.filter((o) => o.controls);
    if (drivers.length > 1) errs.push(`scene '${s.id}': at most one keyboard driver`);
    for (const c of s.clicks) {
      if (!objIds.has(c.object)) errs.push(`scene '${s.id}': click on unknown object '${c.object}'`);
      if (!sceneIds.has(c.goto)) errs.push(`scene '${s.id}': goto unknown scene '${c.goto}'`);
    }
    for (const k of s.keys) {
      if (!Number.isInteger(k.key) || k.key < 0 || k.key > 255)
        errs.push(`scene '${s.id}': key must be 0–255`);
      if (!sceneIds.has(k.goto)) errs.push(`scene '${s.id}': key goto unknown scene '${k.goto}'`);
    }
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
  return 1 | (o.solid ? 2 : 0) | (o.movable ? 4 : 0);
}

function emitSetup(s: Scene): string {
  const lines = [`setup_${s.id} :: fn() {`];
  for (let i = 0; i < s.objects.length; i++) {
    const o = s.objects[i];
    lines.push(`    ox[${i}] = ${o.x}; oy[${i}] = ${o.y}; ot[${i}] = &spr_${o.sprite}; oflags[${i}] = ${flagsOf(o)};`);
  }
  lines.push(`    ocount = ${s.objects.length};`);
  lines.push(`}`);
  return lines.join("\n") + "\n";
}

function emitAnim(s: Scene, anims: Map<string, Animation>): string[] {
  const lines: string[] = [];
  s.objects.forEach((o, i) => {
    if (!o.anim) return;
    const a = anims.get(o.anim);
    if (!a) return;
    const F = a.frames.length;
    const hold = a.loop ? `afr_${s.id}_${o.id} = 0;` : `afr_${s.id}_${o.id} = ${F - 1};`;
    lines.push(`    atick_${s.id}_${o.id} = atick_${s.id}_${o.id} + 1;`);
    lines.push(`    if atick_${s.id}_${o.id} >= ${a.rate} {`);
    lines.push(`        atick_${s.id}_${o.id} = 0;`);
    lines.push(`        afr_${s.id}_${o.id} = afr_${s.id}_${o.id} + 1;`);
    lines.push(`        if afr_${s.id}_${o.id} >= ${F} { ${hold} }`);
    lines.push(`    }`);
    a.frames.forEach((f, fi) => {
      lines.push(`    if afr_${s.id}_${o.id} == ${fi} { ot[${i}] = &spr_${f}; }`);
    });
  });
  return lines;
}

function emitDrive(s: Scene, pi: number, w: number, h: number, n: number): string[] {
  // Keyboard drive + collide-and-push for the player slot.
  const lines = [
    `    dpad: u8 = Controller.button;`,
    `    nx: u16 = ox[${pi}]; ny: u16 = oy[${pi}];`,
    `    if dpad & 64 != 0 { if nx >= 1 { nx = nx - 1; } }`,
    `    if dpad & 128 != 0 { if nx < ${w - 8} { nx = nx + 1; } }`,
    `    if dpad & 16 != 0 { if ny >= 1 { ny = ny - 1; } }`,
    `    if dpad & 32 != 0 { if ny < ${h - 8} { ny = ny + 1; } }`,
    `    ox_old: u16 = ox[${pi}]; oy_old: u16 = oy[${pi}];`,
    `    ox[${pi}] = nx; oy[${pi}] = ny;`,
    `    blocked: u8 = 0;`,
    `    for j in 0..${n} {`,
    `        if j != ${pi} {`,
    `            if oflags[j] & 2 != 0 {`,
    `                if overlap88(ox[${pi}], oy[${pi}], ox[j], oy[j]) {`,
    `                    if oflags[j] & 4 != 0 {`,
    `                        jx: u16 = ox[j]; jy: u16 = oy[j];`,
    `                        if dpad & 64 != 0 { if jx >= 1 { jx = jx - 1; } }`,
    `                        if dpad & 128 != 0 { if jx < ${w - 8} { jx = jx + 1; } }`,
    `                        if dpad & 16 != 0 { if jy >= 1 { jy = jy - 1; } }`,
    `                        if dpad & 32 != 0 { if jy < ${h - 8} { jy = jy + 1; } }`,
    `                        free: u8 = 1;`,
    `                        for k in 0..${n} {`,
    `                            if k != ${pi} {`,
    `                                if k != j {`,
    `                                    if oflags[k] & 2 != 0 {`,
    `                                        if overlap88(jx, jy, ox[k], oy[k]) { free = 0; }`,
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

function emitFrame(s: Scene, w: number, h: number, anims: Map<string, Animation>): string {
  const lines = [`${s.id}_frame :: fn() {`];
  lines.push(`    k: u8 = kb[0]; kb[0] = 0;`);
  lines.push(`    mnow: u8 = Mouse.state | mb[0]; mb[0] = 0;`);
  lines.push(`    mpressed: u8 = mnow & (mouse_last ^ 255);`);
  lines.push(`    mouse_last = mnow;`);
  lines.push(`    mx: u16 = Mouse.x;`);
  lines.push(`    my: u16 = Mouse.y;`);
  const driver = s.objects.findIndex((o) => o.controls);
  if (driver >= 0) lines.push(...emitDrive(s, driver, w, h, s.objects.length));
  lines.push(...emitAnim(s, anims));
  const byObject = new Map(s.objects.map((o, i) => [o.id, i]));
  for (const c of [...s.clicks].sort((a, b) => (a.object < b.object ? -1 : 1))) {
    const i = byObject.get(c.object) as number;
    lines.push(`    if mpressed & 1 != 0 {`);
    lines.push(`        if pt_in_rect(mx, my, ox[${i}], oy[${i}], 8, 8) {`);
    lines.push(`            setup_${c.goto}();`);
    lines.push(`            scene_go(SC_${c.goto.toUpperCase()});`);
    lines.push(`        }`);
    lines.push(`    }`);
  }
  for (const k of [...s.keys].sort((a, b) => a.key - b.key)) {
    lines.push(`    if k == ${k.key} {`);
    lines.push(`        setup_${k.goto}();`);
    lines.push(`        scene_go(SC_${k.goto.toUpperCase()});`);
    lines.push(`    }`);
  }
  lines.push(`    draw_all();`);
  lines.push(`}`);
  return lines.join("\n") + "\n";
}

export function emitProject(p: Project): Record<string, string> {
  const errs = validateProject(p);
  if (errs.length > 0) throw new Error(`invalid project: ${errs.join("; ")}`);
  const scenes = [...p.scenes].sort((a, b) => (a.id < b.id ? -1 : 1));
  const indexOf = new Map(scenes.map((s, i) => [s.id, i]));

  const out: string[] = [];
  out.push(`( generated by uxn-forge from project '${p.name}' — do not edit. )`);
  out.push(`import "devices.ux"`);
  out.push(``);
  out.push(`meta { title: "${p.name}", author: "${p.author}" }`);
  out.push(``);
  for (const s of scenes) out.push(`SC_${s.id.toUpperCase()} :: ${indexOf.get(s.id)};`);
  out.push(``);
  for (const o of [...p.sprites].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    out.push(`data spr_${o.id} = [${pixelsToPlanar(o.pixels).join(", ")}];`);
  }
  if (usedVoices(p).length > 0) {
    out.push(`data sq32 = [${SQ32.join(", ")}];`);
  }
  out.push(``);
  out.push(`buffer ox[${MAX_OBJECTS}]: u16;`);
  out.push(`buffer oy[${MAX_OBJECTS}]: u16;`);
  out.push(`buffer ot[${MAX_OBJECTS}]: u16;`);
  out.push(`buffer oflags[${MAX_OBJECTS}]: u8;`);
  out.push(`ocount: u8 = 0;`);
  out.push(`scene: u8 = 0;`);
  out.push(`kb: [1] u8;`);
  out.push(`mb: [1] u8;`);
  out.push(`mouse_last: u8 = 0;`);
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
  const animMap = new Map(p.anims.map((a) => [a.id, a]));
  for (const s of scenes) {
    for (const o of [...s.objects].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (o.anim && animMap.has(o.anim)) {
        out.push(`atick_${s.id}_${o.id}: u8 = 0;`);
        out.push(`afr_${s.id}_${o.id}: u8 = 0;`);
      }
    }
  }
  out.push(``);
  for (const s of scenes) {
    const objs = [...s.objects].sort((a, b) => (a.id < b.id ? -1 : 1));
    out.push(emitSetup({ ...s, objects: objs }));
    out.push(emitFrame({ ...s, objects: objs }, p.width, p.height, animMap));
  }
  const arms = scenes.map((s) => `        ${indexOf.get(s.id)} => { ${s.id}_frame(); }`).join("\n");
  out.push(`on_frame :: event() {`);
  out.push(`    match scene {`);
  out.push(arms);
  out.push(`    }`);
  out.push(`}`);
  out.push(``);
  out.push(`on_key :: event() {`);
  out.push(`    kb[0] = Controller.key;`);
  out.push(`}`);
  out.push(``);
  out.push(`on_mouse :: event() {`);
  out.push(`    mb[0] = mb[0] | Mouse.state;`);
  out.push(`}`);
  out.push(``);
  out.push(`start :: fn() {`);
  out.push(`    System.r = 45163;`);
  out.push(`    System.g = 32876;`);
  out.push(`    System.b = 16508;`);
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
  out.push(`    scene_go(SC_${p.start.toUpperCase()});`);
  out.push(`    Screen.vector = &on_frame;`);
  out.push(`    Controller.vector = &on_key;`);
  out.push(`    Mouse.vector = &on_mouse;`);
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
  name: "Forge Demo",
  author: "uxn-forge",
  width: 128,
  height: 128,
  start: "title",
  updatedAt: 0,
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
      objects: [
        { id: "hero", x: 16, y: 40, sprite: "hero", player: true, controls: true },
        { id: "wall", x: 64, y: 64, sprite: "wall", solid: true },
        { id: "coin", x: 96, y: 96, sprite: "coin", solid: true, movable: true, anim: "spin" },
      ],
      clicks: [{ object: "hero", goto: "play" }],
      keys: [{ key: 32, goto: "play" }],
    },
    {
      id: "play",
      objects: [{ id: "hero", x: 8, y: 8, sprite: "hero", player: true, controls: true }],
      clicks: [],
      keys: [{ key: 27, goto: "title" }],
    },
  ],
};
