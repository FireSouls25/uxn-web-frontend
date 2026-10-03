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
    const { previewBlocks, soundMap } = await import("./project");
    const p = evProject();
    const ctx = { slot: "slot", w: 128, h: 128, sounds: soundMap(p) };
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
