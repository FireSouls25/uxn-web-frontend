import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SAMPLE_PROJECT,
  emitProject,
  flattenScene,
  migrateProject,
  validateProject,
  type Project,
} from "./project";

describe("validateProject", () => {
  it("accepts the sample", () => {
    expect(validateProject(SAMPLE_PROJECT)).toEqual([]);
  });

  it("rejects dangling gotos, dup ids, oversized scenes and bad physics", () => {
    const bad: Project = {
      ...SAMPLE_PROJECT,
      start: "missing",
      scenes: [
        {
          id: "title",
          nodes: [
            ...Array.from({ length: 17 }, (_, i) => ({ id: `o${i}`, x: 0, y: 0, sprite: "hero", kind: "static" as const })),
            { id: "floaty", x: 0, y: 0, sprite: "hero", kind: "movable" as const },
            { id: "brain", x: 0, y: 0, sprite: "hero", kind: "static" as const, controls: true },
            { id: "ghost", x: 0, y: 0, sprite: "nope", kind: "static" as const, anim: "nope" },
          ],
          clicks: [{ object: "ghost", goto: "nowhere" }],
          keys: [],
        },
      ],
    };
    const errs = validateProject(bad);
    expect(errs.length).toBeGreaterThanOrEqual(6);
    for (const needle of ["start scene", "movable requires solid", "controls require player", "unknown sprite", "unknown animation", "unknown scene"]) {
      expect(errs.some((e) => e.includes(needle)), needle).toBe(true);
    }
  });

  it("allows zero players but never two", () => {
    const two = structuredClone(SAMPLE_PROJECT);
    two.scenes[0].nodes.push({ id: "clone", x: 0, y: 0, sprite: "hero", kind: "player" });
    expect(validateProject(two).some((e) => e.includes("at most one player"))).toBe(true);
    const none = structuredClone(SAMPLE_PROJECT);
    none.scenes[0].nodes = none.scenes[0].nodes.filter((o) => o.kind !== "player");
    none.scenes[0].clicks = [];
    expect(validateProject(none)).toEqual([]);
  });

  it("rejects bad sound rows", () => {
    const bad: Project = {
      ...SAMPLE_PROJECT,
      sound: { voices: [{ note: 200, vol: 0 }, { note: 60, vol: 300 }] },
    };
    expect(validateProject(bad).length).toBe(2);
  });

  it("emits custom hooks only when defined", () => {
    const plain = emitProject(SAMPLE_PROJECT)["main.ux"];
    expect(plain).not.toContain("custom_frame");
    const hooked: Project = {
      ...structuredClone(SAMPLE_PROJECT),
      customCode: "hits: u8 = 0;\n\ncustom_frame :: fn() {\n    hits = hits + 1;\n}\n",
    };
    const out = emitProject(hooked)["main.ux"];
    expect(out).toContain("hits: u8 = 0;");
    expect(out).toContain("custom_frame();");
    expect(out).not.toContain("custom_setup();");
  });

  it("rejects custom code that collides with generated names", () => {
    const bad: Project = { ...structuredClone(SAMPLE_PROJECT), customCode: "scene: u8 = 9;" };
    expect(() => emitProject(bad)).toThrow(/collides/);
    const bad2: Project = { ...structuredClone(SAMPLE_PROJECT), customCode: "ox: u8 = 1;" };
    expect(validateProject(bad2).some((e) => e.includes("collides"))).toBe(true);
  });

  it("passes code projects through untouched", () => {
    const code: Project = {
      ...structuredClone(SAMPLE_PROJECT),
      kind: "code",
      codeFiles: { "main.ux": "main :: fn() {\n}\n" },
      entry: "main.ux",
    };
    expect(validateProject(code)).toEqual([]);
    expect(emitProject(code)).toEqual({ "main.ux": "main :: fn() {\n}\n" });
    const noEntry: Project = { ...code, entry: "missing.ux" };
    expect(validateProject(noEntry).some((e) => e.includes("entry"))).toBe(true);
  });

  it("flattens nested scenes with accumulated offsets", async () => {
    const { flattenScene } = await import("./project");
    const base = structuredClone(SAMPLE_PROJECT);
    base.scenes.push({
      id: "room",
      nodes: [
        { id: "corner", x: 100, y: 100, sprite: "hero", kind: "static" },
        { id: "rack", x: 10, y: 20, scene: "shelf" },
      ],
      clicks: [],
      keys: [],
    });
    base.scenes.push({
      id: "shelf",
      nodes: [{ id: "jar", x: 1, y: 2, sprite: "hero", kind: "static" }],
      clicks: [],
      keys: [],
    });
    const flat = flattenScene(base, "room");
    expect(flat.map((l) => [l.path, l.x, l.y])).toEqual([
      ["corner", 100, 100],
      ["rack/jar", 11, 22],
    ]);
  });

  it("rejects cycles and slot overflow", async () => {
    const { flattenScene } = await import("./project");
    const cyc = structuredClone(SAMPLE_PROJECT);
    cyc.scenes.push(
      { id: "a", nodes: [{ id: "to_b", x: 0, y: 0, scene: "b" }], clicks: [], keys: [] },
      { id: "b", nodes: [{ id: "to_a", x: 0, y: 0, scene: "a" }], clicks: [], keys: [] },
    );
    expect(() => flattenScene(cyc, "a")).toThrow(/cycle/);
    expect(validateProject(cyc).some((e) => e.includes("cycle"))).toBe(true);
  });

  it("compiles a nested scene with the real etal", async () => {
    const { flattenScene } = await import("./project");
    void flattenScene;
    const nested: Project = {
      ...structuredClone(SAMPLE_PROJECT),
      id: "nested",
      name: "Nested",
      scenes: [
        {
          id: "room",
          nodes: [
            { id: "lamp", x: 0, y: 0, sprite: "hero", kind: "static", tick: "ox[slot] = ox[slot];" },
            { id: "rack", x: 16, y: 16, scene: "shelf" },
          ],
          clicks: [{ object: "rack/jar", goto: "room" }],
          keys: [],
        },
        {
          id: "shelf",
          nodes: [{ id: "jar", x: 2, y: 2, sprite: "hero", kind: "static", tick: "ox[slot] = ox[slot];" }],
          clicks: [],
          keys: [],
        },
      ],
      start: "room",
    };
    expect(validateProject(nested)).toEqual([]);
    const files = emitProject(nested);
    expect(files["main.ux"]).toContain("tick_room_rack_jar");
    const etal =
      process.env.ETAL_BIN ??
      "/home/grim/Documents/projects/uxn-dsl/build/linux-x86/etal";
    if (!existsSync(etal)) {
      console.warn("skip: no etal binary");
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "uxn-nest-"));
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content);
    }
    execFileSync(etal, ["-r", join(dir, "main.ux"), "-o", join(dir, "nest.rom")], {
      stdio: "pipe",
    });
    expect(existsSync(join(dir, "nest.rom"))).toBe(true);
  });

  it("migrates legacy inline tiles into the sprite library", () => {
    const legacy = {
      id: "old",
      name: "Old",
      author: "me",
      width: 128,
      height: 128,
      start: "main",
      scenes: [
        { id: "main", objects: [{ id: "hero", x: 1, y: 2, tile: [255, 0, 0, 0, 0, 0, 0, 0] }], clicks: [], keys: [] },
      ],
    };
    const p = migrateProject(legacy);
    expect(validateProject(p)).toEqual([]);
    expect(p.sprites.map((s) => s.id)).toEqual(["main_hero"]);
    expect(p.sprites[0].pixels.slice(0, 8)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect(p.scenes[0].nodes[0]).toMatchObject({ sprite: "main_hero", x: 1, y: 2 });
  });
});

describe("emitProject", () => {
  it("is deterministic", () => {
    const a = emitProject(SAMPLE_PROJECT);
    const b = emitProject(structuredClone(SAMPLE_PROJECT));
    expect(a).toEqual(b);
  });

  it("emits slots in hierarchy order, not alphabetical", () => {
    const p = structuredClone(SAMPLE_PROJECT);
    p.scenes[0].nodes = [
      { id: "zebra", x: 1, y: 2, sprite: "hero", kind: "static" },
      { id: "apple", x: 3, y: 4, sprite: "hero", kind: "static" },
    ];
    p.scenes[0].clicks = [];
    p.scenes[0].keys = [];
    const main = emitProject(p)["main.ux"];
    const zx = main.indexOf("ox[0] = 1;");
    const ax = main.indexOf("ox[1] = 3;");
    expect(zx).toBeGreaterThan(-1);
    expect(ax).toBeGreaterThan(zx);
  });

  it("emits the scene dispatch and vector wiring", () => {
    const files = emitProject(SAMPLE_PROJECT);
    expect(Object.keys(files).sort()).toEqual(["devices.ux", "main.ux"]);
    expect(files["main.ux"]).toContain("SC_TITLE :: 1;");
    expect(files["main.ux"]).toContain("SC_PLAY :: 0;");
    expect(files["main.ux"]).toContain("on_frame :: event()");
    expect(files["main.ux"]).toContain("Screen.vector = &on_frame;");
    expect(files["main.ux"]).toContain("setup_play();");
    expect(files["main.ux"]).toContain("overlap88");
    expect(files["main.ux"]).toContain("oflags[");
    expect(files["main.ux"]).toContain("Audio0.pitch");
    expect(files["main.ux"]).toContain("Screen.sprite = 129;");
    expect(files["main.ux"]).toContain("data spr_coin = [");
    expect(files["main.ux"]).toContain("afr_title_coin");
    expect(files["devices.ux"]).toContain("device Audio0 48");
  });

  it("compiles with the real etal when available", () => {
    const etal =
      process.env.ETAL_BIN ??
      "/home/grim/Documents/projects/uxn-dsl/build/linux-x86/etal";
    if (!existsSync(etal)) {
      console.warn("skip: no etal binary");
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "uxn-emit-"));
    const files = emitProject(SAMPLE_PROJECT);
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content);
    }
    execFileSync(etal, ["-r", join(dir, "main.ux"), "-o", join(dir, "main.rom")], {
      stdio: "pipe",
    });
    expect(existsSync(join(dir, "main.rom"))).toBe(true);
  });

  it("emits object tick fns and scene frame code", () => {
    const p = structuredClone(SAMPLE_PROJECT);
    p.scenes[0].nodes[0].tick = "ox[slot] = ox[slot];";
    p.scenes[0].frameCode = "tick = tick + 1;";
    const main = emitProject(p)["main.ux"];
    expect(main).toContain("tick_title_hero :: fn(slot: u16) {");
    expect(main).toContain("tick_title_hero(0);");
    expect(main).toContain("tick = tick + 1;");
    const bad: Project = structuredClone(SAMPLE_PROJECT);
    bad.scenes[0].nodes[0].tick = "scene: u8 = 1;";
    expect(validateProject(bad).some((e) => e.includes("collides"))).toBe(true);
  });

  it("chess showcase validates and assembles with the real etal", async () => {
    const { chessProject, chessSprites } = await import("./examples");
    expect(chessSprites()).toHaveLength(14);
    const project = chessProject();
    expect(project.locked).toBe(true);
    expect(project.scenes.map((s) => s.id)).toEqual(["menu", "play", "pause"]);
    expect(flattenScene(project, "play")).toHaveLength(32);
    expect(validateProject(project)).toEqual([]);
    const files = emitProject(project);
    expect(Object.keys(files).sort()).toEqual(["devices.ux", "main.ux"]);
    expect(files["main.ux"]).toContain("SC_PLAY");
    expect(files["main.ux"]).toContain("custom_setup();");
    expect(files["main.ux"]).toContain("setup_board();");
    expect(files["main.ux"]).toContain("tick = tick + 1;");
    const etal =
      process.env.ETAL_BIN ??
      "/home/grim/Documents/projects/uxn-dsl/build/linux-x86/etal";
    if (!existsSync(etal)) {
      console.warn("skip: no etal binary");
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "uxn-chess-"));
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content);
    }
    execFileSync(etal, ["-r", join(dir, "main.ux"), "-o", join(dir, "chess.rom")], {
      stdio: "pipe",
    });
    expect(existsSync(join(dir, "chess.rom"))).toBe(true);
  });
});
