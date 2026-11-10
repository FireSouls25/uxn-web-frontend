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
import type { Project, SceneNode, Sprite } from "./project";

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

/* The showcase example: chess in the engine model, see chessgame.ts. */
export { chessProject } from "./examples/chessgame";
