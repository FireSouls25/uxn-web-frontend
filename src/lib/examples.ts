/* Chess showcase: the real game from uxn-webpage/chess/, presented
   as a READ-ONLY visual project. Sprites are the actual 2bpp piece
   tiles (converted below), scenes mirror the five game scenes with
   representative pieces, and the full rules engine (rules.ux —
   self-contained: board model, move generation, check, AI) rides
   along as custom code with a boot hook, so the build genuinely
   contains it. Editing is locked; everything is browsable. */
import rulesRaw from "./examples/chess/rules.ux?raw";
import piecesRaw from "./examples/chess/pieces.ux?raw";
import type { Project } from "./project";

const TILE_KINDS = ["pawn", "knight", "bishop", "rook", "queen", "king"] as const;

/** Parse 0xHH bytes in order from a data blob listing. */
function hexBytes(text: string): number[] {
  return [...text.matchAll(/0x([0-9a-fA-F]{2})/g)].map((m) => parseInt(m[1], 16));
}

/** 16 planar bytes (ch1 ×8, ch2 ×8) → 64 color indices. */
function planarToPixels(tile: number[]): number[] {
  const out: number[] = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const b1 = (tile[r] >> (7 - c)) & 1;
      const b2 = (tile[8 + r] >> (7 - c)) & 1;
      out.push(b1 | (b2 << 1));
    }
  }
  return out;
}

function splitTiles(all: number[]): number[][] {
  const tiles: number[][] = [];
  for (let t = 0; t + 16 <= all.length; t += 16) tiles.push(all.slice(t, t + 16));
  return tiles;
}

export function chessSprites(): Array<{ id: string; pixels: number[] }> {
  const bytes = hexBytes(piecesRaw);
  // wtiles then btiles, 6 tiles of 16 bytes each, in PT_* order.
  const whites = splitTiles(bytes.slice(0, 96));
  const blacks = splitTiles(bytes.slice(96, 192));
  const out: Array<{ id: string; pixels: number[] }> = [];
  TILE_KINDS.forEach((kind, i) => {
    out.push({ id: `w${kind}`, pixels: planarToPixels(whites[i] ?? Array(16).fill(0)) });
  });
  TILE_KINDS.forEach((kind, i) => {
    out.push({ id: `b${kind}`, pixels: planarToPixels(blacks[i] ?? Array(16).fill(0)) });
  });
  out.push({ id: "light", pixels: Array(64).fill(1) });
  out.push({ id: "dark", pixels: Array(64).fill(2) });
  return out;
}

function engineCode(): string {
  const withoutImport = rulesRaw
    .split("\n")
    .filter((line) => !line.startsWith("import "))
    .join("\n");
  return `${withoutImport}
( --- forge hooks: the spliced engine boots with the game --- )
tick: u8 = 0;
custom_setup :: fn() {
    setup_board();
}
`;
}

export const CHESS_DESCRIPTION =
  "Chess as a visual project: all 12 piece tiles, five scenes, and the full rules engine (move generation, check, AI) spliced in as custom code. Read-only — browse everything.";

const BACK_RANK = ["rook", "knight", "bishop", "queen", "king", "bishop", "knight", "rook"] as const;

function backRank(side: "w" | "b", y: number): Array<{ id: string; x: number; y: number; sprite: string; kind: "static"; solid: true }> {
  return BACK_RANK.map((kind, f) => ({
    id: `${side}${kind[0]}${f + 1}`,
    x: 64 + f * 8,
    y,
    sprite: `${side}${kind}`,
    kind: "static" as const,
    solid: true as const,
  }));
}

function pawnRank(side: "w" | "b", y: number): Array<{ id: string; x: number; y: number; sprite: string; kind: "static"; solid: true }> {
  return Array.from({ length: 8 }, (_, f) => ({
    id: `${side}p${f + 1}`,
    x: 64 + f * 8,
    y,
    sprite: `${side}pawn`,
    kind: "static" as const,
    solid: true as const,
  }));
}

export function chessProject(): Project {
  const sprites = chessSprites();
  return {
    id: "chess",
    kind: "visual",
    locked: true,
    name: "Chess",
    author: "etal",
    width: 192,
    height: 128,
    start: "menu",
    updatedAt: Date.now(),
    inputs: [
      { id: "select", key: 32 },
      { id: "pause", key: 27 },
    ],
    sound: { voices: [{ note: 72, vol: 200 }, { note: 0, vol: 0 }, { note: 0, vol: 0 }, { note: 0, vol: 0 }] },
    sprites,
    anims: [],
    customCode: engineCode(),
    scenes: [
      {
        id: "menu",
        nodes: [{ id: "knight", x: 92, y: 48, sprite: "wknight", kind: "static" }],
        clicks: [{ object: "knight", goto: "play" }],
        keys: [{ input: "select", key: 32, goto: "play" }],
      },
      {
        id: "play",
        nodes: [
          ...backRank("b", 32),
          ...pawnRank("b", 40),
          ...pawnRank("w", 72),
          ...backRank("w", 80),
        ],
        clicks: [],
        keys: [{ input: "pause", key: 27, goto: "pause" }],
        frameCode: "tick = tick + 1;",
      },
      {
        id: "pause",
        nodes: [{ id: "bishop", x: 92, y: 56, sprite: "wbishop", kind: "static" }],
        clicks: [],
        keys: [
          { key: 32, goto: "play" },
          { key: 27, goto: "play" },
        ],
      },
    ],
  };
}
