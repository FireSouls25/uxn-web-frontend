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

export interface Project {
  name: string;
  author: string;
  width: number;
  height: number;
  start: string;
  scenes: Scene[];
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
  for (const s of p.scenes) {
    if (!IDENT.test(s.id)) errs.push(`bad scene id '${s.id}'`);
    if (s.objects.length > MAX_OBJECTS) errs.push(`scene '${s.id}' has >${MAX_OBJECTS} objects`);
    const objIds = new Set(s.objects.map((o) => o.id));
    if (objIds.size !== s.objects.length) errs.push(`scene '${s.id}': duplicate object id`);
    for (const o of s.objects) {
      if (!IDENT.test(o.id)) errs.push(`bad object id '${o.id}'`);
      if (!u16(o.x) || !u16(o.y)) errs.push(`object '${o.id}': x/y must be 0–65535`);
      const tile = o.tile ?? [];
      if (tile.length !== 0 && tile.length !== 8) errs.push(`object '${o.id}': tile needs 8 rows`);
      if (tile.some((b) => !Number.isInteger(b) || b < 0 || b > 255))
        errs.push(`object '${o.id}': tile bytes must be 0–255`);
    }
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

function emitSetup(s: Scene): string {
  const lines = [`setup_${s.id} :: fn() {`];
  for (let i = 0; i < s.objects.length; i++) {
    const o = s.objects[i];
    lines.push(`    ox[${i}] = ${o.x}; oy[${i}] = ${o.y}; ot[${i}] = &tile_${s.id}_${o.id};`);
  }
  lines.push(`    ocount = ${s.objects.length};`);
  lines.push(`}`);
  return lines.join("\n") + "\n";
}

function emitFrame(s: Scene): string {
  const lines = [`${s.id}_frame :: fn() {`];
  lines.push(`    k: u8 = kb[0]; kb[0] = 0;`);
  lines.push(`    mnow: u8 = Mouse.state | mb[0]; mb[0] = 0;`);
  lines.push(`    mpressed: u8 = mnow & (mouse_last ^ 255);`);
  lines.push(`    mouse_last = mnow;`);
  lines.push(`    mx: u16 = Mouse.x;`);
  lines.push(`    my: u16 = Mouse.y;`);
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
  out.push(``);
  out.push(`buffer ox[${MAX_OBJECTS}]: u16;`);
  out.push(`buffer oy[${MAX_OBJECTS}]: u16;`);
  out.push(`buffer ot[${MAX_OBJECTS}]: u16;`);
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
  out.push(`draw_all :: fn() {`);
  out.push(`    for i in 0..${MAX_OBJECTS} {`);
  out.push(`        if i < ocount {`);
  out.push(`            Screen.x = ox[i];`);
  out.push(`            Screen.y = oy[i];`);
  out.push(`            Screen.addr = ot[i];`);
  out.push(`            Screen.sprite = 1;`);
  out.push(`        }`);
  out.push(`    }`);
  out.push(`}`);
  out.push(``);
  for (const s of scenes) {
    const objs = [...s.objects].sort((a, b) => (a.id < b.id ? -1 : 1));
    out.push(emitSetup({ ...s, objects: objs }));
    out.push(emitFrame({ ...s, objects: objs }));
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
  return { "devices.ux": DEVICES, "main.ux": out.join("\n") };
}

/* Sample project: title → play via click or space. */
export const SAMPLE_PROJECT: Project = {
  name: "Forge Demo",
  author: "uxn-forge",
  width: 128,
  height: 128,
  start: "title",
  scenes: [
    {
      id: "title",
      objects: [
        { id: "hero", x: 16, y: 40 },
        { id: "coin", x: 64, y: 64, tile: [24, 60, 126, 255, 255, 126, 60, 24] },
      ],
      clicks: [{ object: "hero", goto: "play" }],
      keys: [{ key: 32, goto: "play" }],
    },
    {
      id: "play",
      objects: [{ id: "hero", x: 8, y: 8 }],
      clicks: [],
      keys: [{ key: 27, goto: "title" }],
    },
  ],
};
