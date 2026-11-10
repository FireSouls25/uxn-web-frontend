/* Sprout Run: a side-scrolling platformer built only from engine
   features, no scripts. It shows:
   - a TILE LAYER (Scene.tilemap): a 1280×144 level from one 8-cell
     sheet, one byte per cell, solid cells block movement;
   - a CAMERA that follows the hero, clamped to the level;
   - MOVEMENT presets: the hero is `platformer` (arrows run, up/space
     jumps, gravity), beetles are `walker` (patrol, turn at walls and
     ledges);
   - collisions as events: coins, stomping (the `jump` action bounces
     the hero), getting hurt, the goal flag;
   - a HUD text object (`hud`) that ignores the camera and redraws its
     number when the `score` message arrives.
   Original art; the level is written as text rows below. Locked
   example: Duplicate to edit. */
import { tilesFromRows, type Block, type ObjectEvent, type Project, type SceneNode, type Sprite, type Value } from "../project";

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

/** Tile sheet: 8 cells of 8×8, laid out 4×2 (cell n = tile n). */
const TILE_CELLS: string[][] = [
  // 0 grass top
  ["22222222", "22222222", "12212221", "33133333", "33333133", "31333333", "33333313", "33333333"],
  // 1 dirt
  ["33333333", "33313333", "31333333", "33333133", "33333333", "13333333", "33331333", "33333333"],
  // 2 brick
  ["11111111", "33313331", "33313331", "11111111", "31333133", "31333133", "11111111", "33313331"],
  // 3 stone
  ["11111111", "12222221", "12111121", "12122121", "12122121", "12111121", "12222221", "11111111"],
  // 4 bush (decor)
  ["00000000", "00000000", "00222000", "02222200", "22222220", "22222222", "22122122", "22222222"],
  // 5 flower (decor)
  ["00000000", "00030000", "00333000", "00030000", "00020000", "02020200", "00222000", "00020000"],
  // 6 ledge (thin solid platform)
  ["22222222", "21212121", "11111111", "01000010", "01000010", "00000000", "00000000", "00000000"],
  // 7 fence (decor)
  ["00000000", "10000001", "11111111", "10000001", "10000001", "11111111", "10000001", "10000001"],
];

function tileSheet(): Sprite {
  const rows: string[] = [];
  for (const band of [TILE_CELLS.slice(0, 4), TILE_CELLS.slice(4)]) for (let y = 0; y < 8; y++) rows.push(band.map((c) => c[y]).join(""));
  return art("tiles", rows, { w: 1, h: 1 });
}

const HERO = [
  "0000000002200000",
  "0000000022220000",
  "0000000002100000",
  "0000011111110000",
  "0001133333331100",
  "0013333333333310",
  "0133333331331331",
  "0133333331331331",
  "0133333333333331",
  "0133333333333331",
  "0013333311133310",
  "0001333333333100",
  "0000111111111000",
  "0000013000310000",
  "0000013000310000",
  "0000111001110000",
];

const BEETLE = [
  "0000111111100000",
  "0011222222211000",
  "0122221222222100",
  "1222212222222210",
  "1222222222222210",
  "1111111111111110",
  "0131013101310130",
  "0101001010010100",
];

const COIN = ["00111100", "01333310", "13331331", "13331331", "13331331", "13331331", "01333310", "00111100"];

const FLAG = [
  "1111111110000000",
  "1333333331000000",
  "1333333333100000",
  "1333333333310000",
  "1333333333100000",
  "1333333331000000",
  "1111111110000000",
  ...Array.from({ length: 25 }, () => "1100000000000000"),
];

/* The level, as text. Tiles: G grass, D dirt, B brick, S stone,
   b bush, f flower, = ledge, # fence. Objects: @ hero (feet on this
   row), e beetle, c coin, F goal flag (feet on this row). */
const COLS = 160;
function levelRows(): string[] {
  const g: string[][] = Array.from({ length: 18 }, () => Array(COLS).fill(" "));
  const put = (c: number, r: number, ch: string): void => {
    if (c >= 0 && c < COLS && r >= 0 && r < 18) g[r][c] = ch;
  };
  const run = (c0: number, c1: number, r: number, ch: string): void => {
    for (let c = c0; c < c1; c++) put(c, r, ch);
  };
  // Ground with three pits.
  const pits = [
    [38, 41],
    [70, 74],
    [112, 115],
  ];
  for (let c = 0; c < COLS; c++) {
    if (pits.some(([a, b]) => c >= a && c < b)) continue;
    put(c, 15, "G");
    put(c, 16, "D");
    put(c, 17, "D");
  }
  // Decor on the ground line.
  for (const c of [6, 7, 29, 47, 83, 84, 104, 127, 128, 150]) put(c, 14, "b");
  for (const c of [11, 25, 58, 90, 122, 138]) put(c, 14, "f");
  run(60, 66, 14, "#");
  // Ledges and bricks with coins above.
  run(14, 19, 11, "=");
  run(14, 19, 10, "c");
  run(22, 28, 10, "B");
  run(23, 27, 7, "c");
  // A stone staircase up and down.
  for (let i = 0; i < 4; i++) for (let r = 14 - i; r <= 14; r++) put(50 + i, r, "S");
  for (let i = 0; i < 4; i++) for (let r = 11 + i; r <= 14; r++) put(56 + i, r, "S");
  run(54, 56, 9, "c");
  // Stepping ledges over the second pit.
  run(66, 69, 11, "=");
  run(75, 78, 11, "=");
  run(70, 74, 9, "c");
  // A pillar and a high brick run.
  for (let r = 12; r <= 14; r++) put(88, r, "S");
  run(92, 99, 9, "B");
  run(93, 98, 8, "c");
  // Floating ledges and the last pit.
  run(108, 111, 12, "=");
  run(116, 119, 12, "=");
  run(112, 115, 10, "c");
  // Final staircase to the flag.
  for (let i = 0; i < 6; i++) for (let r = 14 - i; r <= 14; r++) put(138 + i, r, "S");
  run(145, 149, 8, "c");
  // Enemies, hero, goal.
  for (const c of [20, 33, 45, 62, 80, 96, 120, 131]) put(c, 14, "e");
  put(3, 14, "@");
  put(152, 14, "F");
  return g.map((r) => r.join(""));
}

const LEGEND: Record<string, number> = { G: 1, D: 2, B: 3, S: 4, b: 5, f: 6, "=": 7, "#": 8 };

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

const v = (name: string): Value => ({ k: "var", name });
const ev = (id: string, trigger: ObjectEvent["trigger"], blocks: Block[], extra: Partial<ObjectEvent> = {}): ObjectEvent => ({ id, trigger, blocks, ...extra });
const play = (sound: string): Block => ({ op: "play", sound });
const sound = (id: string, note: number, vol = 190) => ({ id, voices: [{ note, vol }, { note: 0, vol: 0 }, { note: 0, vol: 0 }, { note: 0, vol: 0 }] });
const text = (id: string, x: number, y: number, label: string): SceneNode => ({ id, x, y, label });

export function platformerProject(): Project {
  const rows = levelRows();
  const map = tilesFromRows(rows, LEGEND);
  const showCoins: Block[] = [{ op: "text", text: "COINS ", value: v("coins") }];
  return {
    id: "platformer",
    kind: "visual",
    locked: true,
    name: "Sprout Run",
    author: "uxn-forge",
    width: 160,
    height: 144,
    // c0 sky, c1 ink, c2 leaf green, c3 warm orange.
    theme: { r: 0x926e, g: 0xc2a9, b: 0xd343 },
    start: "title",
    updatedAt: Date.now(),
    inputs: [
      { id: "space", key: 32 },
      { id: "enter", key: 13 },
    ],
    sprites: [tileSheet(), art("pip", HERO), art("beetle", BEETLE), art("coin", COIN), art("flag", FLAG)],
    anims: [],
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
        // Feet and body, not the leaf: fairer collisions.
        mask: { x: 2, y: 3, w: 12, h: 13 },
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
          ev("fall", "step", [{ op: "if", cond: { k: "cmp", a: { k: "prop", prop: "y" }, op: "gt", b: 144 }, then: [play("hurt"), { op: "goto", scene: "lose" }] }]),
        ],
      },
      { id: "beetle", sprite: "beetle", kind: "static", movement: "walker", speed: 1, blend: 5 },
      { id: "coin", sprite: "coin", kind: "static", blend: 5 },
      { id: "flag", sprite: "flag", kind: "static", blend: 5 },
    ],
    scenes: [
      {
        id: "title",
        nodes: [
          text("name", 40, 36, "SPROUT RUN"),
          { id: "pip", sprite: "pip", x: 72, y: 60, blend: 5 },
          text("hint1", 24, 96, "ARROWS RUN"),
          text("hint2", 24, 108, "UP/SPACE JUMP"),
          text("go", 24, 124, "SPACE: START"),
        ],
        events: [
          ev("start", "key", [play("start"), { op: "goto", scene: "level" }], { key: "space" }),
          ev("enter", "key", [play("start"), { op: "goto", scene: "level" }], { key: "enter" }),
        ],
      },
      {
        id: "level",
        tilemap: { sprite: "tiles", cols: map.cols, rows: map.rows, tiles: map.tiles, solid: [0, 1, 2, 3, 6] },
        camera: { follow: "hero" },
        nodes: [
          ...levelNodes(rows),
          { id: "hud", x: 4, y: 4, label: "COINS 0", hud: true, events: [ev("show", "create", showCoins), ev("score", "message", showCoins, { message: "score" })] },
        ],
        events: [ev("reset", "create", [{ op: "set", name: "coins", mode: "set", value: 0 }])],
      },
      {
        id: "win",
        nodes: [
          text("yay", 24, 40, "YOU MADE IT!"),
          { id: "total", x: 24, y: 64, label: "COINS 0", events: [ev("show", "create", showCoins)] },
          text("again", 24, 100, "SPACE: TITLE"),
        ],
        events: [ev("tune", "create", [{ op: "song", song: "goal" }]), ev("back", "key", [{ op: "song_stop" }, { op: "goto", scene: "title" }], { key: "space" })],
      },
      {
        id: "lose",
        nodes: [text("ouch", 56, 48, "OUCH!"), text("retry", 24, 80, "SPACE: RETRY"), { id: "pip", sprite: "pip", x: 72, y: 100, blend: 5, flipY: true }],
        events: [ev("retry", "key", [play("start"), { op: "goto", scene: "level" }], { key: "space" })],
      },
    ],
  };
}
