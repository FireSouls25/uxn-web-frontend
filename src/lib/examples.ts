/* Chess example: the full hand-written ETAL game, synced from
   uxn-webpage/chess/ via scripts/sync-chess.sh (game logic + pinned
   libs, imports flattened to siblings for the backend).
   Architecture worth studying (and the pattern custom code should
   follow): pure rules over `buffer board[64]` in rules.ux — move
   generation, check detection, AI — plus a thin device UI in game.ux
   (scenes, mouse drag, highlights, cursor tile). Nothing here is
   generated; open it in the code view, compile, export. */
import main from "./examples/chess/main.ux?raw";
import devices from "./examples/chess/devices.ux?raw";
import game from "./examples/chess/game.ux?raw";
import rules from "./examples/chess/rules.ux?raw";
import pieces from "./examples/chess/pieces.ux?raw";
import screen from "./examples/chess/screen.ux?raw";
import font from "./examples/chess/font.ux?raw";
import audio from "./examples/chess/audio.ux?raw";
import song from "./examples/chess/song.ux?raw";
import scene from "./examples/chess/scene.ux?raw";
import input from "./examples/chess/input.ux?raw";
import type { Project } from "../project";

export const CHESS_FILES: Record<string, string> = {
  "main.ux": main,
  "devices.ux": devices,
  "game.ux": game,
  "rules.ux": rules,
  "pieces.ux": pieces,
  "screen.ux": screen,
  "font.ux": font,
  "audio.ux": audio,
  "song.ux": song,
  "scene.ux": scene,
  "input.ux": input,
};

export const CHESS_DESCRIPTION =
  "Full chess in hand-written ETAL: legal move generation, check detection, a material AI, mouse drag, five scenes. 192×128.";

export function chessProject(): Project {
  return {
    id: "chess",
    kind: "code",
    name: "Chess",
    author: "etal",
    width: 192,
    height: 128,
    start: "",
    scenes: [],
    sprites: [],
    anims: [],
    codeFiles: { ...CHESS_FILES },
    entry: "main.ux",
    updatedAt: Date.now(),
  };
}
