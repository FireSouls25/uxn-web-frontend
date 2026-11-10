/* Chess showcase: the hand-written game from uxn-webpage/chess/ on
   the SCRIPT loop, built on engine features rather than around them:
   - Art is studio data. `pieces` is a 4×3 sprite SHEET (one 8×8 cell
     per piece, white P N B R Q K then black), `squares` a 4×2 sheet of
     two 16×16 cells (light, dark), plus `dot` and `cursor`.
   - The board is a SCENE: `board` holds the 64 squares, `setup` nests
     it and places the 32 pieces. Script code reads them through the
     generated scene module — draw_scene_board() paints the squares,
     scn_setup is the starting position (move a piece in the Scene
     editor and the game starts from there).
   - Colors are Varvara blends per node: white pieces blend 0 (1 →
     orange fill, 2 → black rim, 0 clear), black pieces blend 5 (1 →
     black fill, 3 → dark-blue rim, 0 clear) and rotated 180° on the far
     side — the Scene view paints exactly what the VM paints.
   game.ux, rules.ux and pieces.ux are the local files verbatim
   (synced by scripts/sync-chess.sh); the local build imports the
   generated assets.ux this project exports (npm run sync:chess-assets).
   Locked; Duplicate to edit. */
import gameRaw from "./examples/chess/game.ux?raw";
import rulesRaw from "./examples/chess/rules.ux?raw";
import piecesRaw from "./examples/chess/pieces.ux?raw";
import chessGlue from "./examples/chess/chess.ux?raw";
import type { Block, ObjectEvent, Project, SceneNode, Sprite, Value } from "./project";

/** 12 piece tiles as rows of palette indices, PT order per side. */
const PIECE_ROWS: string[][] = [
  // white pawn
  ['00211200', '02211220', '02111120', '02211220', '22111122', '21111112', '21111112', '11111111'],
  // white knight
  ['02211120', '02111122', '02112112', '22111112', '21111122', '21111122', '21111112', '11111111'],
  // white bishop
  ['02211220', '02111120', '02122120', '02211220', '22111122', '21111112', '21111112', '11111111'],
  // white rook
  ['21122112', '21111112', '22211222', '00211200', '00211200', '02211220', '22111122', '11111111'],
  // white queen
  ['21122112', '21122112', '21111112', '22211222', '22111122', '21111112', '21111112', '11111111'],
  // white king
  ['00211200', '22211222', '21111112', '22211222', '22111122', '21111112', '21111112', '11111111'],
  // black pawn
  ['00311300', '03311330', '03111130', '03311330', '33111133', '31111113', '31111113', '11111111'],
  // black knight
  ['03311130', '03111133', '03113113', '33111113', '31111133', '31111133', '31111113', '11111111'],
  // black bishop
  ['03311330', '03111130', '03133130', '03311330', '33111133', '31111113', '31111113', '11111111'],
  // black rook
  ['31133113', '31111113', '33311333', '00311300', '00311300', '03311330', '33111133', '11111111'],
  // black queen
  ['31133113', '31133113', '31111113', '33311333', '33111133', '31111113', '31111113', '11111111'],
  // black king
  ['00311300', '33311333', '31111113', '33311333', '33111133', '31111113', '31111113', '11111111'],
];

const CURSOR_ROWS = ["11220000", "11122000", "11112200", "11111220", "11111120", "11112220", "11221200", "12221200"];
const DOT_ROWS = ["00000000", "00000000", "00011000", "00111100", "00111100", "00011000", "00000000", "00000000"];

const tilePixels = (rows: string[]): number[] => rows.flatMap((r) => [...r].map(Number));

/** Theme: orange panel (c0), black (c1), light squares (c2), dark
    blue (c3). Color 0 is the top nibble of each word. */
export const CHESS_THEME = { r: 0xb0a2, g: 0x80b3, b: 0x40c6 };

/** White and black draw looks — the same values pieces.ux names
    (PIECE_BLEND_W / PIECE_BLEND_B). */
export const PIECE_BLEND = [0, 5] as const;

export function chessArt(): Sprite[] {
  // squares: 4×2 tiles, two 2×2 cells. Tile-major pixels: tiles 0,1
  // (top row) and 4,5 (bottom) are cell 0 (light = color 2); tiles
  // 2,3,6,7 are cell 1 (dark = color 3).
  const squares: number[] = [];
  for (let t = 0; t < 8; t++) squares.push(...Array<number>(64).fill(t % 4 < 2 ? 2 : 3));
  return [
    { id: "pieces", w: 4, h: 3, cell: { w: 1, h: 1 }, pixels: PIECE_ROWS.flatMap(tilePixels) },
    { id: "squares", w: 4, h: 2, cell: { w: 2, h: 2 }, pixels: squares },
    { id: "dot", pixels: tilePixels(DOT_ROWS) },
    { id: "cursor", pixels: tilePixels(CURSOR_ROWS) },
  ];
}

const FILES = "abcdefgh";
const BACK_RANK = [3, 1, 2, 4, 5, 2, 1, 3]; // R N B Q K B N R as PT kinds

/** `board`: the 64 squares at their screen cells (x64.., 16px). */
function boardScene(): { id: string; nodes: SceneNode[]; clicks: []; keys: [] } {
  const nodes: SceneNode[] = [];
  for (let dy = 0; dy < 8; dy++) {
    for (let dx = 0; dx < 8; dx++) {
      const dark = (dx + dy) % 2 === 1;
      nodes.push({ id: `${FILES[dx]}${8 - dy}`, sprite: "squares", x: 64 + dx * 16, y: dy * 16, ...(dark ? { cell: 1 } : {}) });
    }
  }
  return { id: "board", nodes, clicks: [], keys: [] };
}

/** `setup`: the board plus the starting position, white at the
    bottom. A piece's cell is side*6 + kind; black sits on the far
    side, so it's rotated (both flips) like the game draws it. */
function setupScene(): { id: string; nodes: SceneNode[]; clicks: []; keys: [] } {
  const nodes: SceneNode[] = [{ id: "board", scene: "board", x: 0, y: 0 }];
  const place = (side: 0 | 1, kind: number, dx: number, dy: number): void => {
    nodes.push({
      id: `${side ? "b" : "w"}_${FILES[dx]}${8 - dy}`,
      sprite: "pieces",
      x: 64 + dx * 16 + 4,
      y: dy * 16 + 4,
      ...(side * 6 + kind ? { cell: side * 6 + kind } : {}),
      ...(side ? { flipX: true, flipY: true } : {}),
      blend: PIECE_BLEND[side],
    });
  };
  for (let dx = 0; dx < 8; dx++) {
    place(1, BACK_RANK[dx], dx, 0);
    place(1, 0, dx, 1);
    place(0, 0, dx, 6);
    place(0, BACK_RANK[dx], dx, 7);
  }
  return { id: "setup", nodes, clicks: [], keys: [] };
}

const HOOKS = `( uxn-forge hooks — the whole game lives in game.ux. The engine
  sets the palette (project theme) and the 192x128 screen, then
  calls these. Same wiring as the local chess/main.ux. )

custom_setup :: fn() {
    game_boot();
}

custom_frame :: fn() {
    game_frame();
}

custom_key :: fn() {
    game_key();
}

custom_mouse :: fn() {
    game_mouse();
}
`;

/** The hand-written script-loop game (chess/game.ux): kept only to
    export the local build's assets.ux (sprites + scene modules). */
export function chessScriptProject(): Project {
  return {
    id: "chess",
    kind: "visual",
    locked: true,
    loop: "script",
    name: "Chess",
    author: "etal",
    width: 192,
    height: 128,
    theme: { ...CHESS_THEME },
    start: "setup",
    updatedAt: Date.now(),
    inputs: [
      { id: "confirm", key: 13 },
      { id: "pause", key: 27 },
    ],
    sprites: chessArt(),
    gameCursor: true,
    anims: [],
    customCode: HOOKS,
    scripts: [
      { path: "game.ux", code: gameRaw },
      { path: "rules.ux", code: rulesRaw },
      { path: "pieces.ux", code: piecesRaw },
    ],
    scenes: [setupScene(), boardScene()],
  };
}

/* ==================================================================
   Chess in the engine model — the showcase example.
   Scenes: menu → side → play, with pause and game-over opened on top
   (the board freezes underneath). Templates: tile (the board, 16 of
   them), piece (32, each with its own `sq` variable), dot (legal-move
   markers, created and destroyed as you select) and pointer (the
   drawn mouse). The play scene's own events are the referee: mouse
   presses and releases go to the rules, and messages tell the pieces
   what happened (moved, rook, relayout). The rules and the computer
   player stay code — rules.ux from the hand-written game, plus
   chess.ux, the small set of functions the blocks call.
   ================================================================== */

const v = (name: string): Value => ({ k: "var", name });
const my = (name: string): Value => ({ k: "my", name });
const call = (fn: string, ...args: Value[]): Value => ({ k: "call", fn, args });
const prop = (p: "x" | "y" | "cell"): Value => ({ k: "prop", prop: p });
const mouse = (axis: "x" | "y"): Value => ({ k: "mouse", axis });
const add = (a: Value, b: Value): Value => ({ k: "math", op: "+", a, b });
const sub = (a: Value, b: Value): Value => ({ k: "math", op: "-", a, b });
const eq = (a: Value, b: Value) => ({ k: "cmp" as const, a, op: "eq" as const, b });
const ev = (id: string, trigger: ObjectEvent["trigger"], blocks: Block[], extra: Partial<ObjectEvent> = {}): ObjectEvent => ({ id, trigger, blocks, ...extra });
const ifThen = (cond: Extract<Block, { op: "if" }>["cond"], then: Block[], otherwise?: Block[]): Block => ({ op: "if", cond, then, ...(otherwise ? { else: otherwise } : {}) });
const send = (message: string): Block => ({ op: "send", message });
const play = (sound: string): Block => ({ op: "play", sound });
const text = (t: string, value?: Value): Block => ({ op: "text", text: t, ...(value !== undefined ? { value } : {}) });
const button = (id: string, x: number, y: number, label: string, blocks: Block[], blend?: number): SceneNode => ({ id, x, y, label, ...(blend !== undefined ? { blend } : {}), events: [ev("click", "click", blocks)] });
/** Overlay text sits on the frozen board. Overlays draw on the
    foreground layer, where color 0 is see-through, so the paper must
    be a real color: blend 9 = black ink on light paper. */
const PAPER = 9;

/** Board block: 32×32 = 2×2 squares (light top-left, like a8). */
function board4(): Sprite {
  const px: number[] = [];
  for (let t = 0; t < 16; t++) {
    const light = (t % 4 < 2) === (Math.floor(t / 4) < 2);
    px.push(...Array<number>(64).fill(light ? 2 : 3));
  }
  return { id: "board4", w: 4, h: 4, pixels: px };
}

/** The 32 pieces in the starting position, white at the bottom. */
function startPieces(): SceneNode[] {
  const nodes: SceneNode[] = [];
  const place = (side: 0 | 1, kind: number, dx: number, dy: number): void => {
    nodes.push({
      id: `${side ? "b" : "w"}_${FILES[dx]}${8 - dy}`,
      def: "piece",
      x: 64 + dx * 16 + 4,
      y: dy * 16 + 4,
      ...(side * 6 + kind ? { cell: side * 6 + kind } : {}),
      ...(side ? { flipX: true, flipY: true, blend: 5 } : {}),
    });
  };
  for (let dx = 0; dx < 8; dx++) {
    place(1, BACK_RANK[dx], dx, 0);
    place(1, 0, dx, 1);
    place(0, 0, dx, 6);
    place(0, BACK_RANK[dx], dx, 7);
  }
  return nodes;
}

const pointer = (): SceneNode => ({ id: "pointer", def: "pointer", x: 0, y: 0 });
const kings = (x1: number, y1: number, x2: number, y2: number): SceneNode[] => [
  { id: "wking", def: "icon", x: x1, y: y1, cell: 5 },
  { id: "bking", def: "icon", x: x2, y: y2, cell: 11, blend: 5 },
];

/** Where a piece stands, through the current view. */
const placeAt = (sq: Value): Block => ({ op: "set_pos", x: call("sq_x", sq), y: call("sq_y", sq) });
const faceSide: Block = ifThen(eq(call("is_far", prop("cell")), 1), [{ op: "look", flipX: true, flipY: true }], [{ op: "look", flipX: false, flipY: false }]);

export function chessProject(): Project {
  const sound = (id: string, note: number) => ({ id, voices: [{ note, vol: 200 }, { note: 0, vol: 0 }, { note: 0, vol: 0 }, { note: 0, vol: 0 }] });
  return {
    id: "chess",
    kind: "visual",
    locked: true,
    name: "Chess",
    author: "uxn-forge",
    width: 192,
    height: 128,
    theme: { ...CHESS_THEME },
    start: "menu",
    updatedAt: Date.now(),
    gameCursor: true,
    inputs: [
      { id: "confirm", key: 13 },
      { id: "pause", key: 27 },
    ],
    sprites: [...chessArt().filter((s) => s.id !== "squares"), board4()],
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
      { id: "tile", sprite: "board4", kind: "static" },
      {
        id: "piece",
        sprite: "pieces",
        kind: "static",
        // White's colors (blend 0: 1 → orange fill, 2 → black rim, 0
        // clear); black instances override with blend 5.
        blend: 0,
        vars: [{ id: "sq", init: 0 }],
        events: [
          ev("place", "create", [
            { op: "set", name: "sq", scope: "self", mode: "set", value: call("layout_sq", prop("x"), prop("y")) },
            { op: "call", fn: "put_piece", args: [my("sq"), add(prop("cell"), 1)] },
            placeAt(my("sq")),
            faceSide,
          ]),
          ev("drag", "step", [ifThen(eq(call("grabbed_sq"), my("sq")), [{ op: "set_pos", x: sub(mouse("x"), 4), y: sub(mouse("y"), 4) }])]),
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
                    { op: "cell", cell: call("cell_at", my("sq")) },
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
          ev("relayout", "message", [placeAt(my("sq")), faceSide], { message: "relayout" }),
        ],
      },
      { id: "dot", sprite: "dot", kind: "static", blend: 0 },
      { id: "icon", sprite: "pieces", kind: "static", blend: 0 },
      { id: "pointer", sprite: "cursor", kind: "static", blend: 5, events: [ev("follow", "step", [{ op: "set_pos", x: mouse("x"), y: mouse("y") }])] },
    ],
    scenes: [
      {
        id: "menu",
        nodes: [
          { id: "title", x: 76, y: 30, label: "CHESS" },
          ...kings(60, 56, 124, 56),
          button("play", 80, 56, "PLAY", [play("menu"), { op: "goto", scene: "side" }]),
          pointer(),
        ],
        events: [ev("enter", "key", [play("menu"), { op: "goto", scene: "side" }], { key: "confirm" })],
      },
      {
        id: "side",
        nodes: [
          { id: "ask", x: 72, y: 30, label: "SIDE?" },
          ...kings(56, 52, 56, 68),
          button("white", 68, 52, "WHITE", [{ op: "set", name: "side", mode: "set", value: 0 }, play("go"), { op: "goto", scene: "play" }]),
          button("black", 68, 68, "BLACK", [{ op: "set", name: "side", mode: "set", value: 1 }, play("go"), { op: "goto", scene: "play" }]),
          pointer(),
        ],
        events: [ev("enter", "key", [{ op: "set", name: "side", mode: "set", value: 0 }, { op: "goto", scene: "play" }], { key: "confirm" })],
      },
      {
        id: "play",
        pool: 28,
        nodes: [
          ...Array.from({ length: 16 }, (_, i): SceneNode => ({ id: `tile${i}`, def: "tile", x: 64 + (i % 4) * 32, y: Math.floor(i / 4) * 32 })),
          ...startPieces(),
          { id: "title", x: 2, y: 2, label: "CHESS" },
          {
            id: "turn",
            x: 2,
            y: 12,
            label: "W TO GO",
            events: [ev("show", "step", [ifThen(eq(call("checked"), 1), [text("CHECK!")], [ifThen(eq(call("white_to_move"), 1), [text("W TO GO")], [text("B TO GO")])])])],
          },
          {
            id: "score",
            x: 2,
            y: 22,
            label: "+0",
            events: [
              ev("show", "step", [
                ifThen(
                  { k: "cmp", a: call("material_white"), op: "gte", b: 1000 },
                  [text("+", sub(call("material_white"), 1000))],
                  [text("-", call("material_white"))],
                ),
              ]),
            ],
          },
          button("flip", 2, 40, "FLIP", [play("menu"), { op: "call", fn: "flip_view", args: [] }, send("deselect"), send("relayout")]),
          button("menu", 2, 52, "MENU", [play("menu"), { op: "overlay", scene: "pause" }]),
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
          { id: "paused", x: 72, y: 40, label: "PAUSED", blend: PAPER },
          button("resume", 72, 64, "RESUME", [play("menu"), { op: "back" }], PAPER),
          button("quit", 80, 80, "MENU", [play("menu"), { op: "goto", scene: "menu" }], PAPER),
          pointer(),
        ],
        events: [ev("resume", "key", [{ op: "back" }], { key: "pause" })],
      },
      {
        id: "over",
        nodes: [
          {
            id: "result",
            x: 60,
            y: 40,
            label: "GAME OVER",
            blend: PAPER,
            events: [ev("say", "create", [ifThen(eq(call("result"), 1), [text("WHITE WINS")], [ifThen(eq(call("result"), 2), [text("BLACK WINS")], [text("   DRAW")])])])],
          },
          button("again", 76, 64, "AGAIN", [{ op: "song_stop" }, { op: "goto", scene: "play" }], PAPER),
          button("menu", 80, 80, "MENU", [{ op: "song_stop" }, { op: "goto", scene: "menu" }], PAPER),
          pointer(),
        ],
        events: [ev("fanfare", "create", [{ op: "song", song: "fanfare" }])],
      },
    ],
  };
}
