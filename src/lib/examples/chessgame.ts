/* Chess in the engine model — the showcase example.
   Scenes: menu (title + side pick) → play, with pause and game-over opened on top
   (the board freezes underneath). Templates: piece (32, each with its
   own `sq` and `code` variables), dot (legal-move markers, created and
   destroyed as you select), sel (the frame on the selected square) and pointer (the drawn mouse). The play scene's own events
   are the referee: mouse presses and releases go to the rules, and
   messages tell the pieces what happened (moved, rook, relayout). The
   rules and the computer player stay code — rules.ux from the
   hand-written game, plus chess.ux, the functions the blocks call.

   Polish, the same way as the other examples: a 256×192 screen, the
   board and side panel drawn as one tile layer (24px squares, cards
   for the turn, score and buttons), shaded and outlined 16×16 pieces
   generated below from silhouettes, 2× headline type, a title and a
   side pick on one screen, the armies lined up on a checkered floor.
   Locked: Duplicate to edit. */
import rulesRaw from "./chess/rules.ux?raw";
import piecesRaw from "./chess/pieces.ux?raw";
import chessGlue from "./chess/chess.ux?raw";
import { tilesFromRows, type Block, type ObjectEvent, type Project, type SceneNode, type Sprite, type Tilemap, type Value } from "../project";
import { Canvas, art, bigText, tileSheet } from "./pixel";

const COLS = 32;
const ROWS = 24;
/** Board origin and square size (chess.ux uses the same numbers). */
const BX = 64;
const SQ = 24;

/* ---------- palette: c0 navy, c1 cream, c2 wood, c3 teal ---------- */
const THEME = { r: 0x1fb4, g: 0x2e7a, b: 0x3c48 };
/** Pieces draw with blend 0: 1 → navy, 2 → cream, 3 → wood, 0 clear. */
const PIECE_BLEND = 0;

/* ---------- pieces: silhouettes (# body, d detail) ---------- */

const half = (rows: string[]): string[] => rows.map((r) => r + [...r].reverse().join(""));

const SHAPES: Record<string, string[]> = {
  pawn: half([
    "........", "........", "......##", ".....###", ".....###", "......##", ".....###", "......##",
    "......##", ".....###", "....####", "....dddd", "...#####", "..######", "..######", "........",
  ]),
  knight: [
    "................",
    "......#.#.......",
    ".....######.....",
    "....########....",
    "...###d######...",
    "..###########...",
    ".############...",
    ".#####..######..",
    "..###...######..",
    "......#######...",
    ".....########...",
    "....#########...",
    "...dddddddddd...",
    "..############..",
    "..############..",
    "................",
  ],
  bishop: [
    "................",
    ".......##.......",
    "......####......",
    ".....##d###.....",
    "....###d####....",
    "....##d#####....",
    "....########....",
    ".....######.....",
    "......####......",
    ".....dddddd.....",
    ".....######.....",
    "....########....",
    "...##########...",
    "..############..",
    "..############..",
    "................",
  ],
  rook: half([
    "........", "...##.##", "...##.##", "...#####", "....dddd", ".....###", ".....###", ".....###",
    ".....###", ".....###", "....####", "...ddddd", "...#####", "..######", "..######", "........",
  ]),
  queen: half([
    "........", ".#.....#", ".##...##", ".###.###", "..######", "..######", "...ddddd", "....####",
    ".....###", ".....###", "....####", "...ddddd", "...#####", "..######", "..######", "........",
  ]),
  king: half([
    "........", ".......#", "......##", ".......#", ".....###", "...#####", "..######", "..######",
    "...#####", "....dddd", ".....###", "....####", "...ddddd", "..######", "..######", "........",
  ]),
};

/** One 16×16 piece. White: cream body, navy details and outline,
    wood shading dithered down the right side. Black: navy body and
    outline, cream details, a wood rim light down the left. */
function piece(shape: string[], black: boolean): Canvas {
  const c = new Canvas(16, 16);
  shape.forEach((row, y) => {
    const xs = [...row].map((ch, x) => (ch === "." ? -1 : x)).filter((x) => x >= 0);
    if (!xs.length) return;
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    [...row].forEach((ch, x) => {
      if (ch === ".") return;
      if (ch === "d") c.set(x, y, black ? 2 : 1);
      else if (black) c.set(x, y, x === lo + 1 && hi - lo >= 4 ? 3 : 1);
      else c.set(x, y, x >= hi - 1 && (x + y) % 2 === 0 ? 3 : x === hi ? 3 : 2);
    });
  });
  return c.outline(1);
}

/** A 2×2 sheet of 16px cells (cells run row-major). */
function sheet(id: string, cells: Canvas[]): Sprite {
  const c = new Canvas(32, 32);
  cells.forEach((p, i) => c.stamp((i % 2) * 16, Math.floor(i / 2) * 16, p.rows()));
  return c.sprite(id, { w: 2, h: 2 });
}

const KINDS = ["pawn", "knight", "bishop", "rook", "queen", "king"] as const;
const pieceOf = (kind: (typeof KINDS)[number], black: boolean) => piece(SHAPES[kind], black);

/** Three 2×2 sheets (a sprite holds at most 4×4 tiles), white pair
    on top, black below: pawn + queen, knight + bishop, rook + king.
    Pawns share a sheet with queens, so a promotion is a cell change. */
const PAIRS: Record<string, [(typeof KINDS)[number], (typeof KINDS)[number]]> = { pc_pq: ["pawn", "queen"], pc_nb: ["knight", "bishop"], pc_rk: ["rook", "king"] };
/** Per rules kind (P N B R Q K): its sheet and column (pc_cell agrees). */
const KIND_LOOK: Array<[string, number]> = [["pc_pq", 0], ["pc_nb", 0], ["pc_nb", 1], ["pc_rk", 0], ["pc_pq", 1], ["pc_rk", 1]];

function pieceSheets(): Sprite[] {
  return Object.entries(PAIRS).map(([id, [a, b]]) => sheet(id, [pieceOf(a, false), pieceOf(b, false), pieceOf(a, true), pieceOf(b, true)]));
}

/** Where a piece code's art lives. */
function pieceLook(code: number): { sprite: string; cell: number } {
  const [sprite, col] = KIND_LOOK[(code - 1) % 6];
  return { sprite, cell: col + Math.floor((code - 1) / 6) * 2 };
}

/** Legal-move marker: a teal bead with a cream glint. */
function dot(): Sprite {
  const c = new Canvas(16, 16).disc(8, 8, 3.5, 3);
  c.set(6, 6, 1).set(7, 6, 1).set(6, 7, 1);
  return c.sprite("dot");
}

/** Selection frame, 24×24: a 2px border with notched corners and
    inner corner ticks in a second color. */
function frame(id: string, color: number, tick: number): Sprite {
  const c = new Canvas(24, 24);
  for (let i = 1; i < 23; i++)
    for (const t of [0, 1]) c.set(i, t, color).set(i, 23 - t, color).set(t, i, color).set(23 - t, i, color);
  for (let i = 2; i < 6; i++)
    for (const [x, y] of [[i, 2], [2, i], [21 - i + 2, 2], [21, i], [i, 21], [2, 21 - i + 2], [21 - i + 2, 21], [21, 21 - i + 2]]) c.set(x, y, tick);
  return c.sprite(id);
}

/** Mouse pointer: cream arrow, navy edge (blend 0). */
const CURSOR = ["22110000", "22211000", "22221100", "22222110", "22222210", "22221110", "22112100", "21112100"];

/* ---------- tiles ---------- */

const plain = (d: string) => Array(8).fill(d.repeat(8));
const TILES: string[][] = [
  plain("1"), // 0 light square (cream)
  plain("2"), // 1 dark square (wood)
  ["00000000", "00000000", "00000000", "00030000", "00000000", "00000000", "00000000", "00000000"], // 2 panel dots
  Array(8).fill("00000301"), // 3 panel edge beside the board
  ["00000000", "00000000", "00003333", "00030000", "00300000", "00300000", "00300000", "00300000"], // 4 card ┌
  ["00000000", "00000000", "33333333", "00000000", "00000000", "00000000", "00000000", "00000000"], // 5 card ─ top
  ["00000000", "00000000", "33330000", "00003000", "00000300", "00000300", "00000300", "00000300"], // 6 card ┐
  Array(8).fill("00300000"), // 7 card │ left
  Array(8).fill("00000300"), // 8 card │ right
  ["00300000", "00300000", "00300000", "00300000", "00030000", "00003333", "00000000", "00000000"], // 9 card └
  ["00000000", "00000000", "00000000", "00000000", "00000000", "33333333", "00000000", "00000000"], // 10 card ─ bottom
  ["00000300", "00000300", "00000300", "00000300", "00003000", "33330000", "00000000", "00000000"], // 11 card ┘
  ["33333333", "11111111", "11111111", "11111111", "11111111", "11111111", "11111111", "11111111"], // 12 floor light, top edge
  ["33333333", "22222222", "22222222", "22222222", "22222222", "22222222", "22222222", "22222222"], // 13 floor dark, top edge
];
const LEGEND: Record<string, number> = { L: 1, D: 2, ".": 3, "|": 4, q: 5, "-": 6, p: 7, "[": 8, "]": 9, b: 10, _: 11, d: 12, l: 13, k: 14 };

class Grid {
  g: string[][] = Array.from({ length: ROWS }, () => Array<string>(COLS).fill("."));
  card(c0: number, r0: number, c1: number, r1: number): this {
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const top = r === r0, bot = r === r1, left = c === c0, right = c === c1;
        this.g[r][c] = top ? (left ? "q" : right ? "p" : "-") : bot ? (left ? "b" : right ? "d" : "_") : left ? "[" : right ? "]" : " ";
      }
    return this;
  }
  map(): Tilemap {
    const t = tilesFromRows(this.g.map((r) => r.join("")), LEGEND);
    return { sprite: "tiles", cols: t.cols, rows: t.rows, tiles: t.tiles, solid: [] };
  }
}

/** Play: side panel with three cards and the 8×8 board of 3×3-tile squares. */
function playMap(): Tilemap {
  const g = new Grid().card(0, 3, 6, 9).card(0, 11, 6, 14).card(0, 16, 6, 18).card(0, 20, 6, 22);
  for (let r = 0; r < ROWS; r++) {
    g.g[r][7] = "|";
    for (let c = 8; c < COLS; c++) g.g[r][c] = (Math.floor((c - 8) / 3) + Math.floor(r / 3)) % 2 === 0 ? "L" : "D";
  }
  return g.map();
}

/** Title screen: dotted backdrop, cards with a 2×2-tile square for a
    king to stand on, and a checkered floor. */
function hallMap(cards: Array<[number, number, number, number]>, plinths: Array<[number, number, "L" | "D"]>): Tilemap {
  const g = new Grid();
  for (const c of cards) g.card(...c);
  for (const [c, r, t] of plinths) for (const [dc, dr] of [[0, 0], [1, 0], [0, 1], [1, 1]]) g.g[r + dr][c + dc] = t;
  for (let r = 20; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const light = (Math.floor(c / 2) + Math.floor((r - 20) / 2)) % 2 === 0;
      g.g[r][c] = r === 20 ? (light ? "l" : "k") : light ? "L" : "D";
    }
  return g.map();
}

/* ---------- blocks ---------- */

const v = (name: string): Value => ({ k: "var", name });
const my = (name: string): Value => ({ k: "my", name });
const call = (fn: string, ...args: Value[]): Value => ({ k: "call", fn, args });
const prop = (p: "x" | "y" | "cell"): Value => ({ k: "prop", prop: p });
const mouse = (axis: "x" | "y"): Value => ({ k: "mouse", axis });
const sub = (a: Value, b: Value): Value => ({ k: "math", op: "-", a, b });
const eq = (a: Value, b: Value) => ({ k: "cmp" as const, a, op: "eq" as const, b });
const ev = (id: string, trigger: ObjectEvent["trigger"], blocks: Block[], extra: Partial<ObjectEvent> = {}): ObjectEvent => ({ id, trigger, blocks, ...extra });
const ifThen = (cond: Extract<Block, { op: "if" }>["cond"], then: Block[], otherwise?: Block[]): Block => ({ op: "if", cond, then, ...(otherwise ? { else: otherwise } : {}) });
const send = (message: string): Block => ({ op: "send", message });
const play = (sound: string): Block => ({ op: "play", sound });
const text = (t: string, value?: Value): Block => ({ op: "text", text: t, ...(value !== undefined ? { value } : {}) });
const label = (id: string, x: number, y: number, l: string, events?: ObjectEvent[]): SceneNode => ({ id, x, y, label: l, ...(events ? { events } : {}) });
/** Clickable text; the label is padded so the hitbox is generous. */
const button = (id: string, x: number, y: number, word: string, blocks: Block[], blend?: number): SceneNode => ({
  ...label(id, x, y, ` ${word} `, [ev("click", "click", blocks)]),
  ...(blend !== undefined ? { blend } : {}),
});
/** Overlay text sits on the frozen board, on the foreground layer
    where color 0 is see-through, so the paper must be a real color:
    blend 13 = cream ink on teal. */
const PAPER = 13;

/** An overlay dialog: equal-width rows of paper (12 characters, a
    blank row between lines) centered on the board. Rows with blocks
    are buttons. */
function dialog(rows: Array<[string, string, Block[]?, ObjectEvent[]?]>): SceneNode[] {
  const x = BX + 96 - 48;
  const y = 96 - rows.length * 8;
  const nodes: SceneNode[] = [{ id: "pad0", x, y, label: " ".repeat(12), blend: PAPER }];
  rows.forEach(([id, t, blocks, events], i) => {
    const pad = Math.floor((12 - t.length) / 2);
    const l = (" ".repeat(pad) + t).padEnd(12);
    nodes.push({ ...label(id, x, y + 8 + i * 16, l, blocks ? [ev("click", "click", blocks)] : events), blend: PAPER });
    nodes.push({ id: `pad${i + 1}`, x, y: y + 16 + i * 16, label: " ".repeat(12), blend: PAPER });
  });
  return nodes;
}

const big = (prefix: string, sprites: Sprite[], x: number, y: number): SceneNode[] => sprites.map((s, i) => ({ id: `${prefix}${i}`, sprite: s.id, x: x + i * 32, y, blend: 5 }));
const pieceNode = (id: string, code: number, x: number, y: number): SceneNode => ({ id, ...pieceLook(code), x, y, blend: PIECE_BLEND });

/** Both armies lined up on the floor's last rank, one per square. */
function armies(): SceneNode[] {
  const order = [3, 1, 2, 4, 5, 0]; // R N B Q K P
  return [
    ...order.map((k, i) => pieceNode(`w${i}`, k + 1, i * 16, 176)),
    ...order.map((k, i) => pieceNode(`b${i}`, k + 7, 240 - i * 16, 176)),
  ];
}

const FILES = "abcdefgh";
const BACK_RANK = [3, 1, 2, 4, 5, 2, 1, 3]; // R N B Q K B N R as PT kinds

/** The 32 pieces in the starting position, white at the bottom. */
function startPieces(): SceneNode[] {
  const nodes: SceneNode[] = [];
  const place = (side: 0 | 1, kind: number, f: number, row: number): void => {
    const code = side * 6 + kind + 1;
    nodes.push({ id: `${side ? "b" : "w"}_${FILES[f]}${8 - row}`, def: "piece", ...pieceLook(code), x: BX + f * SQ + 4, y: row * SQ + 4, vars: { code } });
  };
  for (let f = 0; f < 8; f++) {
    place(1, BACK_RANK[f], f, 0);
    place(1, 0, f, 1);
    place(0, 0, f, 6);
    place(0, BACK_RANK[f], f, 7);
  }
  return nodes;
}

const pointer = (): SceneNode => ({ id: "pointer", def: "pointer", x: 0, y: 0 });

/** Where a piece stands, through the current view. */
const placeAt = (sq: Value): Block => ({ op: "set_pos", x: call("sq_x", sq), y: call("sq_y", sq) });
const CHESS = bigText("t_chess", "CHESS", 1, 3);

export function chessProject(): Project {
  const sound = (id: string, note: number) => ({ id, voices: [{ note, vol: 200 }, { note: 0, vol: 0 }, { note: 0, vol: 0 }, { note: 0, vol: 0 }] });
  const pick = (side: number): Block[] => [{ op: "set", name: "side", mode: "set", value: side }, play("go"), { op: "goto", scene: "play" }];
  return {
    id: "chess",
    kind: "visual",
    locked: true,
    name: "Chess",
    author: "uxn-forge",
    width: COLS * 8,
    height: ROWS * 8,
    theme: { ...THEME },
    start: "menu",
    updatedAt: Date.now(),
    gameCursor: true,
    inputs: [
      { id: "confirm", key: 13 },
      { id: "pause", key: 27 },
    ],
    sprites: [
      tileSheet("tiles", TILES),
      ...pieceSheets(),
      dot(),
      art("cursor", CURSOR),
      ...CHESS,
    ],
    anims: [],
    vars: [
      { id: "side", init: 0 },
      { id: "r", init: 0 },
      { id: "i", init: 0 },
    ],
    sounds: [sound("select", 79), sound("move", 76), sound("capture", 55), sound("bad", 48), sound("check", 81), sound("menu", 67), sound("go", 72)],
    songs: [
      {
        id: "fanfare",
        tracks: [
          { vol: 180, notes: [72, 76, 79, 84].map((pitch) => ({ pitch, len: 8 })).concat([{ pitch: 127, len: 32 }]) },
          { vol: 0, notes: [] },
          { vol: 0, notes: [] },
          { vol: 0, notes: [] },
        ],
      },
    ],
    scripts: [
      { path: "chess.ux", code: chessGlue },
      { path: "rules.ux", code: rulesRaw },
      { path: "pieces.ux", code: piecesRaw },
    ],
    objectDefs: [
      {
        id: "piece",
        sprite: "pc_pq",
        kind: "static",
        blend: PIECE_BLEND,
        vars: [
          { id: "sq", init: 0 },
          { id: "code", init: 1 },
        ],
        events: [
          ev("place", "create", [
            { op: "set", name: "sq", scope: "self", mode: "set", value: call("layout_sq", prop("x"), prop("y")) },
            { op: "call", fn: "put_piece", args: [my("sq"), my("code")] },
            placeAt(my("sq")),
          ]),
          ev("drag", "step", [ifThen(eq(call("grabbed_sq"), my("sq")), [{ op: "set_pos", x: sub(mouse("x"), 8), y: sub(mouse("y"), 8) }])]),
          ev(
            "moved",
            "message",
            [
              ifThen(
                eq(my("sq"), call("captured_sq")),
                [{ op: "destroy" }],
                [
                  ifThen(eq(my("sq"), call("move_from")), [
                    { op: "set", name: "sq", scope: "self", mode: "set", value: call("move_to") },
                    { op: "glide", x: call("sq_x", my("sq")), y: call("sq_y", my("sq")), frames: 8 },
                    // A pawn that reached the far rank comes back a queen
                    // (the queen is the next cell of the pawn's sheet).
                    { op: "cell", cell: call("pc_cell", call("code_at", my("sq"))) },
                  ]),
                ],
              ),
            ],
            { message: "moved" },
          ),
          ev(
            "rook",
            "message",
            [
              ifThen(eq(my("sq"), call("rook_from")), [
                { op: "set", name: "sq", scope: "self", mode: "set", value: call("rook_to") },
                { op: "glide", x: call("sq_x", my("sq")), y: call("sq_y", my("sq")), frames: 8 },
              ]),
            ],
            { message: "rook" },
          ),
          ev("relayout", "message", [placeAt(my("sq"))], { message: "relayout" }),
        ],
      },
      { id: "dot", sprite: "dot", kind: "static", blend: 5 },
      { id: "pointer", sprite: "cursor", kind: "static", blend: 0, events: [ev("follow", "step", [{ op: "set_pos", x: mouse("x"), y: mouse("y") }])] },
    ],
    scenes: [
      {
        // Title and side pick in one screen: click a king's card (or
        // press Enter to play white).
        id: "menu",
        tilemap: hallMap(
          [
            [5, 9, 14, 16],
            [17, 9, 26, 16],
          ],
          [
            [9, 10, "D"],
            [21, 10, "L"],
          ],
        ),
        nodes: [
          ...big("t", CHESS, 80, 16),
          label("ask", 52, 52, "YOU VS COMPUTER AS"),
          pieceNode("wk", 6, 72, 80),
          pieceNode("bk", 12, 168, 80),
          button("white", 52, 108, "WHITE", pick(0)),
          button("black", 148, 108, "BLACK", pick(1)),
          ...armies(),
          pointer(),
        ],
        events: [ev("enter", "key", pick(0), { key: "confirm" })],
      },
      {
        id: "play",
        tilemap: playMap(),
        pool: 30,
        nodes: [
          ...startPieces(),
          label("title", 12, 8, "CHESS"),
          {
            id: "turnk",
            ...pieceLook(6),
            x: 20,
            y: 42,
            blend: PIECE_BLEND,
            events: [ev("show", "step", [{ op: "cell", cell: call("turn_cell") }])],
          },
          // The king above says whose turn it is; this says when it's check.
          label("turnl", 12, 30, "TURN"),
          label("turn", 8, 62, "     ", [ev("show", "step", [ifThen(eq(call("checked"), 1), [text("CHECK")], [text("     ")])])]),
          label("scorel", 8, 96, "SCORE"),
          label("score", 16, 106, "+0", [
            ev("show", "step", [
              ifThen(
                { k: "cmp", a: call("material_white"), op: "gte", b: 1000 },
                [text("+", sub(call("material_white"), 1000))],
                [text("-", call("material_white"))],
              ),
            ]),
          ]),
          button("flip", 4, 136, "FLIP", [play("menu"), { op: "call", fn: "flip_view", args: [] }, send("deselect"), send("relayout")]),
          button("menu", 4, 168, "MENU", [play("menu"), { op: "overlay", scene: "pause" }]),
          pointer(),
        ],
        events: [
          ev("start", "create", [{ op: "call", fn: "new_game", args: [v("side")] }, { op: "wait", ticks: 20 }]),
          ev("press", "click", [
            { op: "set", name: "r", mode: "set", value: call("press", mouse("x"), mouse("y")) },
            ifThen(eq(v("r"), 1), [play("select"), send("select")]),
            ifThen(eq(v("r"), 2), [send("turn_done")]),
            ifThen(eq(v("r"), 3), [send("deselect")]),
            ifThen(eq(v("r"), 4), [play("bad")]),
          ]),
          ev("drop", "release", [
            { op: "set", name: "r", mode: "set", value: call("release", mouse("x"), mouse("y")) },
            ifThen(eq(v("r"), 2), [send("turn_done")]),
            ifThen(eq(v("r"), 5), [send("relayout")]),
          ]),
          ev("pause", "key", [play("menu"), { op: "overlay", scene: "pause" }], { key: "pause" }),
          ev(
            "select",
            "message",
            [
              { op: "destroy", target: "def:dot" },
              { op: "repeat", times: 64, index: "i", body: [ifThen(eq(call("is_target", v("i")), 1), [{ op: "spawn", def: "dot", x: call("sq_x", v("i")), y: call("sq_y", v("i")) }])] },
            ],
            { message: "select" },
          ),
          ev("deselect", "message", [{ op: "destroy", target: "def:dot" }], { message: "deselect" }),
          ev(
            "turn_done",
            "message",
            [
              send("deselect"),
              send("moved"),
              ifThen({ k: "cmp", a: call("rook_from"), op: "neq", b: 64 }, [send("rook")]),
              ifThen({ k: "cmp", a: call("captured_sq"), op: "neq", b: 64 }, [play("capture")], [play("move")]),
              ifThen(eq(call("new_check"), 1), [play("check")]),
              ifThen({ k: "cmp", a: call("status"), op: "gte", b: 2 }, [{ op: "wait", ticks: 40, slot: 1 }], [ifThen(eq(call("human_turn"), 0), [{ op: "wait", ticks: 14 }])]),
            ],
            { message: "turn_done" },
          ),
          ev("ai", "alarm", [ifThen(eq(call("human_turn"), 0), [ifThen(eq(call("ai_move"), 1), [send("turn_done")])])]),
          ev("over", "alarm", [{ op: "overlay", scene: "over" }], { alarm: 1 }),
        ],
      },
      {
        id: "pause",
        nodes: [
          ...dialog([
            ["paused", "PAUSED"],
            ["resume", "RESUME", [play("menu"), { op: "back" }]],
            ["quit", "MENU", [play("menu"), { op: "goto", scene: "menu" }]],
          ]),
          pointer(),
        ],
        events: [ev("resume", "key", [{ op: "back" }], { key: "pause" })],
      },
      {
        id: "over",
        nodes: [
          ...dialog([
            ["result", "GAME OVER", undefined, [ev("say", "create", [ifThen(eq(call("result"), 1), [text(" WHITE WINS ")], [ifThen(eq(call("result"), 2), [text(" BLACK WINS ")], [text("    DRAW    ")])])])]],
            ["again", "AGAIN", [{ op: "song_stop" }, { op: "goto", scene: "play" }]],
            ["menu", "MENU", [{ op: "song_stop" }, { op: "goto", scene: "menu" }]],
          ]),
          pointer(),
        ],
        events: [ev("fanfare", "create", [{ op: "song", song: "fanfare" }])],
      },
    ],
  };
}
