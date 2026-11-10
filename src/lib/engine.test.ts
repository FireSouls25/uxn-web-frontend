import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SAMPLE_PROJECT, buildSceneMap, emitProject, flattenScene, migrateProject, validateProject, type Project } from "./project";
import { allEvents, eachBlock, previewEvent, renameRef, sceneFlow, templatesOf, usesRef } from "./engine";
import { platformerProject } from "./examples/platformer";
import { catcherProject } from "./examples/catcher";
import { lifeLabProject } from "./examples/lifelab";

const ROOT = join(__dirname, "../../../uxn-dsl");
const ETAL = process.env.ETAL_BIN ?? join(ROOT, "build/linux-x86/etal");
const HEADLESS = join(__dirname, "../../scripts/headless.cjs");
const haveVm = existsSync(ETAL) && existsSync(join(ROOT, "tests/pixels/harness.cjs"));

/** Assemble an emitted file set; null when no compiler is around. */
function build(p: Project): { rom: string; stderr: string } | null {
  if (!existsSync(ETAL)) return null;
  const dir = mkdtempSync(join(tmpdir(), "forge-"));
  for (const [name, content] of Object.entries(emitProject(p))) writeFileSync(join(dir, name), content);
  const r = spawnSync(ETAL, ["-r", join(dir, "main.ux"), "-o", join(dir, "out.rom")], { encoding: "utf8" });
  if (r.status !== 0 || !existsSync(join(dir, "out.rom"))) throw new Error(`etal failed:\n${r.stdout}\n${r.stderr}`);
  return { rom: join(dir, "out.rom"), stderr: `${r.stdout}\n${r.stderr}` };
}

type Step = [string, ...number[]] | [string, string];
/** Run a ROM headless; snaps are rows of palette indices. */
function run(rom: string, steps: Step[]): Record<string, string[]> {
  const out = execFileSync("node", [HEADLESS, ROOT, rom, JSON.stringify(steps)], { encoding: "utf8" });
  return (JSON.parse(out) as { snaps: Record<string, string[]> }).snaps;
}
/** Top-left of the first pixel of `color` inside a box (or null). */
function find(snap: string[], color: string, x0 = 0, y0 = 0, x1 = 9999, y1 = 9999): [number, number] | null {
  for (let y = y0; y < Math.min(y1, snap.length); y++) {
    const x = snap[y].slice(x0, x1).indexOf(color);
    if (x >= 0) return [x + x0, y];
  }
  return null;
}
const count = (snap: string[], color: string): number => snap.reduce((n, r) => n + [...r].filter((c) => c === color).length, 0);

describe("model + validation", () => {
  it("accepts the sample and lists its flow from events", () => {
    expect(validateProject(SAMPLE_PROJECT)).toEqual([]);
    const map = buildSceneMap(SAMPLE_PROJECT);
    const pairs = new Set(map.edges.map((e) => `${e.from}>${e.to}`));
    expect(pairs).toEqual(new Set(["title>play", "play>title"]));
    expect(sceneFlow(SAMPLE_PROJECT).some((e) => e.via === "hero" && e.trigger === "click")).toBe(true);
  });

  it("names bad references, misplaced actions and message loops", () => {
    const p = structuredClone(SAMPLE_PROJECT);
    p.vars = [{ id: "score", init: 0 }];
    p.scenes[0].events!.push(
      { id: "s1", trigger: "step", blocks: [{ op: "move", dx: 1, dy: 0 }] },
      { id: "s2", trigger: "message", message: "ping", blocks: [{ op: "send", message: "pong" }] },
      { id: "s3", trigger: "message", message: "pong", blocks: [{ op: "send", message: "ping" }] },
    );
    p.scenes[0].nodes[0].events!.push({
      id: "e9",
      trigger: "step",
      blocks: [
        { op: "set", name: "nope", mode: "set", value: 1 },
        { op: "set", name: "score", mode: "set", value: { k: "my", name: "hp", of: "other" } },
        { op: "if", cond: { k: "cmp", a: { k: "var", name: "score" }, op: "gt", b: { k: "call", fn: "missing", args: [] } }, then: [{ op: "play", sound: "nope" }] },
        { op: "goto", scene: "ghost" },
      ],
    });
    const errs = validateProject(p).join("\n");
    expect(errs).toContain("scene events can't move");
    expect(errs).toContain("message loop");
    expect(errs).toContain("unknown variable 'nope'");
    expect(errs).toContain("'other' only exists in collision events");
    expect(errs).toContain("no script function 'missing'");
    expect(errs).toContain("unknown sound 'nope'");
    expect(errs).toContain("unknown scene 'ghost'");
  });

  it("requires u16 parameters on functions blocks call", () => {
    const p = structuredClone(SAMPLE_PROJECT);
    p.scripts = [{ path: "util.ux", code: "half :: fn(n: u8) -> u16 {\n    return n / 2;\n}" }];
    p.scenes[0].events!.push({ id: "c", trigger: "step", blocks: [{ op: "call", fn: "half", args: [4] }] });
    expect(validateProject(p).join("\n")).toContain("parameter 'n' is u8");
  });

  it("renames and finds references deep inside values and conditions", () => {
    const p = structuredClone(SAMPLE_PROJECT);
    p.vars = [{ id: "score", init: 0 }];
    p.scenes[1].events!.push({ id: "x", trigger: "step", blocks: [{ op: "if", cond: { k: "not", c: { k: "cmp", a: { k: "math", op: "+", a: { k: "var", name: "score" }, b: 1 }, op: "gt", b: 3 } }, then: [{ op: "play", sound: "blip" }] }] });
    expect(usesRef(p, "var", "score")).toBe(true);
    const q = renameRef(p, "var", "score", "points");
    expect(usesRef(q, "var", "score")).toBe(false);
    expect(JSON.stringify(q.scenes[1].events)).toContain('"points"');
    expect(usesRef(renameRef(p, "sound", "blip", "beep"), "sound", "beep")).toBe(true);
  });
});

describe("converting older projects", () => {
  it("folds bindings, scripts, creation code, snippets and old conditions into events", () => {
    const legacy = {
      id: "old",
      kind: "visual",
      name: "Old",
      author: "me",
      width: 128,
      height: 128,
      start: "a",
      inputs: [{ id: "go", key: 32 }],
      sprites: [{ id: "s", pixels: Array(64).fill(1) }],
      anims: [],
      vars: [{ id: "n", init: 0 }],
      snippets: [{ id: "bump", code: "ox[slot] = ox[slot] + 1;" }],
      scenes: [
        {
          id: "a",
          nodes: [
            {
              id: "o",
              x: 0,
              y: 0,
              sprite: "s",
              kind: "static",
              tick: "oy[slot] = 3;",
              initCode: "ox[slot] = 9;",
              events: [
                {
                  id: "ev_1",
                  trigger: "step",
                  blocks: [
                    { op: "run", snippet: "bump" },
                    { op: "button", label: "x", action: "y" },
                    { op: "if", cond: { left: { kind: "var", name: "n" }, op: "lt", right: { kind: "const", value: 3 } }, then: [{ op: "set", name: "n", mode: "add", value: 1 }] },
                    { op: "if", cond: { left: { kind: "btn", dir: "up" }, op: "neq", right: { kind: "const", value: 0 } }, then: [] },
                  ],
                },
              ],
            },
          ],
          clicks: [{ object: "o", goto: "b" }],
          keys: [{ input: "go", key: 32, goto: "b" }],
          frameCode: "ocount = ocount;",
        },
        { id: "b", nodes: [], clicks: [], keys: [] },
      ],
      updatedAt: 0,
    };
    const p = migrateProject(legacy as unknown as Record<string, unknown>);
    expect(p).not.toHaveProperty("snippets");
    const a = p.scenes[0];
    expect(a).not.toHaveProperty("clicks");
    expect(a.events?.map((e) => e.trigger).sort()).toEqual(["key", "step"]);
    const o = a.nodes[0];
    expect(o).not.toHaveProperty("tick");
    expect(o.events?.map((e) => e.trigger).sort()).toEqual(["click", "create", "step"]);
    const step = o.events!.find((e) => e.trigger === "step")!;
    expect(step.blocks.map((b) => b.op)).toEqual(["code", "if", "if", "code"]);
    expect(JSON.stringify(step.blocks)).toContain("ox[self] = ox[self] + 1;");
    expect(step.blocks[1]).toMatchObject({ cond: { k: "cmp", a: { k: "var", name: "n" }, op: "lt", b: 3 } });
    expect(step.blocks[2]).toMatchObject({ cond: { k: "held", button: "up" } });
    expect(validateProject(p)).toEqual([]);
    // Converting again changes nothing.
    expect(migrateProject(structuredClone(p) as unknown as Record<string, unknown>)).toEqual(p);
  });
});

describe("engine runtime", () => {
  it("is deterministic and builds the sample warning-free", () => {
    expect(emitProject(SAMPLE_PROJECT)).toEqual(emitProject(structuredClone(SAMPLE_PROJECT)));
    const r = build(SAMPLE_PROJECT);
    if (r) expect(r.stderr).not.toMatch(/warning/i);
  });

  it.runIf(haveVm)("runs the sample: drive, click to play, escape back", () => {
    const r = build(SAMPLE_PROJECT)!;
    const s = run(r.rom, [
      ["frames", 2],
      ["snap", "a"],
      ["hold", 128],
      ["frames", 20],
      ["unhold", 128],
      ["frames", 2],
      ["snap", "b"],
      ["click", 40, 44],
      ["frames", 2],
      ["snap", "play"],
      ["key", 27],
      ["frames", 2],
      ["snap", "title"],
    ]);
    // hero (palette 1 block) moved 20px right; text drawn at the top.
    const heroA = find(s.a, "1", 0, 32);
    const heroB = find(s.b, "1", 0, 32);
    expect(heroB![0] - heroA![0]).toBe(20);
    expect(find(s.a, "1", 0, 8, 128, 16)).not.toBeNull();
    expect(find(s.play, "1", 0, 0)).toEqual([8, 8]);
    expect(find(s.title, "1", 0, 32)).toEqual([16, 40]);
  });

  it.runIf(haveVm)("runs every feature: spawn, variables, collisions, messages, timers, glide, text, overlay", () => {
    const block = Array(64).fill(1);
    const dot = Array(64).fill(0).map((_, i) => ((i >> 3) >= 2 && (i >> 3) <= 5 && (i & 7) >= 2 && (i & 7) <= 5 ? 2 : 0));
    const p: Project = {
      id: "sink",
      kind: "visual",
      name: "Sink",
      author: "t",
      width: 128,
      height: 128,
      start: "main",
      updatedAt: 0,
      theme: { r: 0x0f00, g: 0x0f80, b: 0x0f08 },
      inputs: [
        { id: "space", key: 32 },
        { id: "pause", key: 112 },
      ],
      sprites: [
        { id: "block", pixels: block },
        { id: "dot", pixels: dot },
      ],
      anims: [],
      vars: [
        { id: "score", init: 0 },
        { id: "i", init: 0 },
      ],
      sounds: [{ id: "blip", voices: [{ note: 72, vol: 100 }] }],
      scripts: [{ path: "util.ux", code: "double :: fn(n: u16) -> u16 {\n    return n * 2;\n}" }],
      objectDefs: [
        {
          id: "coin",
          sprite: "dot",
          kind: "static",
          blend: 5,
          vars: [{ id: "worth", init: 1 }],
          events: [
            { id: "c1", trigger: "collide", target: "player", blocks: [{ op: "set", name: "score", mode: "add", value: { k: "my", name: "worth" } }, { op: "play", sound: "blip" }, { op: "destroy" }] },
            { id: "c2", trigger: "message", message: "flash", blocks: [{ op: "look", blend: 15 }] },
          ],
        },
      ],
      scenes: [
        {
          id: "main",
          pool: 8,
          nodes: [
            { id: "hero", sprite: "block", x: 4, y: 40, kind: "player", controls: true },
            {
              id: "hud",
              x: 0,
              y: 0,
              label: "SCORE",
              events: [{ id: "h", trigger: "step", blocks: [{ op: "text", text: "SCORE ", value: { k: "call", fn: "double", args: [{ k: "var", name: "score" }] } }] }],
            },
            {
              id: "mover",
              sprite: "block",
              x: 100,
              y: 100,
              events: [{ id: "m", trigger: "alarm", blocks: [{ op: "glide", x: 100, y: 60, frames: 10 }] }],
            },
          ],
          events: [
            {
              id: "start",
              trigger: "create",
              blocks: [
                { op: "repeat", times: 3, index: "i", body: [{ op: "spawn", def: "coin", x: { k: "math", op: "+", a: 20, b: { k: "math", op: "*", a: { k: "var", name: "i" }, b: 16 } }, y: 40 }] },
                { op: "send", message: "arm" },
              ],
            },
            { id: "sp", trigger: "key", key: "space", blocks: [{ op: "send", message: "flash" }] },
            { id: "pz", trigger: "key", key: "pause", blocks: [{ op: "overlay", scene: "pause" }] },
          ],
        },
        {
          id: "pause",
          nodes: [{ id: "msg", x: 40, y: 64, label: "PAUSED" }],
          events: [{ id: "bk", trigger: "key", key: "pause", blocks: [{ op: "back" }] }],
        },
      ],
    };
    // mover's alarm is armed by a message from the scene start.
    p.scenes[0].nodes[2].events!.push({ id: "arm", trigger: "message", message: "arm", blocks: [{ op: "wait", ticks: 5 }] });
    expect(validateProject(p)).toEqual([]);
    const r = build(p)!;
    if (!r) return;
    expect(r.stderr).not.toMatch(/warning/i);
    const s = run(r.rom, [
      ["frames", 2],
      ["snap", "start"],
      ["hold", 128],
      ["frames", 40],
      ["unhold", 128],
      ["frames", 30],
      ["snap", "ate"],
      ["key", 32],
      ["frames", 1],
      ["snap", "flash"],
      ["key", 112],
      ["frames", 2],
      ["snap", "paused"],
      ["key", 112],
      ["frames", 2],
      ["snap", "resumed"],
    ]);
    // Three coins spawned 16px apart (dot = palette 2 under blend 5).
    expect(count(s.start, "2")).toBe(3 * 16);
    expect(find(s.start, "2", 0, 40)).toEqual([22, 42]);
    // The hero drove right through two coins: each worth 1, shown doubled.
    expect(count(s.ate, "2")).toBe(16);
    const hud = s.ate.slice(0, 8).join("");
    expect(hud).toContain("1");
    // Mover glided from y100 to y60 after its timer.
    expect(find(s.ate, "1", 96, 50, 128, 128)).toEqual([100, 60]);
    // Message recolored the remaining coin (blend 15: 2 → 1).
    expect(count(s.flash, "2")).toBe(0);
    // Overlay drew PAUSED over the frozen frame; back restored the scene.
    expect(count(s.paused, "1")).toBeGreaterThan(count(s.flash, "1"));
    expect(s.resumed.slice(10).join("")).toBe(s.flash.slice(10).join(""));
  });

  it("previews an event with the emitter's own lowering", () => {
    const ev = SAMPLE_PROJECT.scenes[0].nodes[0].events![0];
    expect(previewEvent(SAMPLE_PROJECT, ev)).toEqual(expect.arrayContaining(["e_sy[0] = SC_PLAY;", "e_sy[1] = 0;"]));
  });

  it("emits template handlers once, whatever the instance count", () => {
    const p = structuredClone(SAMPLE_PROJECT);
    p.objectDefs = [{ id: "w", sprite: "wall", kind: "static", events: [{ id: "e", trigger: "step", blocks: [{ op: "move", dx: 3, dy: 0 }] }] }];
    p.scenes[1].nodes.push(...Array.from({ length: 30 }, (_, i) => ({ id: `w${i}`, x: i * 4, y: 64, def: "w" })));
    const main = emitProject(p)["main.ux"];
    expect(main.match(/ox\[self\] = ox\[self\] \+ 3;/g)).toHaveLength(1);
    expect(templatesOf(p).filter((t) => t.def)).toHaveLength(1);
    expect(flattenScene(p, "play")).toHaveLength(31);
    expect(eachBlock(allEvents(p)).length).toBeGreaterThan(0);
  });

  it("keeps every generated file under the assembler's patience", () => {
    const files = emitProject(SAMPLE_PROJECT);
    expect(readFileSync).toBeDefined();
    expect(files["main.ux"].length).toBeLessThan(60_000);
  });
});

describe("chess, built in the engine model", () => {
  it("is valid: templates, scene events, messages and a rules script", async () => {
    const { chessProject } = await import("./examples");
    const p = chessProject();
    expect(p.loop ?? "engine").toBe("engine");
    expect(validateProject(p)).toEqual([]);
    const piece = p.objectDefs?.find((d) => d.id === "piece");
    expect(piece?.vars).toEqual([{ id: "sq", init: 0 }]);
    expect(piece?.events?.map((e) => e.trigger)).toEqual(["create", "step", "message", "message", "message"]);
    expect(p.scenes.map((s) => s.id)).toEqual(["menu", "side", "play", "pause", "over"]);
    expect(sceneFlow(p).some((e) => e.from === "play" && e.to === "pause" && e.kind === "overlay")).toBe(true);
  });

  it.runIf(haveVm)("plays: select, move, the computer replies, pause freezes and resumes", { timeout: 60_000 }, async () => {
    const { chessProject } = await import("./examples");
    const r = build(chessProject())!;
    expect(r.stderr).not.toMatch(/warning/i);
    const s = run(r.rom, [
      ["frames", 2],
      ["click", 90, 60], // PLAY
      ["frames", 2],
      ["click", 76, 55], // WHITE
      ["frames", 4],
      ["snap", "start"],
      ["click", 136, 104], // e2
      ["frames", 2],
      ["snap", "selected"],
      ["click", 136, 72], // e4
      ["frames", 60],
      ["snap", "replied"],
      ["key", 27],
      ["frames", 3],
      ["key", 27],
      ["frames", 3],
      ["snap", "resumed"],
    ]);
    const sq = (snap: string[], file: number, rank: number): string =>
      snap.slice((8 - rank) * 16, (9 - rank) * 16).map((row) => row.slice(64 + file * 16, 80 + file * 16)).join("");
    const empty = (snap: string[], file: number, rank: number): boolean => new Set(sq(snap, file, rank)).size === 1;
    // e2 holds a pawn, e4 is empty; selecting e2 drops dots on e3/e4.
    expect(empty(s.start, 4, 2)).toBe(false);
    expect(empty(s.start, 4, 4)).toBe(true);
    expect(empty(s.selected, 4, 4)).toBe(false);
    // The move happened and black answered: e2 empty, e4 taken, and
    // black's two home ranks no longer hold all 16 pieces.
    expect(empty(s.replied, 4, 2)).toBe(true);
    expect(empty(s.replied, 4, 4)).toBe(false);
    const blackHome = [7, 6].flatMap((rank) => [0, 1, 2, 3, 4, 5, 6, 7].map((f) => empty(s.replied, f, rank)));
    expect(blackHome.filter(Boolean).length).toBeGreaterThan(0);
    // Pause then resume: the frozen board comes back exactly.
    expect(s.resumed.slice(0, 120).map((r) => r.slice(64)).join("")).toBe(s.replied.slice(0, 120).map((r) => r.slice(64)).join(""));
  });
});

describe("platformer example: tiles, camera, movement", () => {
  it("validates, and names bad tile layers and cameras", () => {
    const p = platformerProject();
    expect(validateProject(p)).toEqual([]);
    const bad = structuredClone(p);
    const level = bad.scenes.find((s) => s.id === "level")!;
    level.tilemap!.tiles = level.tilemap!.tiles.slice(1);
    level.camera = { follow: "ghost" };
    bad.objectDefs![0].jump = 12;
    const errs = validateProject(bad).join("\n");
    expect(errs).toContain("tiles (cols × rows)");
    expect(errs).toContain("follows unknown template 'ghost'");
    expect(errs).toContain("jump must be 1–8");
  });

  it("only emits the movement/camera/tile runtime when a project uses it", () => {
    const main = emitProject(SAMPLE_PROJECT)["main.ux"];
    expect(main).not.toContain("e_phys");
    expect(main).not.toContain("e_tmap");
    const plat = emitProject(platformerProject())["main.ux"];
    expect(plat).toContain("e_draw_tiles :: fn()");
    expect(plat).toContain("e_camera :: fn()");
    expect(plat).toContain("e_phys_one :: fn()");
  });

  it.skipIf(!haveVm)("runs, scrolls with the hero and collects coins", () => {
    const b = build(platformerProject())!;
    expect(b.stderr).not.toMatch(/warning/i);
    const s = run(b.rom, [
      ["key", 32],
      ["frames", 10],
      ["snap", "start"],
      ["hold", 128],
      ["frames", 34],
      ["hold", 144],
      ["frames", 3],
      ["hold", 128],
      ["frames", 10],
      ["snap", "air"],
    ]);
    // The ground scrolled (the camera moved) while the HUD stayed put.
    expect(s.air.slice(168, 192).join("")).not.toBe(s.start.slice(168, 192).join(""));
    // HUD row: icon and "X" stay put, the number changes (coins picked up).
    const hud = (snap: string[], x0: number, x1: number) => snap.slice(6, 14).map((r) => r.slice(x0, x1)).join("");
    expect(hud(s.air, 0, 34)).toBe(hud(s.start, 0, 34));
    expect(hud(s.air, 34, 50)).not.toBe(hud(s.start, 34, 50));
  }, 30000);
});

describe("star catcher example", () => {
  it.skipIf(!haveVm)("validates, compiles clean and drops stars the basket can catch", () => {
    const p = catcherProject();
    expect(validateProject(p)).toEqual([]);
    const b = build(p)!;
    expect(b.stderr).not.toMatch(/warning/i);
    const s = run(b.rom, [["key", 32], ["frames", 5], ["snap", "start"], ["frames", 90], ["snap", "later"]]);
    // More yellow (stars are color 2) once the first drops fall.
    expect(count(s.later, "2")).toBeGreaterThan(count(s.start, "2"));
  });
});

describe("life lab example", () => {
  it.skipIf(!haveVm)("links pages, runs Life in the dish and stops on RUN/STOP", () => {
    const p = lifeLabProject();
    expect(validateProject(p)).toEqual([]);
    const b = build(p)!;
    expect(b.stderr).not.toMatch(/warning/i);
    // Dish interior: x 16..208, y 56..184. Live cells are coral (3).
    const dish = (snap: string[]) => snap.slice(56, 184).map((r) => r.slice(16, 208)).join("");
    const s = run(b.rom, [
      ["frames", 3],
      ["snap", "home"],
      ["click", 244, 14], // LAB link
      ["frames", 20],
      ["snap", "a"],
      ["frames", 12],
      ["snap", "b"],
      ["click", 240, 70], // STOP
      ["frames", 4],
      ["snap", "c"],
      ["frames", 16],
      ["snap", "d"],
    ]);
    expect(count(s.home.slice(56, 184), "3")).toBeLessThan(count(s.a.slice(56, 184), "3"));
    expect(count([dish(s.a)], "3")).toBeGreaterThan(50);
    // Running: the soup changes; stopped: it holds still.
    expect(dish(s.b)).not.toBe(dish(s.a));
    expect(dish(s.d)).toBe(dish(s.c));
  });
});
