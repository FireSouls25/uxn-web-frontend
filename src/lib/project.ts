/* Project → ETAL emitter (v1).
   A low-code project (scenes of 8px objects + click/key bindings that
   switch scenes) lowers to dependency-free ETAL: two files, no imports
   beyond siblings, only constructs the backend compiler accepts.
   Deterministic by construction: sorted ids, fixed 16-slot pool,
   literal everything — the same project always yields the same bytes,
   so backend content-hash caching hits across users.
   v1 scope: on_click (press-in-rect) + press_key → goto_scene.
   on_hold/drag arrive with gesture-level bindings (proposed). */

export interface SceneObject {
  id: string;
  x: number;
  y: number;
  /** 8 × 1bpp rows, 0–255. Defaults to a solid block. */
  tile?: number[];
  /** Blocks the player (AABB, 8px). */
  solid?: boolean;
  /** Solid + pushable by the player when the landing cell is free. */
  movable?: boolean;
  /** Marks the player avatar (one per scene at most). */
  player?: boolean;
  /** Keyboard dpad drives this object (requires player). */
  controls?: boolean;
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
  /** Up to 4 voices, played once on boot. Absent = silent. */
  sound?: { voices: Voice[] };
  updatedAt: number;
}

export const MAX_OBJECTS = 16;
const IDENT = /^[A-Za-z][A-Za-z0-9_]*$/;

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
    lines.push(`    ox[${i}] = ${o.x}; oy[${i}] = ${o.y}; ot[${i}] = &tile_${s.id}_${o.id}; oflags[${i}] = ${flagsOf(o)};`);
  }
  lines.push(`    ocount = ${s.objects.length};`);
  lines.push(`}`);
  return lines.join("\n") + "\n";
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

function emitFrame(s: Scene, w: number, h: number): string {
  const lines = [`${s.id}_frame :: fn() {`];
  lines.push(`    k: u8 = kb[0]; kb[0] = 0;`);
  lines.push(`    mnow: u8 = Mouse.state | mb[0]; mb[0] = 0;`);
  lines.push(`    mpressed: u8 = mnow & (mouse_last ^ 255);`);
  lines.push(`    mouse_last = mnow;`);
  lines.push(`    mx: u16 = Mouse.x;`);
  lines.push(`    my: u16 = Mouse.y;`);
  const driver = s.objects.findIndex((o) => o.controls);
  if (driver >= 0) lines.push(...emitDrive(s, driver, w, h, s.objects.length));
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
  for (const s of scenes)
    for (const o of [...s.objects].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const tile = o.tile ?? [255, 255, 255, 255, 255, 255, 255, 255];
      out.push(`data tile_${s.id}_${o.id} = [${tile.join(", ")}];`);
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
  out.push(`                Screen.sprite = 1;`);
  out.push(`            }`);
  out.push(`        }`);
  out.push(`    }`);
  out.push(`}`);
  out.push(``);
  for (const s of scenes) {
    const objs = [...s.objects].sort((a, b) => (a.id < b.id ? -1 : 1));
    out.push(emitSetup({ ...s, objects: objs }));
    out.push(emitFrame({ ...s, objects: objs }, p.width, p.height));
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
export const SAMPLE_PROJECT: Project = {
  id: "demo",
  name: "Forge Demo",
  author: "uxn-forge",
  width: 128,
  height: 128,
  start: "title",
  updatedAt: 0,
  sound: { voices: [{ note: 72, vol: 120 }, { note: 0, vol: 0 }, { note: 0, vol: 0 }, { note: 0, vol: 0 }] },
  scenes: [
    {
      id: "title",
      objects: [
        { id: "hero", x: 16, y: 40, player: true, controls: true },
        { id: "wall", x: 64, y: 64, solid: true, tile: [255, 129, 129, 129, 129, 129, 129, 255] },
        { id: "coin", x: 96, y: 96, solid: true, movable: true, tile: [24, 60, 126, 255, 255, 126, 60, 24] },
      ],
      clicks: [{ object: "hero", goto: "play" }],
      keys: [{ key: 32, goto: "play" }],
    },
    {
      id: "play",
      objects: [{ id: "hero", x: 8, y: 8, player: true, controls: true }],
      clicks: [],
      keys: [{ key: 27, goto: "title" }],
    },
  ],
};
