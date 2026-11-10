/* Life Lab: a small "website" that runs on Uxn. Three pages (home,
   lab, about) share a nav bar whose links switch scenes; the lab page
   runs Conway's Game of Life. It shows:
   - a bigger screen (320×240) and denser art: a 64×64 petri dish in
     four 32×32 sprites with dithered glass, 2× headline type with a
     drop shadow, and 16×16 icons, all generated below from code;
   - a TILE LAYER as page layout: nav bar, rounded cards with header
     strips, pill buttons and the dotted dish all come from one 16-cell
     sheet, so the page costs no object slots;
   - text objects as buttons (click events, a widened hitbox);
   - blocks + a script: the timer, buttons and stats are blocks that
     call life.ux, which holds the grid in RAM and draws it from the
     custom_draw hook.
   Locked example: Duplicate to edit. */
import lifeRaw from "./lifelab/life.ux?raw";
import { FONT8X8 } from "../font";
import type { Block, ObjectEvent, Project, SceneNode, Sprite, Tilemap, Value } from "../project";

const W = 320;
const H = 240;
const COLS = W / 8;
const ROWS = H / 8;

/* ---------- art helpers ---------- */

/** Rows of palette digits (8·w wide, 8·h tall) → tile-major pixels. */
function art(id: string, rows: string[], cell?: { w: number; h: number }): Sprite {
  const w = rows[0].length / 8;
  const h = rows.length / 8;
  const pixels: number[] = [];
  for (let ty = 0; ty < h; ty++)
    for (let tx = 0; tx < w; tx++)
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) pixels.push(Number(rows[ty * 8 + y][tx * 8 + x]));
  return { id, w, h, pixels, ...(cell ? { cell } : {}) };
}

/** A blank canvas of palette indices, read back as digit rows. */
function canvas(w: number, h: number): { px: number[][]; set: (x: number, y: number, c: number) => void; rows: () => string[] } {
  const px = Array.from({ length: h }, () => new Array<number>(w).fill(0));
  return {
    px,
    set: (x, y, c) => {
      if (x >= 0 && y >= 0 && x < w && y < h) px[y][x] = c;
    },
    rows: () => px.map((r) => r.join("")),
  };
}

/** Cut a canvas into 32-px-wide sprites named `${id}_0`, `_1`, … */
function slices(id: string, rows: string[], width = 32): Sprite[] {
  const out: Sprite[] = [];
  for (let x = 0, i = 0; x < rows[0].length; x += width, i++) out.push(art(`${id}_${i}`, rows.map((r) => r.slice(x, x + width))));
  return out;
}

/** Headline type: the 8×8 font at 2× in ink with a coral shadow,
    two letters per 32×24 sprite. */
function bigText(id: string, text: string): Sprite[] {
  const padded = text.length % 2 ? `${text} ` : text;
  const c = canvas(padded.length * 16, 24);
  for (const [color, off] of [[3, 2], [1, 0]] as const) {
    [...padded].forEach((ch, i) => {
      const g = (ch.charCodeAt(0) - 32) * 8;
      for (let gy = 0; gy < 8; gy++)
        for (let gx = 0; gx < 8; gx++)
          if (FONT8X8[g + gy] & (0x80 >> gx))
            for (let d = 0; d < 4; d++) c.set(i * 16 + gx * 2 + (d & 1) + off, 2 + gy * 2 + (d >> 1) + off, color);
    });
  }
  return slices(id, c.rows());
}

/** The petri dish: ink rim, teal glass with a highlight, dithered
    shading toward the lower right and a colony of coral cells. */
const COLONY = [
  "............",
  "..#.........",
  "...#....##..",
  ".###....##..",
  "............",
  "......###...",
  "............",
  "..##........",
  ".##....#....",
  "..#....#....",
  ".......#....",
  "............",
];
function dish(): Sprite[] {
  const c = canvas(64, 64);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const dx = x - 31.5;
      const dy = y - 31.5;
      const r = Math.hypot(dx, dy);
      if (r > 31.5) continue;
      if (r > 30) c.set(x, y, 1);
      else if (r > 27) c.set(x, y, dx + dy < -26 ? 0 : 2);
      else if (r > 26) c.set(x, y, 1);
      else if (dx + dy > 14 && (x + y) % 2 === 0) c.set(x, y, 2);
      else if (r > 20 && r < 22 && dx < -6 && dy < -6) c.set(x, y, 2);
    }
  COLONY.forEach((row, gy) =>
    [...row].forEach((ch, gx) => {
      if (ch !== "#") return;
      const ox = 8 + gx * 4;
      const oy = 8 + gy * 4;
      for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) c.set(ox + x, oy + y, 3);
      for (let i = 1; i < 4; i++) {
        c.set(ox + 3, oy + i, 1);
        c.set(ox + i, oy + 3, 1);
      }
    }),
  );
  const rows = c.rows();
  return [
    art("dish_tl", rows.slice(0, 32).map((r) => r.slice(0, 32))),
    art("dish_tr", rows.slice(0, 32).map((r) => r.slice(32))),
    art("dish_bl", rows.slice(32).map((r) => r.slice(0, 32))),
    art("dish_br", rows.slice(32).map((r) => r.slice(32))),
  ];
}

/** Logo: a glider in a rounded ink badge. */
function logo(): Sprite {
  const c = canvas(16, 16);
  const edge = (n: number) => n === 0 || n === 15;
  const near = (n: number) => n <= 1 || n >= 14;
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) if (!((edge(x) && near(y)) || (edge(y) && near(x)))) c.set(x, y, 1);
  for (const [gx, gy] of [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]])
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) c.set(2 + gx * 4 + x, 2 + gy * 4 + y, gy === 2 ? 3 : 2);
  return art("logo", c.rows());
}

const ICON_GROW = [
  "0000000000000000",
  "0000000002200000",
  "0000000022220000",
  "0002200222220000",
  "0022220222200000",
  "0222222122000000",
  "0022221120000000",
  "0000001100000000",
  "0000001100000000",
  "0011111111111100",
  "0133333333333310",
  "0013333333333100",
  "0013333333333100",
  "0001333333331000",
  "0001333333331000",
  "0000111111110000",
];
const ICON_TICK = [
  "0000011111100000",
  "0001122222211000",
  "0012200000022100",
  "0120000100000210",
  "0120000100000210",
  "1200000100000021",
  "1200000100000021",
  "1200000111110021",
  "1200000000000021",
  "1200000000000021",
  "0120000000000210",
  "0120000000000210",
  "0012200000022100",
  "0001122222211000",
  "0000011111100000",
  "0000000000000000",
];
const ICON_DICE = [
  "0011111111111100",
  "0122222222222210",
  "1200000000000021",
  "1203300000000021",
  "1203300000000021",
  "1200000000000021",
  "1200000330000021",
  "1200000330000021",
  "1200000000000021",
  "1200000000033021",
  "1200000000033021",
  "1200000000000021",
  "1222222222222221",
  "0111111111111110",
  "0011111111111100",
  "0000000000000000",
];
/** Coral underline under the current nav link. */
const UNDERLINE = ["00000000", "00000000", "00000000", "00000000", "00000000", "00000000", "33333333", "33333333"];

/* ---------- the layout sheet (16 cells of 8×8) ---------- */

const T = {
  nav: 1,
  tl: 2, t: 3, tr: 4, l: 5, r: 6, bl: 7, b: 8, br: 9,
  dots: 10,
  ptl: 11, pt: 12, ptr: 13, pbl: 14, pb: 15, pbr: 16,
} as const;

const SHEET: string[][] = [
  // nav fill (teal)
  Array(8).fill("22222222"),
  // card corners and edges: rounded ink outline
  ["00111111", "01000000", "10000000", "10000000", "10000000", "10000000", "10000000", "10000000"],
  ["11111111", "00000000", "00000000", "00000000", "00000000", "00000000", "00000000", "00000000"],
  ["11111100", "00000010", "00000001", "00000001", "00000001", "00000001", "00000001", "00000001"],
  Array(8).fill("10000000"),
  Array(8).fill("00000001"),
  ["10000000", "10000000", "10000000", "10000000", "10000000", "10000000", "01000000", "00111111"],
  ["00000000", "00000000", "00000000", "00000000", "00000000", "00000000", "00000000", "11111111"],
  ["00000001", "00000001", "00000001", "00000001", "00000001", "00000001", "00000010", "11111100"],
  // dish background: faint teal dots in the gaps between 4px cells
  ["00000000", "00000000", "00000000", "00020002", "00000000", "00000000", "00000000", "00020002"],
  // pill button, 16px tall: coral with an ink rim
  ["00111111", "01333333", "13333333", "13333333", "13333333", "13333333", "13333333", "13333333"],
  ["11111111", "33333333", "33333333", "33333333", "33333333", "33333333", "33333333", "33333333"],
  ["11111100", "33333310", "33333331", "33333331", "33333331", "33333331", "33333331", "33333331"],
  ["13333333", "13333333", "13333333", "13333333", "13333333", "13333333", "01333333", "00111111"],
  ["33333333", "33333333", "33333333", "33333333", "33333333", "33333333", "33333333", "11111111"],
  ["33333331", "33333331", "33333331", "33333331", "33333331", "33333331", "33333310", "11111100"],
];

function sheet(): Sprite {
  const rows: string[] = [];
  for (let band = 0; band < 4; band++)
    for (let y = 0; y < 8; y++) rows.push(SHEET.slice(band * 4, band * 4 + 4).map((c) => c[y]).join(""));
  return art("layout", rows, { w: 1, h: 1 });
}

/** A page's tile grid, painted with a few primitives. */
class Page {
  tiles = new Array<number>(COLS * ROWS).fill(0);
  put(c: number, r: number, v: number): void {
    if (c >= 0 && r >= 0 && c < COLS && r < ROWS) this.tiles[r * COLS + c] = v;
  }
  fill(c0: number, r0: number, c1: number, r1: number, v: number): void {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.put(c, r, v);
  }
  /** Rounded card from (c0,r0) to (c1,r1), with a teal header strip. */
  card(c0: number, r0: number, c1: number, r1: number, inner = 0): void {
    this.fill(c0 + 1, r0 + 1, c1 - 1, r1 - 1, inner);
    this.fill(c0 + 1, r0, c1 - 1, r0, T.t);
    this.fill(c0 + 1, r1, c1 - 1, r1, T.b);
    this.fill(c0, r0 + 1, c0, r1 - 1, T.l);
    this.fill(c1, r0 + 1, c1, r1 - 1, T.r);
    this.put(c0, r0, T.tl);
    this.put(c1, r0, T.tr);
    this.put(c0, r1, T.bl);
    this.put(c1, r1, T.br);
    this.fill(c0 + 1, r0 + 1, c1 - 1, r0 + 1, T.nav);
  }
  /** Pill button `cols` wide, 2 rows tall. */
  pill(c: number, r: number, cols: number): void {
    this.put(c, r, T.ptl);
    this.put(c, r + 1, T.pbl);
    this.fill(c + 1, r, c + cols - 2, r, T.pt);
    this.fill(c + 1, r + 1, c + cols - 2, r + 1, T.pb);
    this.put(c + cols - 1, r, T.ptr);
    this.put(c + cols - 1, r + 1, T.pbr);
  }
  map(): Tilemap {
    return { sprite: "layout", cols: COLS, rows: ROWS, tiles: this.tiles, solid: [] };
  }
}

/* ---------- blocks ---------- */

const v = (name: string): Value => ({ k: "var", name });
const call = (fn: string, ...args: Value[]): Value => ({ k: "call", fn, args });
const ev = (id: string, trigger: ObjectEvent["trigger"], blocks: Block[], extra: Partial<ObjectEvent> = {}): ObjectEvent => ({ id, trigger, blocks, ...extra });
const play = (sound: string): Block => ({ op: "play", sound });
const text = (id: string, x: number, y: number, label: string, events?: ObjectEvent[]): SceneNode => ({ id, x, y, label, ...(events ? { events } : {}) });
const sprite = (id: string, sp: string, x: number, y: number): SceneNode => ({ id, sprite: sp, x, y, blend: 5 });
const sound = (id: string, note: number, vol = 170) => ({ id, voices: [{ note, vol }, { note: 0, vol: 0 }, { note: 0, vol: 0 }, { note: 0, vol: 0 }] });

/** Clickable text: the hitbox grows to cover the pill under it. */
function button(id: string, page: Page, c: number, r: number, word: string, blocks: Block[]): SceneNode {
  const label = ` ${word} `;
  page.pill(c, r, label.length);
  return {
    ...text(id, c * 8, r * 8 + 4, label, [ev("press", "click", [play("tick"), ...blocks])]),
    mask: { x: 0, y: 0, w: label.length * 8, h: 12 },
  };
}

const LINKS: Array<[string, string, number]> = [
  ["home", "HOME", 192],
  ["lab", "LAB", 240],
  ["about", "ABOUT", 272],
];

/** Shared top bar: logo, site name, links (current one underlined). */
function nav(page: Page, current: string): SceneNode[] {
  page.fill(0, 0, COLS - 1, 3, T.nav);
  const nodes: SceneNode[] = [sprite("logo", "logo", 8, 8), text("site", 30, 12, "LIFE LAB")];
  for (const [scene, word, x] of LINKS) {
    nodes.push({
      ...text(`go_${scene}`, x, 12, word, scene === current ? undefined : [ev("go", "click", [play("tick"), { op: "goto", scene }])]),
    });
    if (scene === current) for (let i = 0; i < word.length; i++) nodes.push(sprite(`ul${i}`, "underline", x + i * 8, 16));
  }
  return nodes;
}

const footer = (): SceneNode => text("foot", 8, 230, "MADE WITH UXN-FORGE");

function dishNodes(x: number, y: number): SceneNode[] {
  return [sprite("dish0", "dish_tl", x, y), sprite("dish1", "dish_tr", x + 32, y), sprite("dish2", "dish_bl", x, y + 32), sprite("dish3", "dish_br", x + 32, y + 32)];
}

function headline(prefix: string, sprites: Sprite[], x: number, y: number): SceneNode[] {
  return sprites.map((s, i) => sprite(`${prefix}${i}`, s.id, x + i * 32, y));
}

/* ---------- pages ---------- */

const GROW = bigText("grow", "GROW");
const WORLD = bigText("world", "A WORLD");

function homeScene() {
  const page = new Page();
  const nodes: SceneNode[] = [
    ...nav(page, "home"),
    ...headline("h1a", GROW, 16, 44),
    ...headline("h1b", WORLD, 16, 70),
    text("sub1", 16, 104, "CELLS LIVE, DIE AND"),
    text("sub2", 16, 114, "MULTIPLY ON A 48X32 GRID"),
    button("cta", page, 2, 16, "OPEN THE LAB", [{ op: "goto", scene: "lab" }]),
    ...dishNodes(236, 48),
  ];
  // Three feature cards.
  const cards: Array<[string, string, string, string]> = [
    ["grow", "BORN", "3 AROUND", "= NEW CELL"],
    ["tick", "TICKS", "ONE STEP", "EVERY TICK"],
    ["dice", "SOUP", "RANDOMIZE", "AND WATCH"],
  ];
  cards.forEach(([icon, title, l1, l2], i) => {
    const c0 = 1 + i * 13;
    page.card(c0, 19, c0 + 12, 27);
    nodes.push(
      text(`ct${i}`, (c0 + 1) * 8 + 4, 20 * 8, title),
      sprite(`ci${i}`, `icon_${icon}`, (c0 + 1) * 8 + 4, 22 * 8),
      text(`ca${i}`, (c0 + 1) * 8 + 4, 24 * 8 + 2, l1),
      text(`cb${i}`, (c0 + 1) * 8 + 4, 25 * 8 + 4, l2),
    );
  });
  nodes.push(footer());
  return { id: "home", nodes, tilemap: page.map() };
}

function labScene() {
  const page = new Page();
  const stop: Block[] = [{ op: "set", name: "running", mode: "set", value: 0 }, { op: "send", message: "stopped" }];
  page.card(1, 5, 26, 23);
  page.fill(2, 7, 25, 22, T.dots);
  page.card(28, 5, 38, 23);
  const run = button("run", page, 29, 8, "RUN ", [
    {
      op: "if",
      cond: { k: "cmp", a: v("running"), op: "eq", b: 0 },
      then: [{ op: "set", name: "running", mode: "set", value: 1 }, { op: "text", text: " STOP " }],
      else: stop,
    },
  ]);
  // The lab starts running, so the button starts as STOP.
  run.events!.push(ev("init", "create", [{ op: "text", text: " STOP " }]), ev("stopped", "message", [{ op: "text", text: " RUN  " }], { message: "stopped" }));
  const nodes: SceneNode[] = [
    ...nav(page, "lab"),
    text("dish_t", 24, 48, "THE DISH"),
    text("ctl_t", 236, 48, "CONTROLS"),
    run,
    button("step", page, 29, 11, "STEP", [{ op: "call", fn: "life_step", args: [] }, { op: "send", message: "stats" }]),
    button("soup", page, 29, 14, "SOUP", [{ op: "call", fn: "life_random", args: [] }, { op: "send", message: "stats" }]),
    button("wipe", page, 29, 17, "CLEAR", [...stop, { op: "call", fn: "life_clear", args: [] }, play("wipe"), { op: "send", message: "stats" }]),
    text("gen", 236, 164, "GEN 0", [
      ev("show", "create", [{ op: "text", text: "GEN ", value: call("life_gen") }]),
      ev("upd", "message", [{ op: "text", text: "GEN ", value: call("life_gen") }], { message: "stats" }),
    ]),
    text("pop", 236, 174, "POP 0", [
      ev("show", "create", [{ op: "text", text: "POP ", value: call("life_pop") }]),
      ev("upd", "message", [{ op: "text", text: "POP ", value: call("life_pop") }], { message: "stats" }),
    ]),
    text("hint", 16, 196, "DRAG ON THE DISH TO DRAW"),
    footer(),
  ];
  return {
    id: "lab",
    nodes,
    tilemap: page.map(),
    events: [
      // A fresh soup on arrival, then a tick every 4 frames.
      ev("open", "create", [{ op: "call", fn: "life_random", args: [] }, { op: "set", name: "running", mode: "set", value: 1 }, { op: "wait", ticks: 4 }]),
      ev("tick", "alarm", [
        { op: "if", cond: { k: "cmp", a: v("running"), op: "eq", b: 1 }, then: [{ op: "call", fn: "life_step", args: [] }] },
        { op: "send", message: "stats" },
        { op: "wait", ticks: 4 },
      ]),
      ev("paint", "step", [{ op: "if", cond: { k: "mouse_down" }, then: [{ op: "call", fn: "life_paint", args: [{ k: "mouse", axis: "x" }, { k: "mouse", axis: "y" }] }] }]),
    ],
  };
}

function aboutScene() {
  const page = new Page();
  page.card(1, 5, 38, 27);
  const lines = [
    "THIS WHOLE SITE IS ONE",
    "UXN ROM: 320X240 PIXELS,",
    "4 COLORS, 64KB OF RAM.",
    "",
    "THE RULES (B3/S23):",
    "- 3 NEIGHBORS: BORN",
    "- 2 OR 3: SURVIVES",
    "- ANYTHING ELSE: GONE",
    "",
    "PAGES ARE SCENES, THE",
    "LAYOUT IS A TILE LAYER,",
    "LINKS ARE CLICK EVENTS",
    "AND THE GRID: A SCRIPT.",
  ];
  const nodes: SceneNode[] = [...nav(page, "about"), text("title", 24, 48, "ABOUT THIS PAGE")];
  lines.forEach((l, i) => {
    if (l) nodes.push(text(`l${i}`, 24, 66 + i * 11, l));
  });
  nodes.push(...dishNodes(240, 120));
  nodes.push(button("back", page, 29, 9, "TRY IT", [{ op: "goto", scene: "lab" }]));
  return { id: "about", nodes, tilemap: page.map() };
}

export function lifeLabProject(): Project {
  return {
    id: "lifelab",
    kind: "visual",
    locked: true,
    name: "Life Lab",
    author: "uxn-forge",
    width: W,
    height: H,
    // c0 paper, c1 ink, c2 teal, c3 coral.
    theme: { r: 0xe22f, g: 0xe2b7, b: 0xf495 },
    start: "home",
    updatedAt: Date.now(),
    inputs: [],
    sprites: [
      sheet(),
      logo(),
      ...dish(),
      ...GROW,
      ...WORLD,
      art("icon_grow", ICON_GROW),
      art("icon_tick", ICON_TICK),
      art("icon_dice", ICON_DICE),
      art("underline", UNDERLINE),
    ],
    anims: [],
    vars: [{ id: "running", init: 0 }],
    sounds: [sound("tick", 79, 120), sound("wipe", 52)],
    scripts: [{ path: "life.ux", code: lifeRaw }],
    scenes: [homeScene(), labScene(), aboutScene()],
  };
}
