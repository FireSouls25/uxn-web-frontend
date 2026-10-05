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
  type Block,
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

describe("sprite tiles", () => {
  function wideProject(): Project {
    const p = structuredClone(SAMPLE_PROJECT);
    p.sprites.push({ id: "wide", w: 2, h: 1, pixels: [...Array(64).fill(1), ...Array(64).fill(2)] });
    p.scenes[0].nodes.push({ id: "banner", x: 0, y: 0, sprite: "wide", kind: "static" });
    return p;
  }

  it("validates tile dimensions and pixel counts", () => {
    expect(validateProject(wideProject())).toEqual([]);
    const short = wideProject();
    short.sprites.find((s) => s.id === "wide")!.pixels.length = 64;
    expect(validateProject(short).some((e) => e.includes("needs 128 pixels"))).toBe(true);
    const big = wideProject();
    big.sprites.find((s) => s.id === "wide")!.w = 5;
    expect(validateProject(big).some((e) => e.includes("width must be 1–4"))).toBe(true);
  });

  it("rejects mixed-size animation frames and mismatched leaves", () => {
    const p = wideProject();
    p.sprites.push({ id: "tall", w: 1, h: 2, pixels: Array(128).fill(3) });
    p.anims.push({ id: "wobble", frames: ["wide", "tall"], rate: 30, loop: true });
    expect(validateProject(p).some((e) => e.includes("must match 2×1 tiles"))).toBe(true);
    const same = wideProject();
    same.scenes[0].nodes.push({ id: "morph", x: 0, y: 0, sprite: "hero", kind: "static", anim: "spin" });
    expect(validateProject(same)).toEqual([]);
    const mixed = wideProject();
    mixed.scenes[0].nodes.push({ id: "morph", x: 0, y: 0, sprite: "wide", kind: "static", anim: "spin" });
    expect(validateProject(mixed).some((e) => e.includes("must match animation"))).toBe(true);
  });

  it("emits multi-tile draws with literal offsets", () => {
    const main = emitProject(wideProject())["main.ux"];
    const blob = main.match(/data spr_wide = \[(.*?)\];/)?.[1].split(",") ?? [];
    expect(blob.length).toBe(32);
    // banner is leaf index 3 of title: second tile at +8px, +16 bytes.
    expect(main).toContain("Screen.x = ox[3] + 8;");
    expect(main).toContain("Screen.addr = ot[3] + 16;");
    // 1x1 leaves keep single straight-line writes.
    expect(main).toContain("Screen.x = ox[0];");
    // a driver exists, so dims machinery is present.
    expect(main).toContain("buffer ow[128]");
    expect(main).toContain("overlapwh");
    expect(main).toContain("overlap88");
  });

  it("sizes click rects by sprite dims", () => {
    const p = wideProject();
    p.scenes[0].clicks.push({ object: "banner", goto: "play" });
    expect(emitProject(p)["main.ux"]).toContain("pt_in_rect(mx, my, ox[3], oy[3], 16, 8)");
  });

  it("skips dims machinery without a driver", () => {
    const p = structuredClone(SAMPLE_PROJECT);
    p.scenes.forEach((s) => s.nodes.forEach((o) => delete o.controls));
    const main = emitProject(p)["main.ux"];
    expect(main).not.toContain("buffer ow[128]");
    expect(main).not.toContain("overlapwh");
    expect(main).toContain("overlap88");
  });
});

describe("object templates", () => {
  function defProject(): Project {
    const p = structuredClone(SAMPLE_PROJECT);
    p.objectDefs = [
      { id: "hero_obj", sprite: "hero", kind: "player", controls: true, tick: "ox[slot] = ox[slot];" },
      { id: "crate", sprite: "wall", kind: "movable", solid: true },
    ];
    p.scenes[0].nodes.push(
      { id: "hero2", x: 0, y: 0, def: "hero_obj" },
      { id: "box", x: 32, y: 32, def: "crate", anim: "spin" },
    );
    // title already has an inline player: drop it so the fixture is
    // valid unless a test says otherwise.
    p.scenes[0].nodes = p.scenes[0].nodes.filter((o) => o.id !== "hero");
    p.scenes[0].clicks = [];
    return p;
  }

  it("resolves defs with local overrides winning", async () => {
    const { flattenScene } = await import("./project");
    const flat = flattenScene(defProject(), "title");
    const hero2 = flat.find((l) => l.path === "hero2")!;
    expect(hero2).toMatchObject({ sprite: "hero", kind: "player", controls: true });
    expect(hero2.tick).toContain("ox[slot]");
    expect(flat.find((l) => l.path === "box")).toMatchObject({
      sprite: "wall",
      kind: "movable",
      solid: true,
      anim: "spin",
    });
  });

  it("applies physics rules to resolved leaves, explicit false included", () => {
    const p = defProject();
    // explicit local false beats the def default (??, not ||) — and
    // the resolved leaf is what the rule sees.
    p.scenes[0].nodes.find((o) => o.id === "box")!.solid = false;
    const errs = validateProject(p);
    expect(errs.some((e) => e.includes("'box' movable requires solid"))).toBe(true);
  });

  it("validates defs and their instances", () => {
    expect(validateProject(defProject())).toEqual([]);
    const badDef = defProject();
    badDef.objectDefs![1] = { id: "crate", sprite: "ghost", kind: "movable" };
    const errs = validateProject(badDef);
    expect(errs.some((e) => e.includes("unknown sprite 'ghost'"))).toBe(true);
    expect(errs.some((e) => e.includes("movable requires solid"))).toBe(true);
    const badRef = defProject();
    badRef.scenes[0].nodes.push({ id: "lost", x: 0, y: 0, def: "nope" });
    expect(validateProject(badRef).some((e) => e.includes("unknown object 'nope'"))).toBe(true);
  });

  it("counts players and drivers post-resolution", () => {
    const p = defProject();
    expect(validateProject(p)).toEqual([]);
    // a second player via a second instance of the same def still counts
    p.scenes[0].nodes.push({ id: "hero3", x: 64, y: 0, def: "hero_obj" });
    expect(validateProject(p).some((e) => e.includes("at most one player"))).toBe(true);
  });

  it("emits def-backed leaves like inlines", () => {
    const p = defProject();
    expect(validateProject(p)).toEqual([]);
    const main = emitProject(p)["main.ux"];
    expect(main).toContain("tick_title_hero2");
    expect(main).toContain("ox[slot] = ox[slot];");
  });
});

describe("object events", () => {
  function evProject(): Project {
    const p = structuredClone(SAMPLE_PROJECT);
    p.sounds = [
      { id: "blip", voices: [{ note: 72, vol: 100 }, { note: 0, vol: 0 }, { note: 0, vol: 0 }, { note: 0, vol: 0 }] },
      { id: "chime", voices: [{ note: 0, vol: 0 }, { note: 60, vol: 100 }, { note: 0, vol: 0 }, { note: 0, vol: 0 }] },
    ];
    p.objectDefs = [
      {
        id: "coin_obj",
        sprite: "coin",
        kind: "static",
        events: [
          { id: "ev_1", trigger: "create", blocks: [{ op: "play", sound: "blip" }] },
          { id: "ev_2", trigger: "click", blocks: [{ op: "play", sound: "blip" }] },
          { id: "ev_3", trigger: "destroy", blocks: [{ op: "play", sound: "blip" }] },
        ],
      },
    ];
    p.scenes[0].nodes.push(
      { id: "bonus", x: 0, y: 0, def: "coin_obj" },
      {
        id: "walker",
        x: 8,
        y: 8,
        sprite: "hero",
        kind: "static",
        events: [
          { id: "ev_1", trigger: "step", blocks: [{ op: "move", dx: 1, dy: 0 }, { op: "wait", ticks: 30 }] },
          { id: "ev_2", trigger: "key", key: "jump", blocks: [{ op: "set_pos", x: 8, y: 8 }] },
          { id: "ev_3", trigger: "collide", target: "def:coin_obj", blocks: [{ op: "destroy" }] },
          { id: "ev_4", trigger: "alarm", blocks: [{ op: "play", sound: "chime" }] },
          { id: "ev_5", trigger: "destroy", blocks: [{ op: "play", sound: "chime" }] },
        ],
      },
    );
    return p;
  }

  it("accepts a project using every trigger and block", () => {
    expect(validateProject(evProject())).toEqual([]);
  });

  it("rejects bad triggers, refs, duplicates and ranges", () => {
    const badId = evProject();
    badId.objectDefs![0].events!.push({ id: "ev_1", trigger: "step", blocks: [] });
    expect(validateProject(badId).some((e) => e.includes("duplicate event id"))).toBe(true);
    const badTrigger = evProject();
    (badTrigger.objectDefs![0].events![0] as { trigger: string }).trigger = "explode";
    expect(validateProject(badTrigger).some((e) => e.includes("bad trigger"))).toBe(true);
    const badKey = evProject();
    badKey.scenes[0].nodes.find((o) => o.id === "walker")!.events![1].key = "nope";
    expect(validateProject(badKey).some((e) => e.includes("needs a known input"))).toBe(true);
    const badTarget = evProject();
    badTarget.scenes[0].nodes.find((o) => o.id === "walker")!.events![2].target = "def:nope";
    expect(validateProject(badTarget).some((e) => e.includes("collide target must be"))).toBe(true);
    const badSound = evProject();
    (badSound.objectDefs![0].events![0].blocks[0] as { sound: string }).sound = "nope";
    expect(validateProject(badSound).some((e) => e.includes("play needs a known sound"))).toBe(true);
    const silent = evProject();
    silent.sounds!.forEach((x) => x.voices.forEach((v) => (v.vol = 0)));
    expect(validateProject(silent).some((e) => e.includes("is silent"))).toBe(true);
    const badGoto = evProject();
    badGoto.scenes[0].nodes.find((o) => o.id === "walker")!.events!.push({
      id: "ev_9",
      trigger: "step",
      blocks: [{ op: "goto", scene: "nowhere" }],
    });
    expect(validateProject(badGoto).some((e) => e.includes("goto unknown scene"))).toBe(true);
  });

  it("rejects instance-local events and unpaired waits", () => {
    const p = evProject();
    p.scenes[0].nodes.find((o) => o.id === "bonus")!.events = [{ id: "ev_9", trigger: "step", blocks: [] }];
    expect(validateProject(p).some((e) => e.includes("carry no events"))).toBe(true);
    const q = evProject();
    q.scenes[0].nodes.find((o) => o.id === "walker")!.events = q.scenes[0].nodes
      .find((o) => o.id === "walker")!
      .events!.filter((e) => e.trigger !== "alarm");
    expect(validateProject(q).some((e) => e.includes("no alarm event"))).toBe(true);
  });

  it("rejects dead collide targets and caps pairs", () => {
    const p = evProject();
    p.scenes[1].nodes.push({
      id: "lonely",
      x: 0,
      y: 0,
      sprite: "hero",
      kind: "static",
      events: [{ id: "ev_1", trigger: "collide", target: "def:coin_obj", blocks: [{ op: "destroy" }] }],
    });
    expect(validateProject(p).some((e) => e.includes("matches nothing"))).toBe(true);
    const big = structuredClone(SAMPLE_PROJECT);
    for (let i = 0; i < 8; i++) {
      big.scenes[0].nodes.push({
        id: `swarm${i}`,
        x: i * 8,
        y: 0,
        sprite: "hero",
        kind: "static",
        events: [{ id: "ev_1", trigger: "collide", target: "any", blocks: [{ op: "destroy" }] }],
      });
    }
    expect(validateProject(big).some((e) => e.includes("collide pairs"))).toBe(true);
  });

  it("lowers every block to fixed lines", async () => {
    const { previewBlocks, soundMap, snippetMap, tileDimsOf } = await import("./project");
    const p = evProject();
    const ctx = { slot: "slot", w: 128, h: 128, sounds: soundMap(p), snippets: snippetMap(p), tiles: tileDimsOf(p) };
    expect(previewBlocks([{ op: "move", dx: 2, dy: -3 }], ctx)).toEqual([
      "if ox[slot] + ow[slot] < 129 { ox[slot] = ox[slot] + 2; }",
      "if oy[slot] >= 3 { oy[slot] = oy[slot] - 3; }",
    ]);
    expect(previewBlocks([{ op: "set_pos", x: 1, y: 2 }], ctx)).toEqual(["ox[slot] = 1; oy[slot] = 2;"]);
    expect(previewBlocks([{ op: "play", sound: "blip" }], ctx)).toEqual([
      "Audio0.addr = &sq32;",
      "Audio0.length = 32;",
      "Audio0.volume = 100;",
      "Audio0.adsr = 4369;",
      "Audio0.pitch = 200;",
    ]);
    expect(previewBlocks([{ op: "play", sound: "chime" }], ctx)).toEqual([
      "Audio1.addr = &sq32;",
      "Audio1.length = 32;",
      "Audio1.volume = 100;",
      "Audio1.adsr = 4369;",
      "Audio1.pitch = 188;",
    ]);
    expect(previewBlocks([{ op: "play", sound: "nope" }], ctx)).toEqual(["( unknown sound 'nope' )"]);
    expect(previewBlocks([{ op: "goto", scene: "play" }], ctx)).toEqual(["setup_play();", "scene_go(SC_PLAY);"]);
    expect(previewBlocks([{ op: "destroy" }], { ...ctx, destroyFn: "destroy_x" })).toEqual([
      "destroy_x(slot);",
      "oflags[slot] = oflags[slot] & 247;",
    ]);
    expect(previewBlocks([{ op: "wait", ticks: 30 }], ctx)).toEqual(["oat[slot] = 30;"]);
    expect(previewBlocks([{ op: "show" }], ctx)).toEqual(["oflags[slot] = oflags[slot] | 8;"]);
    expect(previewBlocks([{ op: "hide" }], ctx)).toEqual(["oflags[slot] = oflags[slot] & 247;"]);
    expect(previewBlocks([{ op: "destroy" }], { ...ctx, destroyFn: "destroy_x" })).toEqual([
      "destroy_x(slot);",
      "oflags[slot] = oflags[slot] & 247;",
    ]);
    expect(previewBlocks([{ op: "destroy", target: "self" }], ctx)).toEqual([
      "oflags[slot] = oflags[slot] & 247;",
    ]);
    expect(previewBlocks([{ op: "destroy", target: "any" }], ctx)).toEqual(["( destroy 'any' matches nothing )"]);
  });

  it("lowers sprite swaps and targeted destroy with victim fns", async () => {
    const { previewBlocks, soundMap, snippetMap, tileDimsOf } = await import("./project");
    const p = structuredClone(SAMPLE_PROJECT);
    const tiles = tileDimsOf(p);
    const ctx = { slot: "slot", w: 128, h: 128, sounds: soundMap(p), snippets: snippetMap(p), tiles };
    const [tw, th] = tiles.get("wall") ?? [1, 1];
    expect(previewBlocks([{ op: "sprite", sprite: "wall" }], ctx)).toEqual([
      "ot[slot] = &spr_wall;",
      `ow[slot] = ${tw * 8}; oh[slot] = ${th * 8};`,
    ]);
    expect(previewBlocks([{ op: "sprite", sprite: "nope" }], ctx)).toEqual(["( unknown sprite 'nope' )"]);
    const victims = [{ slot: "3", fn: "destroy_def_coin" }, { slot: "5" }];
    expect(previewBlocks([{ op: "destroy", target: "def:coin" }], { ...ctx, victimsOf: () => victims })).toEqual([
      "if oflags[3] & 8 != 0 {",
      "    destroy_def_coin(3);",
      "    oflags[3] = oflags[3] & 247;",
      "}",
      "if oflags[5] & 8 != 0 {",
      "    oflags[5] = oflags[5] & 247;",
      "}",
    ]);
  });

  it("wires fns, dispatch and alive guards through the frame", () => {
    const main = emitProject(evProject())["main.ux"];
    // setup marks slots alive and calls create fns
    expect(main).toContain("oflags[0] = 9;");
    expect(main).toContain("create_title_bonus(3);");
    // per-leaf fns exist for every trigger
    for (const fn of ["click_title_bonus", "tick_title_walker", "key_title_walker_jump", "collide_title_walker_0", "alarm_title_walker", "destroy_title_walker", "destroy_def_coin_obj"]) {
      expect(main).toContain(`${fn} :: fn(slot: u16) {`);
    }
    // step blocks run before legacy tick text in the historic name
    expect(main.indexOf("oat[slot] = 30;")).toBeLessThan(main.indexOf("tick_title_walker(4);"));
    // dispatch guards the alive bit; alarm polls the countdown
    expect(main).toContain("if k == 32 {");
    expect(main).toContain("key_title_walker_jump(4);");
    expect(main).toContain("if oat[4] > 0 {");
    // draw and drive honor destroyed leaves
    expect(main).toContain("if oflags[4] & 8 != 0 {");
    expect(main).toContain("oflags[j] & 10 == 10");
  });

  it("assembles a full-events project with the real etal", async () => {
    const files = emitProject(evProject());
    const etal =
      process.env.ETAL_BIN ?? "/home/grim/Documents/projects/uxn-dsl/build/linux-x86/etal";
    if (!existsSync(etal)) {
      console.warn("skip: no etal binary");
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "uxn-events-"));
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content);
    }
    execFileSync(etal, ["-r", join(dir, "main.ux"), "-o", join(dir, "events.rom")], { stdio: "pipe" });
    expect(existsSync(join(dir, "events.rom"))).toBe(true);
  });
});

describe("scene map", () => {
  it("orders nodes by depth and lists bindings plus event gotos", async () => {
    const { buildSceneMap } = await import("./project");
    const p = structuredClone(SAMPLE_PROJECT);
    p.scenes.push({ id: "void", nodes: [], clicks: [], keys: [] });
    p.scenes[0].nodes.find((o) => o.id === "hero")!.events!.push({
      id: "ev_9",
      trigger: "step",
      blocks: [{ op: "goto", scene: "void" }],
    });
    const map = buildSceneMap(p);
    expect(map.nodes.map((n) => [n.id, n.depth])).toEqual([
      ["title", 0],
      ["play", 1],
      ["void", 1],
    ]);
    expect(map.nodes.find((n) => n.id === "title")!.leaves).toBe(3);
    const labels = map.edges.map((e) => `${e.from}→${e.to}|${e.label}`);
    expect(labels).toContain("title→play|click hero");
    expect(labels).toContain("title→play|key jump");
    expect(labels).toContain("play→title|key back");
    expect(labels).toContain("title→void|step hero");
  });

  it("dedupes edges, skips unknown gotos, and survives broken scenes", async () => {
    const { buildSceneMap } = await import("./project");
    const p = structuredClone(SAMPLE_PROJECT);
    p.scenes[0].nodes.find((o) => o.id === "hero")!.events!.push(
      { id: "ev_9", trigger: "step", blocks: [{ op: "goto", scene: "play" }] },
      { id: "ev_10", trigger: "step", blocks: [{ op: "goto", scene: "play" }] },
      { id: "ev_11", trigger: "step", blocks: [{ op: "goto", scene: "nowhere" }] },
    );
    // a nesting cycle: flatten throws, the node still lists
    p.scenes.push(
      { id: "a", nodes: [{ id: "to_b", x: 0, y: 0, scene: "b" }], clicks: [], keys: [] },
      { id: "b", nodes: [{ id: "to_a", x: 0, y: 0, scene: "a" }], clicks: [], keys: [] },
    );
    const map = buildSceneMap(p);
    const steps = map.edges.filter((e) => e.label === "step hero");
    expect(steps).toHaveLength(1);
    expect(map.edges.some((e) => e.to === "nowhere")).toBe(false);
    const broken = map.nodes.find((n) => n.id === "a")!;
    expect(broken).toMatchObject({ broken: true, leaves: -1, depth: -1 });
    expect(map.nodes.map((n) => n.id)).toContain("b");
  });
});

describe("phase 5 polish", () => {
  it("validates hitboxes against resolved sprites", () => {
    const p = structuredClone(SAMPLE_PROJECT);
    const hero = p.scenes[0].nodes.find((o) => o.id === "hero")!;
    hero.mask = { x: 2, y: 2, w: 4, h: 4 };
    expect(validateProject(p)).toEqual([]);
    const over = structuredClone(SAMPLE_PROJECT);
    over.scenes[0].nodes.find((o) => o.id === "hero")!.mask = { x: 6, y: 0, w: 4, h: 8 };
    expect(validateProject(over).some((e) => e.includes("mask must fit"))).toBe(true);
    const zero = structuredClone(SAMPLE_PROJECT);
    zero.scenes[0].nodes.find((o) => o.id === "hero")!.mask = { x: 0, y: 0, w: 0, h: 8 };
    expect(validateProject(zero).some((e) => e.includes("mask must fit"))).toBe(true);
    const defMask = structuredClone(SAMPLE_PROJECT);
    defMask.objectDefs = [{ id: "box", sprite: "ghost", kind: "static", mask: { x: 0, y: 0, w: 8, h: 8 } }];
    expect(validateProject(defMask).some((e) => e.includes("unknown sprite 'ghost'"))).toBe(true);
  });

  it("sizes click rects and collide pairs by mask, drive stays full", () => {
    const p = structuredClone(SAMPLE_PROJECT);
    p.scenes[0].nodes.find((o) => o.id === "hero")!.mask = { x: 2, y: 2, w: 4, h: 4 };
    p.scenes[0].nodes.find((o) => o.id === "coin")!.events = [
      { id: "ev_1", trigger: "collide", target: "any", blocks: [{ op: "destroy" }] },
    ];
    const main = emitProject(p)["main.ux"];
    expect(main).toContain("pt_in_rect(mx, my, ox[0] + 2, oy[0] + 2, 4, 4)");
    expect(main).toContain("overlapwh(ox[slot], oy[slot], ow[slot], oh[slot], ox[0] + 2, oy[0] + 2, 4, 4)");
    // drive keeps full sprite bounds (generous world, precise hitbox)
    expect(main).toContain("if nx < 120 { nx = nx + 1; }");
  });

  it("validates creation code like tick text", () => {
    const p = structuredClone(SAMPLE_PROJECT);
    p.scenes[0].nodes.find((o) => o.id === "wall")!.initCode = "ox[slot] = ox[slot];";
    expect(validateProject(p)).toEqual([]);
    const bad = structuredClone(SAMPLE_PROJECT);
    bad.scenes[0].nodes.find((o) => o.id === "wall")!.initCode = "scene: u8 = 1;";
    expect(validateProject(bad).some((e) => e.includes("creation code"))).toBe(true);
  });

  it("runs creation code after create blocks in setup order", () => {
    const p = structuredClone(SAMPLE_PROJECT);
    const wall = p.scenes[0].nodes.find((o) => o.id === "wall")!;
    wall.events = [{ id: "ev_1", trigger: "create", blocks: [{ op: "play", sound: "blip" }] }];
    wall.initCode = "ox[slot] = ox[slot];";
    expect(validateProject(p)).toEqual([]);
    const main = emitProject(p)["main.ux"];
    expect(main).toContain("create_title_wall(1);");
    const fn = main.slice(main.indexOf("create_title_wall :: fn(slot: u16) {"));
    expect(fn.indexOf("Audio1.pitch = 212;")).toBeLessThan(fn.indexOf("ox[slot] = ox[slot];"));
  });

  it("calls create for instance code alone, no event needed", () => {
    const p = structuredClone(SAMPLE_PROJECT);
    p.scenes[0].nodes.find((o) => o.id === "wall")!.initCode = "ox[slot] = ox[slot];";
    expect(validateProject(p)).toEqual([]);
    const main = emitProject(p)["main.ux"];
    expect(main).toContain("create_title_wall :: fn(slot: u16) {");
    expect(main).toContain("create_title_wall(1);");
  });

  it("validates ping-pong needs loop plus two frames", () => {
    const p = structuredClone(SAMPLE_PROJECT);
    p.anims.find((a) => a.id === "spin")!.pingpong = true;
    expect(validateProject(p)).toEqual([]);
    const noLoop = structuredClone(SAMPLE_PROJECT);
    Object.assign(noLoop.anims.find((a) => a.id === "spin")!, { loop: false, pingpong: true });
    expect(validateProject(noLoop).some((e) => e.includes("pingpong needs loop"))).toBe(true);
    const one = structuredClone(SAMPLE_PROJECT);
    one.anims.push({ id: "solo", frames: ["hero"], rate: 30, loop: true, pingpong: true });
    expect(validateProject(one).some((e) => e.includes("2+ frames"))).toBe(true);
  });

  it("bounces animation frames at the ends", () => {
    const p = structuredClone(SAMPLE_PROJECT);
    p.anims.find((a) => a.id === "spin")!.pingpong = true;
    const main = emitProject(p)["main.ux"];
    expect(main).toContain("adir_title_coin: u8 = 0;");
    expect(main).toContain("if adir_title_coin == 0 {");
    expect(main).toContain("afr_title_coin = 0; adir_title_coin = 1;");
  });

  it("assembles masks, creation code and ping-pong with the real etal", async () => {
    const p = structuredClone(SAMPLE_PROJECT);
    p.anims.find((a) => a.id === "spin")!.pingpong = true;
    p.scenes[0].nodes.find((o) => o.id === "hero")!.mask = { x: 2, y: 2, w: 4, h: 4 };
    p.scenes[0].nodes.find((o) => o.id === "wall")!.initCode = "ox[slot] = ox[slot];";
    expect(validateProject(p)).toEqual([]);
    const files = emitProject(p);
    const etal = process.env.ETAL_BIN ?? "/home/grim/Documents/projects/uxn-dsl/build/linux-x86/etal";
    if (!existsSync(etal)) {
      console.warn("skip: no etal binary");
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "uxn-phase5-"));
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content);
    }
    execFileSync(etal, ["-r", join(dir, "main.ux"), "-o", join(dir, "phase5.rom")], { stdio: "pipe" });
    expect(existsSync(join(dir, "phase5.rom"))).toBe(true);
  });
});

describe("named sounds", () => {
  it("migrates literal play blocks to shared named sounds", () => {
    const raw = structuredClone(SAMPLE_PROJECT) as unknown as Record<string, unknown>;
    delete raw["sounds"];
    const scenes = raw["scenes"] as Array<{ nodes: Array<Record<string, unknown>> }>;
    const hero = scenes[0].nodes.find((o) => o.id === "hero")!;
    hero["events"] = [{ id: "ev_9", trigger: "click", blocks: [{ op: "play", voice: 1, note: 72, vol: 100 }] }];
    const wall = scenes[0].nodes.find((o) => o.id === "wall")!;
    wall["events"] = [{ id: "ev_1", trigger: "step", blocks: [{ op: "play", voice: 1, note: 72, vol: 100 }] }];
    const p = migrateProject(raw);
    // identical literals share one synthesized sound
    expect(p.sounds).toEqual([
      {
        id: "sfx_1_72_100",
        voices: [{ note: 0, vol: 0 }, { note: 72, vol: 100 }, { note: 0, vol: 0 }, { note: 0, vol: 0 }],
      },
    ]);
    const heroEv = p.scenes[0].nodes.find((o) => o.id === "hero")!.events![0];
    expect(heroEv.blocks).toEqual([{ op: "play", sound: "sfx_1_72_100" }]);
    const wallEv = p.scenes[0].nodes.find((o) => o.id === "wall")!.events![0];
    expect(wallEv.blocks).toEqual([{ op: "play", sound: "sfx_1_72_100" }]);
    expect(validateProject(p)).toEqual([]);
    expect(emitProject(p)["main.ux"]).toContain("Audio1.pitch = 200;");
  });

  it("validates the sound library", () => {
    const dup = structuredClone(SAMPLE_PROJECT);
    dup.sounds!.push({ id: "blip", voices: [{ note: 60, vol: 100 }] });
    expect(validateProject(dup).some((e) => e.includes("duplicate sound id"))).toBe(true);
    const badVoice = structuredClone(SAMPLE_PROJECT);
    badVoice.sounds![0].voices[1] = { note: 200, vol: 100 };
    expect(validateProject(badVoice).some((e) => e.includes("note must be 0–107"))).toBe(true);
    const silent = structuredClone(SAMPLE_PROJECT);
    silent.sounds![0].voices.forEach((v) => (v.vol = 0));
    expect(validateProject(silent).some((e) => e.includes("is silent"))).toBe(true);
    const dangling = structuredClone(SAMPLE_PROJECT);
    (dangling.scenes[0].nodes.find((o) => o.id === "hero")!.events![0].blocks[0] as { sound: string }).sound = "nope";
    expect(validateProject(dangling).some((e) => e.includes("play needs a known sound"))).toBe(true);
  });

  it("plays a sound after boot in the sample", () => {
    const files = emitProject(SAMPLE_PROJECT);
    expect(files["main.ux"]).toContain("click_title_hero :: fn(slot: u16) {");
    expect(files["main.ux"]).toContain("Audio1.pitch = 212;");
    expect(files["devices.ux"]).toContain("device Audio1 64");
  });
});

describe("named inputs", () => {
  function legacy(): Record<string, unknown> {
    const p = structuredClone(SAMPLE_PROJECT) as unknown as Record<string, unknown>;
    delete p["inputs"];
    for (const s of p["scenes"] as Array<Record<string, unknown>>) {
      for (const k of s["keys"] as Array<Record<string, unknown>>) delete k["input"];
    }
    return p;
  }

  it("migrates legacy key codes to shared key_* inputs", () => {
    const p = migrateProject(legacy());
    expect(p.inputs).toEqual([
      { id: "key_32", key: 32 },
      { id: "key_27", key: 27 },
    ]);
    expect(p.scenes[0].keys[0].input).toBe("key_32");
    expect(p.scenes[1].keys[0].input).toBe("key_27");
    expect(validateProject(p)).toEqual([]);
    expect(emitProject(p)["main.ux"]).toContain("if k == 32");
  });

  it("rejects bindings on unknown inputs", () => {
    const p = structuredClone(SAMPLE_PROJECT);
    p.scenes[0].keys.push({ input: "nope", key: 32, goto: "play" });
    expect(validateProject(p).some((e) => e.includes("unknown input"))).toBe(true);
  });

  it("resolves renamed inputs at emit time", () => {
    const p = structuredClone(SAMPLE_PROJECT);
    p.inputs.push({ id: "jump2", key: 32 });
    p.scenes[0].keys[0].input = "jump2";
    expect(emitProject(p)["main.ux"]).toContain("if k == 32");
  });
});

describe("execute + button blocks", () => {
  it("lowers code verbatim and button to a comment", async () => {
    const { previewBlocks, soundMap, snippetMap, tileDimsOf } = await import("./project");
    const ctx = { slot: "slot", w: 128, h: 128, sounds: soundMap(SAMPLE_PROJECT), snippets: snippetMap(SAMPLE_PROJECT), tiles: tileDimsOf(SAMPLE_PROJECT) };
    expect(previewBlocks([{ op: "code", code: "ox[slot] = ox[slot];\noy[slot] = 4;" }], ctx)).toEqual([
      "ox[slot] = ox[slot];",
      "oy[slot] = 4;",
    ]);
    expect(previewBlocks([{ op: "button", label: "jump", action: "play" }], ctx)).toEqual([
      "( button 'jump' -> play )",
    ]);
  });

  it("rejects empty/colliding code and bad button text", () => {
    const empty = structuredClone(SAMPLE_PROJECT);
    empty.scenes[0].nodes.find((o) => o.id === "hero")!.events!.push({
      id: "ev_9",
      trigger: "step",
      blocks: [{ op: "code", code: "   " }],
    });
    expect(validateProject(empty).some((e) => e.includes("needs ETAL statements"))).toBe(true);
    const collide = structuredClone(SAMPLE_PROJECT);
    collide.scenes[0].nodes.find((o) => o.id === "hero")!.events!.push({
      id: "ev_9",
      trigger: "step",
      blocks: [{ op: "code", code: "scene: u8 = 1;" }],
    });
    expect(validateProject(collide).some((e) => e.includes("collides"))).toBe(true);
    const badLabel = structuredClone(SAMPLE_PROJECT);
    badLabel.scenes[0].nodes.find((o) => o.id === "hero")!.events!.push({
      id: "ev_9",
      trigger: "step",
      blocks: [{ op: "button", label: 'say "hi"', action: "" }],
    });
    expect(validateProject(badLabel).some((e) => e.includes("label must not contain"))).toBe(true);
    const badAction = structuredClone(SAMPLE_PROJECT);
    badAction.scenes[0].nodes.find((o) => o.id === "hero")!.events!.push({
      id: "ev_9",
      trigger: "step",
      blocks: [{ op: "button", label: "ok", action: "x".repeat(65) }],
    });
    expect(validateProject(badAction).some((e) => e.includes("at most 64"))).toBe(true);
  });

  it("lowers run blocks from snippets and rejects bad refs", async () => {
    const { previewBlocks, snippetMap } = await import("./project");
    const withSnip = structuredClone(SAMPLE_PROJECT);
    withSnip.snippets = [{ id: "hop", code: "oy[slot] = oy[slot] - 2;" }];
    const ctx = { slot: "slot", w: 128, h: 128, sounds: new Map(), snippets: snippetMap(withSnip) };
    expect(previewBlocks([{ op: "run", snippet: "hop" }], ctx)).toEqual(["oy[slot] = oy[slot] - 2;"]);
    expect(previewBlocks([{ op: "run", snippet: "nope" }], ctx)).toEqual(["( unknown snippet 'nope' )"]);
    const badRef = structuredClone(withSnip);
    badRef.scenes[0].nodes.find((o) => o.id === "hero")!.events = [
      { id: "ev_9", trigger: "step", blocks: [{ op: "run", snippet: "nope" }] },
    ];
    expect(validateProject(badRef).some((e) => e.includes("known snippet"))).toBe(true);
    const badCode = structuredClone(withSnip);
    badCode.snippets = [{ id: "hop", code: "scene: u8 = 1;" }];
    expect(validateProject(badCode).some((e) => e.includes("collides"))).toBe(true);
    const dup = structuredClone(withSnip);
    dup.snippets = [
      { id: "hop", code: "ox[slot] = 1;" },
      { id: "hop", code: "ox[slot] = 2;" },
    ];
    expect(validateProject(dup).some((e) => e.includes("duplicate snippet"))).toBe(true);
    const ok = structuredClone(withSnip);
    ok.scenes[0].nodes.find((o) => o.id === "hero")!.events = [
      { id: "ev_9", trigger: "step", blocks: [{ op: "run", snippet: "hop" }] },
    ];
    expect(validateProject(ok)).toEqual([]);
    expect(emitProject(ok)["main.ux"]).toContain("oy[slot] = oy[slot] - 2;");
  });

  it("validates sprite swaps and targeted destroy", () => {
    const badTarget = structuredClone(SAMPLE_PROJECT);
    badTarget.scenes[0].nodes.find((o) => o.id === "hero")!.events = [
      { id: "ev_9", trigger: "step", blocks: [{ op: "destroy", target: "def:nope" }] },
    ];
    expect(validateProject(badTarget).some((e) => e.includes("destroy target must be"))).toBe(true);
    const badSprite = structuredClone(SAMPLE_PROJECT);
    badSprite.scenes[0].nodes.find((o) => o.id === "hero")!.events = [
      { id: "ev_9", trigger: "step", blocks: [{ op: "sprite", sprite: "nope" }] },
    ];
    expect(validateProject(badSprite).some((e) => e.includes("needs a known sprite"))).toBe(true);
    const badSize = structuredClone(SAMPLE_PROJECT);
    badSize.sprites.find((s) => s.id === "wall")!.w = 2;
    badSize.scenes[0].nodes.find((o) => o.id === "hero")!.events = [
      { id: "ev_9", trigger: "step", blocks: [{ op: "sprite", sprite: "wall" }] },
    ];
    expect(validateProject(badSize).some((e) => e.includes("must match 1×1 tiles"))).toBe(true);
    const noHits = structuredClone(SAMPLE_PROJECT);
    noHits.scenes[0].nodes = noHits.scenes[0].nodes.filter((o) => o.id === "hero");
    noHits.scenes[0].nodes.find((o) => o.id === "hero")!.events = [
      { id: "ev_9", trigger: "step", blocks: [{ op: "destroy", target: "movable" }] },
    ];
    expect(validateProject(noHits).some((e) => e.includes("matches nothing"))).toBe(true);
    const many = structuredClone(SAMPLE_PROJECT);
    for (let i = 0; i < 14; i++)
      many.scenes[0].nodes.push({ id: `crate${i}`, x: 0, y: 0, sprite: "wall", kind: "static", solid: true });
    many.scenes[0].nodes.find((o) => o.id === "hero")!.events = [
      { id: "ev_9", trigger: "step", blocks: [{ op: "destroy", target: "solid" }] },
    ];
    expect(validateProject(many).some((e) => e.includes("max 12"))).toBe(true);
  });

  it("emits sprite, visibility and targeted destroy lines", () => {
    const p = structuredClone(SAMPLE_PROJECT);
    p.scenes[0].nodes.find((o) => o.id === "hero")!.events = [
      {
        id: "ev_9",
        trigger: "step",
        blocks: [
          { op: "sprite", sprite: "wall" },
          { op: "hide" },
          { op: "show" },
          { op: "destroy", target: "solid" },
        ],
      },
    ];
    expect(validateProject(p)).toEqual([]);
    const main = emitProject(p)["main.ux"];
    expect(main).toContain("ot[slot] = &spr_wall;");
    expect(main).toContain("ow[slot] = 8; oh[slot] = 8;");
    expect(main).toContain("oflags[slot] = oflags[slot] & 247;");
    expect(main).toContain("oflags[slot] = oflags[slot] | 8;");
    expect(main).toContain("oflags[1] = oflags[1] & 247;");
    expect(main).toContain("oflags[2] = oflags[2] & 247;");
    const etal =
      process.env.ETAL_BIN ?? "/home/grim/Documents/projects/uxn-dsl/build/linux-x86/etal";
    if (!existsSync(etal)) {
      console.warn("skip: no etal binary");
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "uxn-phasea-"));
    for (const [name, content] of Object.entries(emitProject(p))) {
      writeFileSync(join(dir, name), content);
    }
    execFileSync(etal, ["-r", join(dir, "main.ux"), "-o", join(dir, "main.rom")], { stdio: "pipe" });
    expect(existsSync(join(dir, "main.rom"))).toBe(true);
  });

  it("lowers set/if blocks with every operand kind", async () => {
    const { previewBlocks, tileDimsOf, soundMap, snippetMap } = await import("./project");
    const p = structuredClone(SAMPLE_PROJECT);
    p.vars = [{ id: "score", init: 0 }];
    const ctx = { slot: "slot", w: 128, h: 128, sounds: soundMap(p), snippets: snippetMap(p), tiles: tileDimsOf(p) };
    expect(previewBlocks([{ op: "set", name: "score", mode: "set", value: 5 }], ctx)).toEqual(["var_score[0] = 5;"]);
    expect(previewBlocks([{ op: "set", name: "score", mode: "add", value: 2 }], ctx)).toEqual(["var_score[0] = var_score[0] + 2;"]);
    expect(previewBlocks([{ op: "set", name: "score", mode: "sub", value: 1 }], ctx)).toEqual(["var_score[0] = var_score[0] - 1;"]);
    expect(
      previewBlocks(
        [{ op: "if", cond: { left: { kind: "var", name: "score" }, op: "gte", right: { kind: "const", value: 10 } }, then: [{ op: "destroy" }], else: [{ op: "show" }] }],
        ctx,
      ),
    ).toEqual([
      "if var_score[0] >= 10 {",
      "    oflags[slot] = oflags[slot] & 247;",
      "} else {",
      "    oflags[slot] = oflags[slot] | 8;",
      "}",
    ]);
    expect(
      previewBlocks(
        [{ op: "if", cond: { left: { kind: "btn", dir: "left" }, op: "neq", right: { kind: "const", value: 0 } }, then: [{ op: "move", dx: -2, dy: 0 }] }],
        ctx,
      ),
    ).toEqual([
      "if (Controller.button & 64) != 0 {",
      "    if ox[slot] >= 2 { ox[slot] = ox[slot] - 2; }",
      "}",
    ]);
    expect(
      previewBlocks(
        [{ op: "if", cond: { left: { kind: "pos", axis: "y" }, op: "lt", right: { kind: "var", name: "score" } }, then: [] }],
        ctx,
      ),
    ).toEqual(["if oy[slot] < var_score[0] {", "}"]);
  });

  it("validates variables, conditions and slot pairing", () => {
    const dup = structuredClone(SAMPLE_PROJECT);
    dup.vars = [{ id: "score", init: 0 }, { id: "score", init: 1 }];
    expect(validateProject(dup).some((e) => e.includes("duplicate variable"))).toBe(true);
    const badId = structuredClone(SAMPLE_PROJECT);
    badId.vars = [{ id: "9lives", init: 3 }];
    expect(validateProject(badId).some((e) => e.includes("bad variable id"))).toBe(true);
    const badInit = structuredClone(SAMPLE_PROJECT);
    badInit.vars = [{ id: "score", init: 70000 }];
    expect(validateProject(badInit).some((e) => e.includes("init must be"))).toBe(true);
    const badRef = structuredClone(SAMPLE_PROJECT);
    badRef.vars = [{ id: "score", init: 0 }];
    badRef.scenes[0].nodes.find((o) => o.id === "hero")!.events = [
      { id: "ev_9", trigger: "step", blocks: [{ op: "set", name: "nope", mode: "set", value: 1 }] },
    ];
    expect(validateProject(badRef).some((e) => e.includes("known variable"))).toBe(true);
    const badCond = structuredClone(SAMPLE_PROJECT);
    badCond.vars = [{ id: "score", init: 0 }];
    badCond.scenes[0].nodes.find((o) => o.id === "hero")!.events = [
      { id: "ev_9", trigger: "step", blocks: [{ op: "if", cond: { left: { kind: "var", name: "ghost" }, op: "eq", right: { kind: "const", value: 0 } }, then: [] }] },
    ];
    expect(validateProject(badCond).some((e) => e.includes("unknown variable"))).toBe(true);
    const deep = structuredClone(SAMPLE_PROJECT);
    deep.vars = [{ id: "score", init: 0 }];
    const mkIf = (then: Block[]): Block => ({
      op: "if",
      cond: { left: { kind: "const", value: 1 }, op: "eq", right: { kind: "const", value: 1 } },
      then,
    });
    const nest = (d: number): Block => (d === 0 ? mkIf([]) : mkIf([nest(d - 1)]));
    deep.scenes[0].nodes.find((o) => o.id === "hero")!.events = [{ id: "ev_9", trigger: "step", blocks: [nest(3)] }];
    expect(validateProject(deep).some((e) => e.includes("nests past"))).toBe(true);
    const unpaired = structuredClone(SAMPLE_PROJECT);
    unpaired.scenes[0].nodes.find((o) => o.id === "hero")!.events = [
      { id: "ev_9", trigger: "step", blocks: [{ op: "wait", ticks: 10, slot: 2 }] },
    ];
    expect(validateProject(unpaired).some((e) => e.includes("slot 2"))).toBe(true);
    const badSlot = structuredClone(SAMPLE_PROJECT);
    badSlot.scenes[0].nodes.find((o) => o.id === "hero")!.events = [
      { id: "ev_9", trigger: "alarm", alarm: 5, blocks: [{ op: "show" }] },
    ];
    expect(validateProject(badSlot).some((e) => e.includes("alarm slot"))).toBe(true);
  });

  it("emits multi-alarm buffers, slot fns and var init", () => {
    const p = structuredClone(SAMPLE_PROJECT);
    p.vars = [{ id: "score", init: 7 }];
    p.scenes[0].nodes.find((o) => o.id === "hero")!.events = [
      { id: "ev_9", trigger: "step", blocks: [{ op: "set", name: "score", mode: "add", value: 1 }, { op: "wait", ticks: 5, slot: 2 }] },
      { id: "ev_8", trigger: "alarm", alarm: 2, blocks: [{ op: "show" }] },
    ];
    expect(validateProject(p)).toEqual([]);
    const main = emitProject(p)["main.ux"];
    expect(main).toContain("buffer var_score[1]: u16;");
    expect(main).toContain("var_score[0] = 7;");
    expect(main).toContain("buffer oat2[128]: u8;");
    expect(main).not.toContain("buffer oat1[128]");
    expect(main).toContain("oat2[slot] = 5;");
    expect(main).toContain("alarm_title_hero_2 :: fn(slot: u16) {");
    expect(main).toContain("var_score[0] = var_score[0] + 1;");
    const etal =
      process.env.ETAL_BIN ?? "/home/grim/Documents/projects/uxn-dsl/build/linux-x86/etal";
    if (!existsSync(etal)) {
      console.warn("skip: no etal binary");
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "uxn-phaseb-"));
    for (const [name, content] of Object.entries(emitProject(p))) {
      writeFileSync(join(dir, name), content);
    }
    execFileSync(etal, ["-r", join(dir, "main.ux"), "-o", join(dir, "main.rom")], { stdio: "pipe" });
    expect(existsSync(join(dir, "main.rom"))).toBe(true);
  });

  it("emits new blocks inline and keeps old projects byte-identical", () => {
    const p = structuredClone(SAMPLE_PROJECT);
    p.scenes[0].nodes.find((o) => o.id === "wall")!.events = [
      {
        id: "ev_1",
        trigger: "step",
        blocks: [
          { op: "code", code: "ox[slot] = ox[slot];" },
          { op: "button", label: "jump", action: "play" },
        ],
      },
    ];
    expect(validateProject(p)).toEqual([]);
    const main = emitProject(p)["main.ux"];
    expect(main).toContain("tick_title_wall :: fn(slot: u16) {");
    expect(main).toContain("ox[slot] = ox[slot];");
    expect(main).toContain("( button 'jump' -> play )");
    // Old projects (no new ops) load through migration and emit
    // exactly what they always did.
    const before = emitProject(SAMPLE_PROJECT)["main.ux"];
    const migrated = migrateProject(structuredClone(SAMPLE_PROJECT) as unknown as Record<string, unknown>);
    expect(validateProject(migrated)).toEqual([]);
    expect(emitProject(migrated)["main.ux"]).toBe(before);
  });
});

describe("phase C: music, labels, scene stack", () => {
  const song = (p: Project): void => {
    p.songs = [
      {
        id: "theme",
        tracks: [
          { notes: [{ pitch: 48, len: 2 }, { pitch: 52, len: 1 }], vol: 200 },
          { notes: [{ pitch: 60, len: 4 }], vol: 128 },
          { notes: [], vol: 0 },
          { notes: [], vol: 0 },
        ],
      },
    ];
  };

  it("validates songs", () => {
    const p = structuredClone(SAMPLE_PROJECT);
    expect(validateProject(p)).toEqual([]);
    song(p);
    expect(validateProject(p)).toEqual([]);
    const bad = structuredClone(p) as Project & { songs: unknown[] };
    bad.songs = [
      { id: "theme", tracks: [{ notes: [], vol: 0 }, { notes: [], vol: 0 }, { notes: [], vol: 0 }] },
    ];
    expect(validateProject(bad).join()).toContain("exactly 4 tracks");
    bad.songs = [{ id: "theme", tracks: Array.from({ length: 4 }, () => ({ notes: [], vol: 0 })) }];
    expect(validateProject(bad).join()).toContain("has no notes");
    bad.songs = [
      {
        id: "theme",
        tracks: [{ notes: [{ pitch: 200, len: 1 }], vol: 1 }, ...Array.from({ length: 3 }, () => ({ notes: [], vol: 0 }))],
      },
    ];
    expect(validateProject(bad).join()).toContain("pitch must be 0–107");
    bad.songs = [
      {
        id: "theme",
        tracks: [{ notes: [{ pitch: 60, len: 1 }], vol: 999 }, ...Array.from({ length: 3 }, () => ({ notes: [], vol: 0 }))],
      },
    ];
    expect(validateProject(bad).join()).toContain("vol must be 0–255");
    bad.songs = [
      {
        id: "theme",
        tracks: [{ notes: Array.from({ length: 17 }, () => ({ pitch: 60, len: 1 })), vol: 1 }, ...Array.from({ length: 3 }, () => ({ notes: [], vol: 0 }))],
      },
    ];
    expect(validateProject(bad).join()).toContain("at most 16 steps");
  });

  it("lowers play_song/stop to the shared sequencer and ticks it once a frame", async () => {
    const p = structuredClone(SAMPLE_PROJECT);
    song(p);
    p.scenes[0].nodes.find((o) => o.id === "hero")!.events = [
      {
        id: "ev_1",
        trigger: "create",
        blocks: [
          { op: "song", song: "theme" },
          { op: "song_stop" },
          { op: "song", song: "theme" },
        ],
      },
    ];
    expect(validateProject(p)).toEqual([]);
    const main = emitProject(p)["main.ux"];
    expect(main).toContain("data sg_theme_v0p = [48, 52");
    expect(main).toContain("data sg_theme_v0l = [2, 1");
    expect(main).toContain("song_theme_start :: fn() {");
    expect(main).toContain("sg_len2 = 0;");
    expect(main).toContain("sg_len0: u8 = 0;");
    expect(main).toContain("sg_vol1 = 128;");
    expect(main).toContain("song_tick();");
    expect(main).toContain("if sg_on == 0 { return; }");
    // Only voices with audible notes get Audio devices and tick arms.
    expect(main).toContain("Audio0");
    expect(main).not.toContain("Audio2");
    // A song nobody plays costs nothing.
    const bare = structuredClone(SAMPLE_PROJECT);
    song(bare);
    expect(emitProject(bare)["main.ux"]).not.toContain("song_tick");
    // Empty tracks declare their length 0 in the start fn.
    const { previewBlocks, soundMap, snippetMap, songMap } = await import("./project");
    expect(
      previewBlocks([{ op: "song", song: "nope" }], {
        slot: "slot",
        w: 128,
        h: 128,
        sounds: soundMap(p),
        snippets: snippetMap(p),
        songs: songMap(p),
      }),
    ).toEqual(["( unknown song 'nope' )"]);
    expect(
      previewBlocks([{ op: "song", song: "theme" }], {
        slot: "slot",
        w: 128,
        h: 128,
        sounds: soundMap(p),
        snippets: snippetMap(p),
      }),
    ).toEqual(["( unknown song 'theme' )"]);
  });

  it("prerenders labels to glyph blobs and blits them over the art", async () => {
    const p = structuredClone(SAMPLE_PROJECT);
    const hero = p.scenes[0].nodes.find((o) => o.id === "hero")!;
    hero.label = "HI";
    expect(validateProject(p)).toEqual([]);
    const main = emitProject(p)["main.ux"];
    expect(main).toMatch(/data lbl_title_hero = \[0x66, 0x66, 0x66, 0x7e/);
    expect(main).toContain("Screen.addr = &lbl_title_hero + 0;");
    expect(main).toContain("Screen.addr = &lbl_title_hero + 8;");
    expect(main).toContain("Screen.sprite = 1;");
    expect(main).not.toContain("data font8x8");
    // Validation gates the label charset and length.
    const long = structuredClone(p);
    long.scenes[0].nodes.find((o) => o.id === "hero")!.label = "x".repeat(25);
    expect(validateProject(long).join()).toContain("1–24 printable ASCII");
    const uni = structuredClone(p);
    uni.scenes[0].nodes.find((o) => o.id === "hero")!.label = "caf\u00e9";
    expect(validateProject(uni).join()).toContain("1–24 printable ASCII");
  });

  it("pushes and pops the overlay stack around a fresh instance", async () => {
    const p = structuredClone(SAMPLE_PROJECT);
    p.scenes.push({ id: "menu", nodes: [], clicks: [], keys: [] });
    p.scenes[0].nodes.find((o) => o.id === "hero")!.events = [
      { id: "ev_1", trigger: "create", blocks: [{ op: "overlay", scene: "menu" }] },
      { id: "ev_2", trigger: "step", blocks: [{ op: "back" }] },
    ];
    expect(validateProject(p)).toEqual([]);
    const main = emitProject(p)["main.ux"];
    expect(main).toContain("buffer ovst[8]: u8;");
    expect(main).toContain("buffer ovsp[1]: u8;");
    expect(main).toContain("ovst[ovsp[0]] = scene;");
    expect(main).toContain("setup_menu();");
    expect(main).toContain("scene_go(SC_MENU);");
    expect(main).toContain("overlay_back :: fn() {");
    expect(main).toContain("setup_title();");
    // Projects without overlay/back blocks stay byte-identical.
    const bare = structuredClone(SAMPLE_PROJECT);
    expect(emitProject(bare)["main.ux"]).not.toContain("ovst");
    const { previewBlocks, soundMap, snippetMap, songMap } = await import("./project");
    const ctx = {
      slot: "slot",
      w: 128,
      h: 128,
      sounds: soundMap(p),
      snippets: snippetMap(p),
      songs: songMap(p),
    };
    expect(previewBlocks([{ op: "back" }], ctx)).toEqual(["overlay_back();"]);
    const bad = structuredClone(p);
    bad.scenes[0].nodes.find((o) => o.id === "hero")!.events = [
      { id: "ev_1", trigger: "create", blocks: [{ op: "overlay", scene: "ghost" }] },
    ];
    expect(validateProject(bad).join()).toContain("overlay unknown scene 'ghost'");
  });

  it("assembles music + labels + overlay with the real etal", async () => {
    const p = structuredClone(SAMPLE_PROJECT);
    song(p);
    p.scenes.push({ id: "menu", nodes: [], clicks: [], keys: [] });
    p.scenes[0].nodes.find((o) => o.id === "hero")!.label = "SCORE 0";
    p.scenes[0].nodes.find((o) => o.id === "hero")!.events = [
      { id: "ev_1", trigger: "create", blocks: [{ op: "song", song: "theme" }] },
      { id: "ev_2", trigger: "step", blocks: [{ op: "overlay", scene: "menu" }, { op: "back" }, { op: "song_stop" }] },
    ];
    expect(validateProject(p)).toEqual([]);
    const etal =
      process.env.ETAL_BIN ?? "/home/grim/Documents/projects/uxn-webpage/uxn-dsl/build/linux-x86/etal";
    if (!existsSync(etal)) {
      console.warn("skip: no etal binary");
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "uxn-phasec-"));
    for (const [name, content] of Object.entries(emitProject(p))) {
      writeFileSync(join(dir, name), content);
    }
    execFileSync(etal, ["-r", join(dir, "main.ux"), "-o", join(dir, "main.rom")], { stdio: "pipe" });
    expect(existsSync(join(dir, "main.rom"))).toBe(true);
  });
});
