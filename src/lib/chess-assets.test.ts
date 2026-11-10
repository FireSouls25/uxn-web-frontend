import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { emitProject } from "./project";
import { chessScriptProject as chessProject } from "./examples";

/* The local chess build (uxn-webpage/chess) imports the assets.ux the
   studio's Chess example generates — sprites, sheets and scene
   modules are studio data, the local game never holds pixels.
   `npm run sync:chess-assets` writes it; otherwise this checks the
   checked-in copy is current. */
const LOCAL = join(__dirname, "../../../chess/assets.ux");

describe("chess assets export", () => {
  it("local chess/assets.ux is the studio's generated assets.ux", () => {
    const generated = emitProject(chessProject())["assets.ux"];
    if (process.env.WRITE_CHESS_ASSETS) {
      writeFileSync(LOCAL, generated);
      return;
    }
    if (!existsSync(join(LOCAL, ".."))) return;
    expect(existsSync(LOCAL), "run `npm run sync:chess-assets`").toBe(true);
    expect(readFileSync(LOCAL, "utf8"), "stale chess/assets.ux — run `npm run sync:chess-assets`").toBe(generated);
  });
});
