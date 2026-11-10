import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { SAMPLE_PROJECT, SCRIPT_STARTER, cellCount, cellTileOffset, definedHooks, emitProject, flattenScene, leafPaint, lookMode, usedStdlib, validateProject, type Project, type Sprite } from "./project";
import { STDLIB, moduleExports, stdlibClosure } from "./stdlib";
import { chessScriptProject as chessProject } from "./examples";

const ETAL = process.env.ETAL_BIN ?? "/home/grim/Documents/projects/uxn-webpage/uxn-dsl/build/linux-x86/etal";
const CHESS_DIR = join(__dirname, "../../../chess");

/** Assemble an emitted file set; returns stderr ("" = clean) or null
    when no compiler binary is around. */
function assemble(files: Record<string, string>): { ok: boolean; stderr: string } | null {
  if (!existsSync(ETAL)) {
    console.warn("skip: no etal binary");
    return null;
  }
  const dir = mkdtempSync(join(tmpdir(), "uxn-script-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  const r = spawnSync(ETAL, ["-r", join(dir, "main.ux"), "-o", join(dir, "out.rom")], { encoding: "utf8" });
  return { ok: r.status === 0 && existsSync(join(dir, "out.rom")), stderr: `${r.stdout}\n${r.stderr}` };
}

function scriptProject(): Project {
  const p = structuredClone(SAMPLE_PROJECT);
  p.loop = "script";
  p.customCode = `import "screen.ux"
custom_frame :: fn() {
    clear(128);
    blit(8, 8, &spr_hero, 129);
}`;
  return p;
}

describe("standard library", () => {
  it("bundles the uxn-dsl modules with exports and transitive imports", () => {
    expect(Object.keys(STDLIB)).toEqual(expect.arrayContaining(["screen.ux", "font.ux", "song.ux", "input.ux"]));
    expect(Object.keys(STDLIB).some((n) => n.startsWith("test_"))).toBe(false);
    expect(moduleExports(STDLIB["screen.ux"]).map((x) => x.sig)).toContain("blit(x, y, tile, mode)");
    expect(stdlibClosure(["font.ux"])).toEqual(["font.ux", "screen.ux"]);
    expect(stdlibClosure(["song.ux", "nope.ux"])).toEqual(["audio.ux", "song.ux"]);
  });
});

describe("script loop", () => {
  it("starter custom.ux validates and assembles warning-free", () => {
    const p = structuredClone(SAMPLE_PROJECT);
    p.loop = "script";
    p.customCode = SCRIPT_STARTER;
    expect(validateProject(p)).toEqual([]);
    const r = assemble(emitProject(p));
    if (r) {
      expect(r.ok, r.stderr).toBe(true);
      expect(r.stderr).not.toContain("warning");
    }
  });

  it("hands the frame to custom_frame and exports only named assets", () => {
    const p = scriptProject();
    p.sounds = [
      { id: "blip", voices: [{ note: 60, vol: 200 }] },
      { id: "quiet", voices: [{ note: 60, vol: 200 }] },
    ];
    p.vars = [
      { id: "score", init: 7 },
      { id: "spare", init: 0 },
    ];
    p.customCode += `\ncustom_key :: fn() {\n    snd_blip();\n    var_score[0] = var_score[0] + 1;\n}`;
    expect(validateProject(p)).toEqual([]);
    const files = emitProject(p);
    expect(Object.keys(files).sort()).toEqual(["assets.ux", "devices.ux", "main.ux", "screen.ux"]);
    const main = files["main.ux"];
    expect(main).toContain(`import "screen.ux"`);
    expect(files["assets.ux"]).toContain("data spr_hero");
    expect(files["assets.ux"]).not.toContain("data spr_wall");
    expect(files["assets.ux"]).toContain("snd_blip :: fn() {");
    expect(main).not.toContain("snd_quiet");
    expect(files["assets.ux"]).toContain("buffer var_score[1]: u16;");
    expect(main).toContain("var_score[0] = 7;");
    expect(main).not.toContain("var_spare");
    expect(main).toMatch(/on_frame :: event\(\) \{\n {4}custom_frame\(\);\n\}/);
    expect(main).toContain("Controller.vector = &on_key;");
    expect(main).not.toContain("Mouse.vector");
    // No scene runtime at all.
    expect(main).not.toContain("ox[");
    expect(main).not.toContain("scene_go");
    expect(files["devices.ux"]).toContain("device Audio3 96");
    expect(files["devices.ux"]).toContain("device DateTime 192");
    const r = assemble(files);
    if (r) {
      expect(r.ok, r.stderr).toBe(true);
      expect(r.stderr).not.toContain("warning");
    }
  });

  it("rejects a missing frame hook, custom_draw and generated names", () => {
    const p = scriptProject();
    p.customCode = "custom_setup :: fn() { }";
    expect(validateProject(p).some((e) => e.includes("needs a custom_frame"))).toBe(true);
    p.customCode = "custom_frame :: fn() { }\ncustom_draw :: fn() { }";
    expect(validateProject(p).some((e) => e.includes("engine-loop only"))).toBe(true);
    p.customCode = "custom_frame :: fn() { }\nspr_extra: u8 = 0;\non_frame :: fn() { }";
    const errs = validateProject(p);
    expect(errs.some((e) => e.includes("'spr_extra'"))).toBe(true);
    expect(errs.some((e) => e.includes("'on_frame'"))).toBe(true);
    // Locals never collide, and engine names are free in this loop.
    p.customCode = "scene: u8 = 0;\ncustom_frame :: fn() {\n    on_key: u8 = 1;\n}";
    expect(validateProject(p)).toEqual([]);
  });
});

describe("scripts in the engine loop", () => {
  it("imports script modules and wires draw/key/mouse hooks", () => {
    const p = structuredClone(SAMPLE_PROJECT);
    p.scripts = [
      {
        path: "hud.ux",
        code: `import "devices.ux"\nimport "screen.ux"\nhud_hits: u8 = 0;\nhud_draw :: fn() {\n    blit(0, 0, &spr_hero, 129);\n}`,
      },
    ];
    p.customCode = `custom_draw :: fn() {\n    hud_draw();\n}\ncustom_mouse :: fn() {\n    hud_hits = hud_hits + 1;\n}`;
    expect([...definedHooks(p)].sort()).toEqual(["custom_draw", "custom_mouse"]);
    expect(usedStdlib(p)).toEqual(["screen.ux"]);
    expect(validateProject(p)).toEqual([]);
    const files = emitProject(p);
    expect(Object.keys(files).sort()).toEqual(["devices.ux", "hud.ux", "main.ux", "screen.ux"]);
    const main = files["main.ux"];
    // After the engine's state (so scripts can read ox/var_*), before its fns.
    expect(main.indexOf(`import "hud.ux"`)).toBeGreaterThan(main.indexOf("scene: u8 = 0;"));
    expect(main.indexOf(`import "hud.ux"`)).toBeLessThan(main.indexOf("spr_set :: fn"));
    expect(main).toMatch(/draw\(\);\n {4}custom_draw\(\);/);
    expect(main).toContain("custom_mouse();");
    expect(main).toContain("Mouse.vector = &on_mouse;");
    const r = assemble(files);
    if (r) {
      expect(r.ok, r.stderr).toBe(true);
      // The sample's own click fn has a pre-existing unused-`slot`
      // warning; nothing from the scripting surface may add one.
      const warns = r.stderr.split("\n").filter((l) => l.includes("warning") && !l.includes("unused parameter `slot`"));
      expect(warns).toEqual([]);
    }
  });

  it("keeps old projects byte-identical", () => {
    const before = emitProject(structuredClone(SAMPLE_PROJECT));
    const p = structuredClone(SAMPLE_PROJECT);
    p.loop = "engine";
    p.scripts = [];
    expect(emitProject(p)).toEqual(before);
  });

  it("validates names, imports and library collisions", () => {
    const p = structuredClone(SAMPLE_PROJECT);
    p.scripts = [
      { path: "main.ux", code: "" },
      { path: "font.ux", code: "" },
      { path: "bad name.ux", code: "" },
      { path: "a.ux", code: `import "missing.ux"` },
      { path: "a.ux", code: "" },
    ];
    const errs = validateProject(p);
    expect(errs.some((e) => e.includes("replace a generated file"))).toBe(true);
    expect(errs.some((e) => e.includes("shadows the library"))).toBe(true);
    expect(errs.some((e) => e.includes("bad script name"))).toBe(true);
    expect(errs.some((e) => e.includes(`import "missing.ux" not found`))).toBe(true);
    expect(errs.some((e) => e.includes("duplicate script 'a.ux'"))).toBe(true);
    const q = structuredClone(SAMPLE_PROJECT);
    q.customCode = `import "scene.ux"`;
    expect(validateProject(q).some((e) => e.includes("library scene.ux declares 'scene'"))).toBe(true);
    q.loop = "script";
    q.customCode = `import "scene.ux"\ncustom_frame :: fn() {\n    scene_go(1);\n}`;
    expect(validateProject(q)).toEqual([]);
  });
});

describe("chess example (script loop)", () => {
  it("is the local game, with art and board as studio sprites and scenes", () => {
    const p = chessProject();
    expect(p.locked).toBe(true);
    expect(p.loop).toBe("script");
    expect(validateProject(p)).toEqual([]);
    const files = emitProject(p);
    expect(Object.keys(files).sort()).toEqual(
      ["assets.ux", "audio.ux", "devices.ux", "font.ux", "game.ux", "input.ux", "main.ux", "pieces.ux", "rules.ux", "scene.ux", "screen.ux", "song.ux"],
    );
    // game/rules/pieces are the local files (only library paths
    // flattened): a stale bundle fails here — rerun `npm run sync:chess`.
    if (existsSync(join(CHESS_DIR, "game.ux"))) {
      const local = readFileSync(join(CHESS_DIR, "game.ux"), "utf8").replace(/import "\.\.\/uxn-dsl\/lib\//g, 'import "');
      expect(files["game.ux"]).toBe(local);
      expect(files["rules.ux"]).toBe(readFileSync(join(CHESS_DIR, "rules.ux"), "utf8"));
      expect(files["pieces.ux"]).toBe(readFileSync(join(CHESS_DIR, "pieces.ux"), "utf8"));
    }
    expect(files["pieces.ux"]).not.toMatch(/^data /m);
    const main = files["main.ux"];
    for (const hook of ["custom_setup();", "custom_frame();", "custom_key();", "custom_mouse();"]) expect(main).toContain(hook);
    expect(main).toContain(`System.r = ${0xb0a2};`);
    expect(main).toContain("Screen.width = 192;");
    const assets = files["assets.ux"];
    for (const id of ["pieces", "squares", "dot", "cursor"]) expect(assets).toContain(`data spr_${id}`);
    // The board is a scene the game draws, the setup a scene it reads.
    expect(assets).toContain("draw_scene_board :: fn() {");
    expect(assets).toContain("SCN_BOARD_COUNT :: 64;");
    expect(assets).toContain("SCN_SETUP_COUNT :: 96;");
    expect(assets).toContain("SPR_PIECES :: 0;");
    expect(p.gameCursor).toBe(true);
    // Setup rows: 32 pieces whose cell decodes to the standard start.
    const setup = flattenScene(p, "setup").filter((l) => l.sprite === "pieces");
    expect(setup).toHaveLength(32);
    const e1 = setup.find((l) => l.x === 64 + 4 * 16 + 4 && l.y === 7 * 16 + 4);
    expect(e1?.cell).toBe(5); // white king
    const d8 = setup.find((l) => l.x === 64 + 3 * 16 + 4 && l.y === 4);
    expect(d8).toMatchObject({ cell: 10, flipX: true, flipY: true, blend: 5 }); // black queen, far side
  });

  it("assembles warning-free with the real etal", { timeout: 60_000 }, () => {
    const r = assemble(emitProject(chessProject()));
    if (r) {
      expect(r.ok, r.stderr).toBe(true);
      expect(r.stderr).not.toContain("warning");
    }
  });
});

describe("engine: sheets, looks and scene modules", () => {
  const sheet = (): Sprite => ({
    id: "sheet",
    w: 2,
    h: 2,
    cell: { w: 1, h: 1 },
    // tile t filled with color (t % 3) + 1, top-left pixel 0
    pixels: Array.from({ length: 256 }, (_, i) => (i % 64 === 0 ? 0 : (Math.floor(i / 64) % 3) + 1)),
  });

  it("cell offsets step a sheet-width apart and paint like the VM", () => {
    const s = sheet();
    expect(cellCount(s)).toBe(4);
    expect(cellTileOffset(s, 3)).toBe(3 * 16);
    const big: Sprite = { id: "b", w: 4, h: 2, cell: { w: 2, h: 2 }, pixels: Array(512).fill(1) };
    expect(cellTileOffset(big, 1, 1, 1)).toBe((1 * 4 + 3) * 16);
    // Blend 5 leaves color 0 out; blend 1 paints it.
    expect(leafPaint(s, { cell: 1, blend: 5 }).length).toBe(63);
    expect(leafPaint(s, { cell: 1 }).length).toBe(64);
    // flipX moves the transparent pixel to the right edge.
    const flipped = leafPaint(s, { cell: 1, blend: 5, flipX: true });
    expect(flipped.some(([x, y]) => x === 7 && y === 0)).toBe(false);
    expect(flipped.some(([x, y]) => x === 0 && y === 0)).toBe(true);
    expect(lookMode({ flipX: true, flipY: true, blend: 5 })).toBe(0x80 | 0x30 | 5);
  });

  it("engine loop draws cells with their flips and blend, and assembles", () => {
    const p = structuredClone(SAMPLE_PROJECT);
    p.sprites.push(sheet());
    p.scenes[0].nodes.push({ id: "c2", sprite: "sheet", x: 40, y: 40, cell: 2, flipY: true, blend: 5 });
    expect(validateProject(p)).toEqual([]);
    const main = emitProject(p)["main.ux"];
    expect(main).toContain("ot[self] = &spr_sheet + ((ocell[self] / 2) * 2 + (ocell[self] % 2) * 1) * 16;");
    expect(main).toContain(`2, ${0x80 | 0x20 | 5}, `);
    const r = assemble(emitProject(p));
    if (r) expect(r.ok, r.stderr).toBe(true);
  });

  it("rejects bad cells, grids and animated sheets", () => {
    const p = structuredClone(SAMPLE_PROJECT);
    p.sprites.push({ ...sheet(), id: "odd", cell: { w: 3, h: 1 } } as Sprite);
    p.sprites.push(sheet());
    p.scenes[0].nodes.push({ id: "far", sprite: "sheet", x: 0, y: 0, cell: 9 });
    p.scenes[0].nodes.push({ id: "tint", sprite: "sheet", x: 0, y: 8, blend: 16 });
    const errs = validateProject(p);
    expect(errs.some((e) => e.includes("must evenly divide"))).toBe(true);
    expect(errs.some((e) => e.includes("shows cell 9"))).toBe(true);
    expect(errs.some((e) => e.includes("blend must be 0–15"))).toBe(true);
  });

  it("script loop ships named scenes as a draw fn + layout table", () => {
    const p = scriptProject();
    p.sprites.push(sheet());
    p.scenes.push({
      id: "level",
      nodes: [
        { id: "a", sprite: "sheet", x: 300, y: 10, cell: 1 },
        { id: "b", sprite: "sheet", x: 20, y: 30, cell: 1 },
        { id: "c", sprite: "hero", x: 0, y: 0, flipX: true, blend: 5 },
      ],
    });
    p.customCode = `import "screen.ux"
custom_frame :: fn() {
    clear(128);
    draw_scene_level();
    if scn_level[4] == SPR_SHEET {
        blit(0, 0, &spr_hero, 129);
    }
}`;
    expect(validateProject(p)).toEqual([]);
    const assets = emitProject(p)["assets.ux"];
    expect(assets).toContain("SCN_LEVEL_COUNT :: 3;");
    // x=300 → hi 1, lo 44; two nodes share one draw kind.
    expect(assets).toContain(`data scn_level = [1, 44, 0, 10, ${p.sprites.length - 1}, 1, 129, 0, 0, 20, 0, 30, ${p.sprites.length - 1}, 1, 129, 0,`);
    expect(assets).toContain("data spr_sheet");
    expect(assets).not.toContain("draw_scene_main");
    const r = assemble(emitProject(p));
    if (r) {
      expect(r.ok, r.stderr).toBe(true);
      expect(r.stderr).not.toContain("warning");
    }
    // Generated names are reserved in the script loop.
    p.customCode += "\nscn_mine: u8 = 0;";
    expect(validateProject(p).some((e) => e.includes("'scn_mine'"))).toBe(true);
  });
});

describe("game cursor", () => {
  it("hides the browser pointer over the canvas only when asked", async () => {
    const { hideHostCursor } = await import("./export");
    const html = new TextEncoder().encode(`<html><head><title>g</title></head><body><canvas id="display"></canvas></body></html>`);
    const out = new TextDecoder().decode(hideHostCursor(html));
    expect(out).toContain("<style>#display{cursor:none}</style></head>");
    expect(out).toContain(`<canvas id="display">`);
  });
});
