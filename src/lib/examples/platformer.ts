/* Sprout Run: a side-scrolling platformer built only from engine
   features, no scripts. It shows:
   - a TILE LAYER (Scene.tilemap): a 1280×192 level from one 16-cell
     sheet, one byte per cell; solid cells block movement, the rest
     (clouds, hills, bushes, flowers, fences) is scenery;
   - a CAMERA that follows the hero, clamped to the level;
   - MOVEMENT presets: the hero is `platformer` (arrows run, up/space
     jumps, gravity), beetles are `walker` (patrol, turn at walls and
     ledges);
   - collisions as events: coins, stomping (the `jump` action bounces
     the hero), getting hurt, the goal flag;
   - a HUD (coin icon + count) that ignores the camera and redraws its
     number when the `score` message arrives;
   - polish: shaded generated art, a spinning-coin ANIMATION, 2×
     headline type and a blinking "press space".
   Original art; the level is written as text rows below. Locked
   example: Duplicate to edit. */
import { tilesFromRows, type Block, type ObjectEvent, type Project, type SceneNode, type Sprite, type Value } from "../project";
import { Canvas, bigText, tileSheet } from "./pixel";

const W = 256;
const H = 192;
/** Level size in tiles; the original 18 rows sit under 6 rows of sky. */
const COLS = 160;
const ROWS = 24;
const SKY = 6;

/* ---------- tiles: c0 sky, c1 ink, c2 leaf green, c3 warm orange ---------- */

const TILE_CELLS: string[][] = [
  // 0 grass top
  ["20020202", "22222222", "22222222", "21222212", "12111211", "33133333", "33333313", "31333333"],
  // 1 dirt
  ["33333333", "33133333", "33333313", "31333333", "33333333", "33331333", "13333333", "33333331"],
  // 2 brick
  ["11111111", "03331033", "33331333", "33331333", "11111111", "10333333", "13333333", "13333333"],
  // 3 stone block
  ["11111111", "10000021", "10222221", "10222221", "10222221", "10222221", "12222211", "11111111"],
  // 4 bush (decor)
  ["00000000", "00111100", "01222210", "12202221", "12222221", "12222021", "12222221", "22222222"],
  // 5 flower (decor)
  ["00303000", "03131300", "00303000", "00020000", "02020000", "00222020", "00022200", "00002000"],
  // 6 ledge (thin solid platform)
  ["11111111", "10333301", "13333331", "11111111", "01000010", "01000010", "01000010", "00000000"],
  // 7 fence (decor)
  ["00000000", "10000001", "11111111", "10000001", "10000001", "11111111", "10000001", "10000001"],
  // 8 grass, left edge of a ground run
  ["00000202", "00022222", "00222222", "02122212", "01211121", "01333333", "01331333", "01333313"],
  // 9 grass, right edge
  ["20200000", "22222000", "22222200", "21222120", "12111210", "33333310", "33313310", "31333310"],
  // 10 deep dirt
  ["33133313", "31333133", "33313331", "13331333", "33133313", "31333133", "33313331", "13331333"],
  // 11–13 cloud left / middle / right (decor)
  ["00000000", "00000111", "00011000", "00100000", "01000000", "10000000", "10000000", "01111111"],
  ["00111000", "01000100", "10000011", "00000000", "00000000", "00000000", "00000000", "11111111"],
  ["00000000", "11100000", "00011000", "00000100", "00000010", "00000001", "00000001", "11111110"],
  // 14 hill top, 15 hill body: dithered so they read as far away
  ["00000000", "00000000", "00000000", "00022000", "00200200", "02020020", "20202002", "02020202"],
  ["20202020", "02020202", "20202020", "02020202", "20202020", "02020202", "20202020", "02020202"],
];

/** Text → tile index (1-based sheet cell). */
const LEGEND: Record<string, number> = { G: 1, D: 2, B: 3, S: 4, b: 5, f: 6, "=": 7, "#": 8, "<": 9, ">": 10, d: 11, "(": 12, "~": 13, ")": 14, "^": 15, "%": 16 };
/** Cells that block movement (0-based): grass, dirt, brick, stone, ledge, edges, deep dirt. */
const SOLID = [0, 1, 2, 3, 6, 8, 9, 10];

/* ---------- sprites ---------- */

function pip(): Sprite {
  const c = new Canvas(16, 16);
  c.ellipse(8, 9.5, 6, 5, 3);
  // Soft shadow on the lower right, a shine on the upper left.
  c.paint(3, 1, (x, y) => (x + y) % 4 === 0 && x - 8 + (y - 9.5) > 4.5);
  c.set(4, 8, 0).set(5, 7, 0).set(4, 9, 0);
  // Face: big eyes with a glint, a small smile.
  c.rect(5, 8, 2, 3, 1).rect(9, 8, 2, 3, 1).set(6, 8, 0).set(10, 8, 0);
  c.set(7, 12, 1).set(8, 12, 1);
  // The sprout: a stem and two leaves.
  c.line(8, 2, 8, 4, 2);
  c.ellipse(5.5, 2.5, 2.5, 1.4, 2).ellipse(10.5, 2, 2.5, 1.4, 2);
  c.set(5, 2, 0).set(10, 1, 0);
  c.outline(1);
  // Feet.
  c.rect(5, 15, 2, 1, 1).rect(9, 15, 2, 1, 1);
  return c.sprite("pip");
}

function beetle(): Sprite {
  const c = new Canvas(16, 8);
  c.ellipse(9, 5.5, 6, 4.5, 2);
  c.rect(0, 6, 16, 2, 0);
  c.set(6, 2, 0).set(7, 2, 0).set(5, 3, 0);
  c.line(10, 2, 10, 5, 1);
  c.dither(2, 1, (x, y) => y === 5);
  c.disc(3, 4.5, 1.6, 1);
  c.outline(1);
  c.set(2, 4, 0);
  for (const x of [5, 9, 13]) c.set(x, 6, 1).set(x - 1, 7, 1);
  return c.sprite("beetle");
}

/** Four frames of a spinning coin (wide → edge-on → wide). */
function coins(): Sprite[] {
  return [3, 2, 0.8, 2].map((rx, i) => {
    const c = new Canvas(8, 8);
    c.ellipse(4, 4, rx, 3.5, 3);
    if (rx > 1) c.paint(3, 0, (x, y) => x === Math.floor(4 - rx / 2) && y < 4);
    if (rx > 2) c.rect(4, 2, 1, 4, 1);
    c.outline(1);
    return c.sprite(`coin_${i}`);
  });
}

function flag(): Sprite {
  const c = new Canvas(16, 32);
  // Cloth with a wave, a leaf emblem, then the pole and its knob.
  for (let x = 4; x < 15; x++) {
    const wave = Math.round(Math.sin(x / 2) * 1.2);
    c.rect(x, 5 + wave, 1, 8, 3);
  }
  c.ellipse(9.5, 9, 2.5, 1.5, 2);
  c.outline(1);
  c.rect(1, 4, 2, 28, 1);
  c.rect(2, 5, 1, 27, 2);
  c.disc(2, 2, 2, 3);
  c.set(1, 1, 0);
  return c.sprite("flag");
}

/* ---------- the level, as text ----------
   Tiles: G grass, < > grass edges, D dirt, d deep dirt, B brick,
   S stone, b bush, f flower, = ledge, # fence, ( ~ ) cloud, ^ % hill.
   Objects: @ hero (feet on this row), e beetle, c coin,
   F goal flag (feet on this row). */
function levelRows(): string[] {
  const g: string[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(" "));
  const put = (c: number, r: number, ch: string): void => {
    if (c >= 0 && c < COLS && r >= 0 && r < ROWS) g[r][c] = ch;
  };
  // Rows below are written in the original 18-row frame.
  const at = (c: number, r: number, ch: string): void => put(c, r + SKY, ch);
  const run = (c0: number, c1: number, r: number, ch: string): void => {
    for (let c = c0; c < c1; c++) at(c, r, ch);
  };
  const empty = (c: number, r: number): boolean => g[r + SKY]?.[c] === " ";

  // Ground with three pits; grass caps the pit edges.
  const pits = [
    [38, 41],
    [70, 74],
    [112, 115],
  ];
  const inPit = (c: number): boolean => pits.some(([a, b]) => c >= a && c < b);
  for (let c = 0; c < COLS; c++) {
    if (inPit(c)) continue;
    at(c, 15, inPit(c + 1) ? ">" : inPit(c - 1) ? "<" : "G");
    at(c, 16, "D");
    at(c, 17, "d");
  }
  // Ledges and bricks with coins above.
  run(14, 19, 11, "=");
  run(14, 19, 10, "c");
  run(22, 28, 10, "B");
  run(23, 27, 7, "c");
  // A stone staircase up and down.
  for (let i = 0; i < 4; i++) for (let r = 14 - i; r <= 14; r++) at(50 + i, r, "S");
  for (let i = 0; i < 4; i++) for (let r = 11 + i; r <= 14; r++) at(56 + i, r, "S");
  run(54, 56, 9, "c");
  // Stepping ledges over the second pit.
  run(66, 69, 11, "=");
  run(75, 78, 11, "=");
  run(70, 74, 9, "c");
  // A pillar and a high brick run.
  for (let r = 12; r <= 14; r++) at(88, r, "S");
  run(92, 99, 9, "B");
  run(93, 98, 8, "c");
  // Floating ledges and the last pit.
  run(108, 111, 12, "=");
  run(116, 119, 12, "=");
  run(112, 115, 10, "c");
  // Final staircase to the flag.
  for (let i = 0; i < 6; i++) for (let r = 14 - i; r <= 14; r++) at(138 + i, r, "S");
  run(145, 149, 8, "c");

  // Scenery, only where nothing else is.
  for (const [c0, h] of [[2, 2], [30, 3], [78, 2], [100, 3], [124, 2], [150, 3]]) {
    for (let k = 0; k < h; k++) {
      const r = 14 - k;
      const half = h - k;
      for (let c = c0 - half; c <= c0 + half; c++) if (empty(c, r)) at(c, r, k === h - 1 ? "^" : "%");
    }
  }
  for (const c of [6, 7, 29, 47, 83, 84, 104, 127, 128, 150]) if (empty(c, 14)) at(c, 14, "b");
  for (const c of [11, 25, 58, 90, 122, 136]) if (empty(c, 14)) at(c, 14, "f");
  run(60, 66, 14, "#");
  for (const [c, r, w] of [[4, -4, 4], [24, -2, 3], [44, -5, 5], [68, -3, 3], [90, -5, 4], [118, -2, 3], [134, -4, 5], [154, -3, 3]]) {
    at(c, r, "(");
    for (let i = 1; i <= w; i++) at(c + i, r, "~");
    at(c + w + 1, r, ")");
  }

  // Enemies, hero, goal.
  for (const c of [20, 33, 45, 62, 80, 96, 120, 131]) at(c, 14, "e");
  at(3, 14, "@");
  at(152, 14, "F");
  return g.map((r) => r.join(""));
}

function levelNodes(rows: string[]): SceneNode[] {
  const out: SceneNode[] = [];
  let n = 0;
  rows.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      const x = c * 8;
      if (ch === "@") out.push({ id: "hero", def: "hero", x, y: (r + 1) * 8 - 16 });
      if (ch === "e") out.push({ id: `beetle${++n}`, def: "beetle", x, y: (r + 1) * 8 - 8 });
      if (ch === "c") out.push({ id: `coin${++n}`, def: "coin", x, y: r * 8 });
      if (ch === "F") out.push({ id: "goal", def: "flag", x, y: (r + 1) * 8 - 32 });
    }),
  );
  return out;
}

/** A one-screen backdrop: ground along the bottom, hills and clouds. */
function backdrop(): { cols: number; rows: number; tiles: number[] } {
  const rows: string[] = [
    "                                ",
    "   (~~)              (~~~)      ",
    "                                ",
    "          (~)                   ",
    "                          (~~)  ",
    ...Array(13).fill("                                "),
    "    ^                           ",
    "   %%%                     ^    ",
    "  %%%%%  b  f        f   b%%%   ",
    "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
    "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
    "dddddddddddddddddddddddddddddddd",
  ];
  return tilesFromRows(rows, LEGEND);
}

/* ---------- blocks ---------- */

const v = (name: string): Value => ({ k: "var", name });
const ev = (id: string, trigger: ObjectEvent["trigger"], blocks: Block[], extra: Partial<ObjectEvent> = {}): ObjectEvent => ({ id, trigger, blocks, ...extra });
const play = (sound: string): Block => ({ op: "play", sound });
const sound = (id: string, note: number, vol = 190) => ({ id, voices: [{ note, vol }, { note: 0, vol: 0 }, { note: 0, vol: 0 }, { note: 0, vol: 0 }] });
const text = (id: string, x: number, y: number, label: string): SceneNode => ({ id, x, y, label });
const big = (prefix: string, sprites: Sprite[], x: number, y: number): SceneNode[] => sprites.map((s, i) => ({ id: `${prefix}${i}`, sprite: s.id, x: x + i * 32, y, blend: 5 }));

/** Text that blinks: hide on timer 0, show on timer 1. */
function blinking(id: string, x: number, y: number, label: string): SceneNode {
  return {
    ...text(id, x, y, label),
    events: [
      ev("start", "create", [{ op: "wait", ticks: 40 }]),
      ev("off", "alarm", [{ op: "hide" }, { op: "wait", ticks: 20, slot: 1 }]),
      ev("on", "alarm", [{ op: "show" }, { op: "wait", ticks: 40 }], { alarm: 1 }),
    ],
  };
}

const SPROUT = bigText("t_sprout", "SPROUT");
const RUN = bigText("t_run", "RUN");
const MADE = bigText("t_made", "YOU MADE");
const IT = bigText("t_it", "IT!");
const OUCH = bigText("t_ouch", "OUCH!");

export function platformerProject(): Project {
  const rows = levelRows();
  const map = tilesFromRows(rows, LEGEND);
  const back = backdrop();
  const scenery = { sprite: "tiles", cols: back.cols, rows: back.rows, tiles: back.tiles, solid: SOLID };
  const showCoins: Block[] = [{ op: "text", text: "X ", value: v("coins") }];
  const start: Block[] = [play("start"), { op: "goto", scene: "level" }];
  return {
    id: "platformer",
    kind: "visual",
    locked: true,
    name: "Sprout Run",
    author: "uxn-forge",
    width: W,
    height: H,
    // c0 sky, c1 ink, c2 leaf green, c3 warm orange.
    theme: { r: 0x926e, g: 0xc2a9, b: 0xd343 },
    start: "title",
    updatedAt: Date.now(),
    inputs: [
      { id: "space", key: 32 },
      { id: "enter", key: 13 },
    ],
    sprites: [tileSheet("tiles", TILE_CELLS), pip(), beetle(), ...coins(), flag(), ...SPROUT, ...RUN, ...MADE, ...IT, ...OUCH],
    anims: [{ id: "spin", frames: ["coin_0", "coin_1", "coin_2", "coin_3"], rate: 8, loop: true }],
    vars: [{ id: "coins", init: 0 }],
    sounds: [sound("coin", 88), sound("stomp", 55), sound("hurt", 38, 220), sound("start", 72)],
    songs: [
      {
        id: "goal",
        tracks: [
          { vol: 170, notes: [72, 76, 79, 84, 79, 84].map((pitch) => ({ pitch, len: 6 })).concat([{ pitch: 127, len: 40 }]) },
          { vol: 120, notes: [48, 55, 60, 55].map((pitch) => ({ pitch, len: 9 })).concat([{ pitch: 127, len: 40 }]) },
          { vol: 0, notes: [] },
          { vol: 0, notes: [] },
        ],
      },
    ],
    objectDefs: [
      {
        id: "hero",
        sprite: "pip",
        kind: "player",
        blend: 5,
        movement: "platformer",
        speed: 2,
        jump: 5,
        // Feet and body, not the leaves: fairer collisions.
        mask: { x: 2, y: 4, w: 12, h: 12 },
        events: [
          ev("coin", "collide", [{ op: "destroy", target: "other" }, { op: "set", name: "coins", mode: "add", value: 1 }, play("coin"), { op: "send", message: "score" }], { target: "def:coin" }),
          ev(
            "beetle",
            "collide",
            [
              {
                op: "if",
                // Falling onto it (hero's feet above the beetle's middle): stomp.
                cond: { k: "cmp", a: { k: "math", op: "+", a: { k: "prop", prop: "y" }, b: 12 }, op: "lt", b: { k: "prop", prop: "y", of: "other" } },
                then: [{ op: "destroy", target: "other" }, { op: "jump", power: 3 }, play("stomp")],
                else: [play("hurt"), { op: "goto", scene: "lose" }],
              },
            ],
            { target: "def:beetle" },
          ),
          ev("goal", "collide", [{ op: "goto", scene: "win" }], { target: "def:flag" }),
          ev("fall", "step", [{ op: "if", cond: { k: "cmp", a: { k: "prop", prop: "y" }, op: "gt", b: H }, then: [play("hurt"), { op: "goto", scene: "lose" }] }]),
        ],
      },
      { id: "beetle", sprite: "beetle", kind: "static", movement: "walker", speed: 1, blend: 5 },
      { id: "coin", sprite: "coin_0", kind: "static", blend: 5, anim: "spin" },
      { id: "flag", sprite: "flag", kind: "static", blend: 5 },
    ],
    scenes: [
      {
        id: "title",
        tilemap: scenery,
        nodes: [
          ...big("ts", SPROUT, 80, 40),
          ...big("tr", RUN, 96, 68),
          { id: "pip", sprite: "pip", x: 120, y: 152, blend: 5 },
          { id: "c1", def: "coin", x: 72, y: 128 },
          { id: "c2", def: "coin", x: 88, y: 120 },
          { id: "c3", def: "coin", x: 104, y: 128 },
          { id: "bug", def: "beetle", x: 176, y: 160 },
          text("hint", 48, 108, "ARROWS RUN, UP JUMPS"),
          blinking("go", 84, 136, "PRESS SPACE"),
        ],
        events: [ev("start", "key", start, { key: "space" }), ev("enter", "key", start, { key: "enter" })],
      },
      {
        id: "level",
        tilemap: { sprite: "tiles", cols: map.cols, rows: map.rows, tiles: map.tiles, solid: SOLID },
        camera: { follow: "hero" },
        nodes: [
          ...levelNodes(rows),
          { id: "hud_coin", sprite: "coin_0", anim: "spin", x: 6, y: 6, blend: 5, hud: true },
          { id: "hud", x: 18, y: 6, label: "X 0", hud: true, events: [ev("show", "create", showCoins), ev("score", "message", showCoins, { message: "score" })] },
        ],
        events: [ev("reset", "create", [{ op: "set", name: "coins", mode: "set", value: 0 }])],
      },
      {
        id: "win",
        tilemap: scenery,
        nodes: [
          ...big("wm", MADE, 64, 40),
          ...big("wi", IT, 96, 66),
          { id: "flag", sprite: "flag", x: 152, y: 136, blend: 5 },
          { id: "pip", sprite: "pip", x: 128, y: 152, blend: 5 },
          { id: "coin", sprite: "coin_0", anim: "spin", x: 104, y: 105, blend: 5 },
          { id: "total", x: 116, y: 105, label: "X 0", events: [ev("show", "create", showCoins)] },
          blinking("again", 72, 124, "SPACE: PLAY AGAIN"),
        ],
        events: [ev("tune", "create", [{ op: "song", song: "goal" }]), ev("back", "key", [{ op: "song_stop" }, { op: "goto", scene: "title" }], { key: "space" })],
      },
      {
        id: "lose",
        tilemap: scenery,
        nodes: [...big("lo", OUCH, 80, 48), { id: "pip", sprite: "pip", x: 120, y: 152, blend: 5, flipY: true }, blinking("retry", 80, 100, "SPACE: RETRY")],
        events: [ev("retry", "key", start, { key: "space" })],
      },
    ],
  };
}
