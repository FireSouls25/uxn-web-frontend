/* Star Catcher: a one-screen arcade game built from events only. It
   shows spawning on a timer (scene alarm + spawn pool), random values,
   per-instance template variables (each star falls at its own speed,
   each heart knows which life it stands for), held-button conditions,
   game variables for score and lives, and messages that tell the HUD
   to redraw. Polish: a 256×192 night city drawn as a tile layer, a
   shaded moon, twinkling stars and a fizzing bomb (animations), a woven
   basket, hearts for lives and 2× headline type. Locked: Duplicate to
   edit. */
import { tilesFromRows, type Block, type Cond, type ObjectEvent, type Project, type SceneNode, type Sprite, type Value } from "../project";
import { Canvas, bigText, tileSheet } from "./pixel";

const W = 256;
const H = 192;
/** Ground line (y of the first ground row). */
const GROUND = 168;

/* ---------- tiles: c0 night, c1 moonlight, c2 star yellow, c3 pink ---------- */

const TILE_CELLS: string[][] = [
  // 0 small star, 1 twinkle, 2 faint star, 3 haze
  ["00000000", "00000000", "00000000", "00010000", "00000000", "00000000", "00000000", "00000000"],
  ["00000000", "00020000", "00020000", "02212200", "00020000", "00020000", "00000000", "00000000"],
  ["00000000", "00000000", "00000030", "00000000", "00000000", "00000000", "00000000", "00000000"],
  ["30000000", "00000000", "00003000", "00000000", "30000000", "00000000", "00003000", "00000000"],
  // 4–6 roof left / middle / right
  ["00000000", "00000000", "00000000", "00000000", "00000000", "00111111", "01000000", "10000000"],
  ["00000000", "00000000", "00000000", "00000000", "00000000", "11111111", "00000000", "00000000"],
  ["00000000", "00000000", "00000000", "00000000", "00000000", "11111100", "00000010", "00000001"],
  // 7 left wall, 8 lit windows, 9 dark windows, 10 right wall
  ["10000000", "10220220", "10220220", "10000000", "10000000", "10330220", "10330220", "10000000"],
  ["00000000", "02202200", "02202200", "00000000", "00000000", "02203300", "02203300", "00000000"],
  ["00000000", "03303300", "03303300", "00000000", "00000000", "03302200", "03302200", "00000000"],
  ["00000001", "02202201", "02202201", "00000001", "00000001", "03302201", "03302201", "00000001"],
  // 11 ground edge, 12 ground
  ["11111111", "33333333", "30303030", "03030303", "30303030", "03030303", "30303030", "03030303"],
  ["30303030", "03030303", "30303030", "03030303", "30303030", "03030303", "30303030", "03030303"],
  // 13 antenna, 14 horizon glow, 15 plain wall
  ["00000000", "00000000", "00030000", "00010000", "00010000", "00010000", "00111000", "01000100"],
  ["00000000", "30000000", "00000000", "00003000", "00000000", "30303030", "00000000", "03030303"],
  ["00000000", "00000000", "00000000", "00000000", "00000000", "00000000", "00000000", "00000000"],
];
const LEGEND: Record<string, number> = { ".": 1, "*": 2, ",": 3, "~": 4, "/": 5, "-": 6, "\\": 7, "[": 8, "o": 9, "x": 10, "]": 11, "_": 12, "#": 13, "!": 14, "=": 15, "|": 16 };

/** The night: a starfield, then a skyline of three building heights
    standing on the ground. Each building is [col, width, top row]. */
function nightRows(): string[] {
  const g: string[][] = Array.from({ length: 24 }, () => Array(32).fill(" "));
  // Stars on a fixed scatter so every scene shares the same sky.
  let seed = 7;
  const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
  for (let r = 0; r < 15; r++) for (let c = 0; c < 32; c++) {
    const k = rnd(23);
    if (k === 0) g[r][c] = ".";
    else if (k === 1 && r < 12) g[r][c] = "*";
    else if (k === 2 || k === 3) g[r][c] = ",";
    else if (k === 4 && r > 9) g[r][c] = "~";
  }
  for (let c = 0; c < 32; c++) g[15][c] = "=";
  const towers: Array<[number, number, number]> = [[0, 4, 18], [4, 3, 16], [8, 5, 19], [14, 3, 17], [18, 4, 15], [23, 3, 18], [27, 5, 16]];
  for (const [c0, w, top] of towers) {
    g[top - 1][c0 + Math.floor(w / 2)] = "!";
    for (let r = top; r < 21; r++)
      for (let c = c0; c < c0 + w; c++) {
        const edge = c === c0 ? "l" : c === c0 + w - 1 ? "r" : "m";
        if (r === top) g[r][c] = edge === "l" ? "/" : edge === "r" ? "\\" : "-";
        else if (edge === "l") g[r][c] = "[";
        else if (edge === "r") g[r][c] = "]";
        else g[r][c] = (r + c) % 3 === 0 ? "x" : "o";
      }
  }
  for (let c = 0; c < 32; c++) {
    g[21][c] = "_";
    g[22][c] = "#";
    g[23][c] = "#";
  }
  return g.map((r) => r.join(""));
}

/* ---------- sprites ---------- */

function moon(): Sprite {
  const c = new Canvas(32, 32);
  c.disc(16, 16, 15, 3).dither(3, 0, (x, y) => (x - 16) ** 2 + (y - 16) ** 2 > 13.5 ** 2);
  c.disc(16, 16, 13, 1);
  // Craters, then the night side as a dithered terminator.
  for (const [x, y, r] of [[11, 10, 3], [20, 18, 4], [12, 21, 2], [21, 9, 1.6]]) c.disc(x, y, r, 3).disc(x - 0.6, y - 0.6, r - 1, 1);
  c.dither(1, 3, (x, y) => x > 19 && (x - 16) ** 2 + (y - 16) ** 2 < 13 ** 2);
  c.paint(3, 0, (x, y) => x > 24 && (x + y) % 2 === 0 && (x - 16) ** 2 + (y - 16) ** 2 < 13 ** 2);
  return c.sprite("moon");
}

function starPoints(cx: number, cy: number, r1: number, r2: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? r2 : r1;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

function inside(pts: Array<[number, number]>, x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Two frames: the star, then the star with a sparkle. */
function stars(): Sprite[] {
  return [0, 1].map((f) => {
    const c = new Canvas(16, 16);
    const pts = starPoints(8, 8.5, 7.5, 3.2);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (inside(pts, x + 0.5, y + 0.5)) c.set(x, y, 2);
    c.paint(2, 1, (x, y) => (x - 6.5) ** 2 + (y - 7) ** 2 < 2);
    c.outline(3);
    if (f) c.set(14, 1, 1).set(13, 2, 1).set(15, 2, 1).set(14, 3, 1).set(1, 12, 1);
    return c.sprite(`star_${f}`);
  });
}

/** Two frames: the bomb with its fuse spark flickering. */
function bombs(): Sprite[] {
  return [0, 1].map((f) => {
    const c = new Canvas(16, 16);
    c.disc(7.5, 9.5, 6, 3);
    c.dither(3, 0, (x, y) => x - 7.5 + (y - 9.5) > 2);
    c.set(5, 6, 1).set(4, 7, 1).set(5, 7, 1);
    c.rect(6, 2, 3, 2, 1);
    c.outline(1);
    c.line(9, 2, 11, 0, 1);
    if (f) c.set(12, 0, 2).set(13, 1, 2).set(11, 1, 2);
    else c.set(12, 1, 2).set(13, 0, 1);
    return c.sprite(`bomb_${f}`);
  });
}

function basket(): Sprite {
  const c = new Canvas(32, 16);
  // Body: a woven trapezoid, wider at the rim.
  for (let y = 4; y < 15; y++) {
    const inset = Math.floor((y - 4) / 3);
    c.rect(2 + inset, y, 28 - inset * 2, 1, 3);
  }
  c.paint(3, 1, (x, y) => y > 4 && (x + y * 2) % 6 === 0);
  c.paint(3, 2, (x, y) => y > 4 && (x - y * 2 + 64) % 6 === 0);
  // Rim and a glimpse of the stars inside.
  c.rect(0, 2, 32, 3, 1);
  c.rect(4, 1, 3, 1, 2).rect(11, 0, 2, 2, 2).rect(20, 1, 4, 1, 2).rect(26, 0, 2, 2, 2);
  c.outline(1);
  return c.sprite("basket");
}

function heart(): Sprite {
  return Canvas.from(["01100110", "13311331", "13333331", "13333331", "01333310", "00133100", "00011000", "00000000"]).set(2, 2, 1).sprite("heart");
}

/* ---------- blocks ---------- */

const v = (name: string): Value => ({ k: "var", name });
const ev = (id: string, trigger: ObjectEvent["trigger"], blocks: Block[], extra: Partial<ObjectEvent> = {}): ObjectEvent => ({ id, trigger, blocks, ...extra });
const play = (sound: string): Block => ({ op: "play", sound });
const sound = (id: string, note: number, vol = 190) => ({ id, voices: [{ note, vol }, { note: 0, vol: 0 }, { note: 0, vol: 0 }, { note: 0, vol: 0 }] });
const text = (id: string, x: number, y: number, label: string): SceneNode => ({ id, x, y, label });
const lt = (a: Value, b: Value): Cond => ({ k: "cmp", a, op: "lt", b });
const gt = (a: Value, b: Value): Cond => ({ k: "cmp", a, op: "gt", b });
const big = (prefix: string, sprites: Sprite[], x: number, y: number): SceneNode[] => sprites.map((s, i) => ({ id: `${prefix}${i}`, sprite: s.id, x: x + i * 32, y, blend: 5 }));

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

const STAR = bigText("t_star", "STAR", 2, 3);
const CATCHER = bigText("t_catch", "CATCHER", 2, 3);
const GAME = bigText("t_game", "GAME", 1, 3);
const OVER = bigText("t_over", "OVER", 1, 3);

export function catcherProject(): Project {
  const night = tilesFromRows(nightRows(), LEGEND);
  const sky = { sprite: "night", cols: night.cols, rows: night.rows, tiles: night.tiles, solid: [] };
  const hud: Block[] = [{ op: "send", message: "hud" }];
  const loseLife: Block[] = [
    { op: "set", name: "lives", mode: "sub", value: 1 },
    ...hud,
    { op: "if", cond: { k: "cmp", a: v("lives"), op: "eq", b: 0 }, then: [{ op: "goto", scene: "over" }] },
  ];
  const fallLimit = GROUND - 12;
  const spawnX: Value = { k: "math", op: "+", a: { k: "random", max: 224 }, b: 8 };
  const showScore: Block[] = [{ op: "text", text: "SCORE ", value: v("score") }];
  const start: Block[] = [play("start"), { op: "goto", scene: "play" }];
  return {
    id: "catcher",
    kind: "visual",
    locked: true,
    name: "Star Catcher",
    author: "uxn-forge",
    width: W,
    height: H,
    // c0 night blue, c1 moonlight, c2 star yellow, c3 pink.
    theme: { r: 0x1ffe, g: 0x2fd6, b: 0x5fa9 },
    start: "title",
    updatedAt: Date.now(),
    inputs: [{ id: "space", key: 32 }],
    sprites: [tileSheet("night", TILE_CELLS), basket(), ...stars(), ...bombs(), moon(), heart(), ...STAR, ...CATCHER, ...GAME, ...OVER],
    anims: [
      { id: "twinkle", frames: ["star_0", "star_1"], rate: 12, loop: true },
      { id: "fizz", frames: ["bomb_0", "bomb_1"], rate: 5, loop: true },
    ],
    vars: [
      { id: "score", init: 0 },
      { id: "lives", init: 3 },
    ],
    sounds: [sound("ding", 84), sound("boom", 36, 230), sound("miss", 50), sound("start", 72)],
    objectDefs: [
      {
        id: "basket",
        sprite: "basket",
        kind: "player",
        blend: 5,
        // The open rim catches; the woven sides don't.
        mask: { x: 2, y: 0, w: 28, h: 8 },
        events: [
          ev("steer", "step", [
            { op: "if", cond: { k: "all", of: [{ k: "held", button: "left" }, gt({ k: "prop", prop: "x" }, 3)] }, then: [{ op: "move", dx: -4, dy: 0 }] },
            { op: "if", cond: { k: "all", of: [{ k: "held", button: "right" }, lt({ k: "prop", prop: "x" }, W - 36)] }, then: [{ op: "move", dx: 4, dy: 0 }] },
          ]),
          ev("catch", "collide", [{ op: "destroy", target: "other" }, { op: "set", name: "score", mode: "add", value: 1 }, play("ding"), ...hud], { target: "def:star" }),
          ev("boom", "collide", [{ op: "destroy", target: "other" }, play("boom"), ...loseLife], { target: "def:bomb" }),
        ],
      },
      {
        id: "star",
        sprite: "star_0",
        kind: "static",
        blend: 5,
        anim: "twinkle",
        // Each star picks its own speed when it appears.
        vars: [{ id: "speed", init: 1 }],
        events: [
          ev("pick", "create", [{ op: "set", name: "speed", scope: "self", mode: "set", value: { k: "math", op: "+", a: { k: "random", max: 2 }, b: 1 } }]),
          ev("fall", "step", [
            { op: "move", dx: 0, dy: { k: "my", name: "speed" } },
            { op: "if", cond: gt({ k: "prop", prop: "y" }, fallLimit), then: [play("miss"), { op: "destroy" }, ...loseLife] },
          ]),
        ],
      },
      {
        id: "bomb",
        sprite: "bomb_0",
        kind: "static",
        blend: 5,
        anim: "fizz",
        events: [ev("fall", "step", [{ op: "move", dx: 0, dy: 2 }, { op: "if", cond: gt({ k: "prop", prop: "y" }, fallLimit), then: [{ op: "destroy" }] }])],
      },
      {
        // A life on the HUD: hides once lives drop below its number.
        id: "life",
        sprite: "heart",
        kind: "static",
        blend: 5,
        vars: [{ id: "n", init: 1 }],
        events: [
          ev("check", "message", [{ op: "if", cond: lt(v("lives"), { k: "my", name: "n" }), then: [{ op: "hide" }], else: [{ op: "show" }] }], { message: "hud" }),
        ],
      },
    ],
    scenes: [
      {
        id: "title",
        tilemap: sky,
        nodes: [
          { id: "moon", sprite: "moon", x: 200, y: 14, blend: 5 },
          ...big("ts", STAR, 96, 36),
          ...big("tc", CATCHER, 72, 62),
          text("how1", 64, 92, "CATCH THE FALLING"),
          text("how2", 64, 102, "STARS, DODGE BOMBS"),
          { id: "s1", sprite: "star_0", anim: "twinkle", x: 40, y: 40, blend: 5 },
          { id: "s2", sprite: "star_1", anim: "twinkle", x: 212, y: 84, blend: 5 },
          { id: "b1", sprite: "bomb_0", anim: "fizz", x: 28, y: 92, blend: 5 },
          { id: "player", sprite: "basket", x: 112, y: GROUND - 16, blend: 5 },
          blinking("go", 84, 128, "PRESS SPACE"),
        ],
        events: [ev("start", "key", start, { key: "space" })],
      },
      {
        id: "play",
        tilemap: sky,
        pool: 16,
        nodes: [
          { id: "moon", sprite: "moon", x: 200, y: 22, blend: 5 },
          { id: "player", def: "basket", x: 112, y: GROUND - 16 },
          { id: "score", x: 8, y: 6, label: "SCORE 0", events: [ev("show", "create", showScore), ev("hud", "message", showScore, { message: "hud" })] },
          { id: "life1", def: "life", x: 220, y: 6, vars: { n: 1 } },
          { id: "life2", def: "life", x: 232, y: 6, vars: { n: 2 } },
          { id: "life3", def: "life", x: 244, y: 6, vars: { n: 3 } },
        ],
        events: [
          ev("reset", "create", [{ op: "set", name: "score", mode: "set", value: 0 }, { op: "set", name: "lives", mode: "set", value: 3 }, ...hud, { op: "wait", ticks: 30 }]),
          // Every half second: one in five drops is a bomb.
          ev("drop", "alarm", [
            {
              op: "if",
              cond: { k: "cmp", a: { k: "random", max: 5 }, op: "eq", b: 0 },
              then: [{ op: "spawn", def: "bomb", x: spawnX, y: 16 }],
              else: [{ op: "spawn", def: "star", x: spawnX, y: 16 }],
            },
            { op: "wait", ticks: 30 },
          ]),
        ],
      },
      {
        id: "over",
        tilemap: sky,
        nodes: [
          { id: "moon", sprite: "moon", x: 200, y: 14, blend: 5 },
          ...big("og", GAME, 64, 48),
          ...big("oo", OVER, 136, 48),
          { id: "final", x: 96, y: 88, label: "SCORE 0", events: [ev("show", "create", showScore)] },
          blinking("retry", 80, 112, "SPACE: AGAIN"),
        ],
        events: [ev("again", "key", start, { key: "space" })],
      },
    ],
  };
}
