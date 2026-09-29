import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SAMPLE_PROJECT,
  emitProject,
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
          objects: [
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
    expect(errs.length).toBeGreaterThanOrEqual(7);
  });

  it("allows zero players but never two", () => {
    const two = structuredClone(SAMPLE_PROJECT);
    two.scenes[0].objects.push({ id: "clone", x: 0, y: 0, sprite: "hero", kind: "player" });
    expect(validateProject(two).some((e) => e.includes("at most one player"))).toBe(true);
    const none = structuredClone(SAMPLE_PROJECT);
    none.scenes[0].objects = none.scenes[0].objects.filter((o) => o.kind !== "player");
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
    expect(p.scenes[0].objects[0]).toMatchObject({ sprite: "main_hero", x: 1, y: 2 });
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
    p.scenes[0].objects = [
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
});
