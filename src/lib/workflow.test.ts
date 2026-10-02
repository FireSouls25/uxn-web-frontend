import { describe, expect, it } from "vitest";
import { artifactFilename } from "./export";
import {
  addDef,
  addInstance,
  clampToCanvas,
  deleteDef,
  extractObject,
  moveObject,
  patchDef,
  renameDef,
  renameObject,
  reorderObject,
} from "./store";
import { currentIdStore, defSelStore, projectsStore, sceneIdStore, selectionStore } from "./store";
import { SAMPLE_PROJECT, validateProject } from "./project";

describe("artifactFilename", () => {
  it("names every target/mode pair", () => {
    expect(artifactFilename("Forge Demo", "web", "bundle")).toBe("forge-demo.html");
    expect(artifactFilename("Forge Demo", "linux", "bundle")).toBe("forge-demo.linux");
    expect(artifactFilename("Forge Demo", "linux", "rom")).toBe("forge-demo.rom");
    expect(artifactFilename("Forge Demo", "web", "tal")).toBe("forge-demo.tal");
    expect(artifactFilename("!!!", "web", "bundle")).toBe("game.html");
  });
});

describe("clampToCanvas", () => {
  it("keeps the 8px sprite on-canvas", () => {
    expect(clampToCanvas(-5, 200, 128, 128)).toEqual([0, 120]);
    expect(clampToCanvas(10, 20, 128, 128)).toEqual([10, 20]);
  });
});

describe("moveObject", () => {
  it("moves one object and leaves the rest alone", () => {
    const next = moveObject(SAMPLE_PROJECT, "title", "hero", 200, 200);
    const hero = next.scenes.find((s) => s.id === "title")?.nodes.find((o) => o.id === "hero");
    const coin = next.scenes.find((s) => s.id === "title")?.nodes.find((o) => o.id === "coin");
    expect(hero).toMatchObject({ x: 120, y: 120 });
    expect(coin).toMatchObject({ x: 96, y: 96 });
    // Input untouched (immutable update).
    expect(SAMPLE_PROJECT.scenes[0].nodes[0]).toMatchObject({ x: 16, y: 40 });
  });
});

describe("hierarchy ops", () => {
  function reset() {
    projectsStore.set({ demo: structuredClone(SAMPLE_PROJECT) });
    currentIdStore.set("demo");
    sceneIdStore.set("title");
    selectionStore.set(null);
  }

  it("renames an object and its click bindings", () => {
    reset();
    selectionStore.set("hero");
    expect(renameObject("hero", "champ")).toBeNull();
    const s = projectsStore.get().demo.scenes[0];
    expect(s.nodes.some((o) => o.id === "champ")).toBe(true);
    expect(s.clicks).toEqual([{ object: "champ", goto: "play" }]);
    expect(selectionStore.get()).toBe("champ");
  });

  it("rejects bad and duplicate renames", () => {
    reset();
    expect(renameObject("hero", "9bad")).toBe("bad id");
    expect(renameObject("hero", "wall")).toBe("duplicate id");
    expect(projectsStore.get().demo.scenes[0].clicks).toEqual([{ object: "hero", goto: "play" }]);
  });

  it("reorders slots within a scene", () => {
    reset();
    reorderObject(0, 2);
    expect(projectsStore.get().demo.scenes[0].nodes.map((o) => o.id)).toEqual(["wall", "coin", "hero"]);
    reorderObject(9, 0);
    expect(projectsStore.get().demo.scenes[0].nodes.map((o) => o.id)).toEqual(["wall", "coin", "hero"]);
  });
});

describe("object templates", () => {
  function reset() {
    projectsStore.set({ demo: structuredClone(SAMPLE_PROJECT) });
    currentIdStore.set("demo");
    sceneIdStore.set("title");
    selectionStore.set(null);
    defSelStore.set(null);
  }

  it("stamps instances and selects the def for editing", () => {
    reset();
    const id = addDef("crate", "wall", "movable");
    expect(id).toBe("crate");
    expect(defSelStore.get()).toBe("crate");
    expect(addDef("crate")).not.toBe("crate"); // uniquified
    const inst = addInstance("crate", 40, 40, "box");
    expect(inst).toBe("box");
    const node = projectsStore.get().demo.scenes[0].nodes.find((o) => o.id === "box")!;
    expect(node).toMatchObject({ x: 40, y: 40, def: "crate" });
    expect(node.sprite).toBeUndefined();
    expect(addInstance("nope")).toBe("");
    expect(validateProject(projectsStore.get().demo)).toEqual([]);
  });

  it("renames defs across instances and refuses clashes", () => {
    reset();
    addDef("crate", "wall");
    addInstance("crate", 0, 0, "box");
    expect(renameDef("crate", "9bad")).toBe("bad id");
    addDef("other");
    expect(renameDef("crate", "other")).toBe("duplicate id");
    expect(renameDef("crate", "boxy")).toBeNull();
    const demo = projectsStore.get().demo;
    expect(demo.objectDefs?.map((d) => d.id)).toEqual(["boxy", "other"]);
    expect(demo.scenes[0].nodes.find((o) => o.id === "box")?.def).toBe("boxy");
  });

  it("extracts an inline leaf and deletes defs by baking", () => {
    reset();
    // wall is an inline static solid: extract keeps id/pos, moves the rest.
    expect(extractObject("wall")).toBe("wall");
    let demo = projectsStore.get().demo;
    expect(demo.objectDefs?.map((d) => d.id)).toEqual(["wall"]);
    expect(demo.scenes[0].nodes.find((o) => o.id === "wall")).toEqual({
      id: "wall",
      x: 64,
      y: 64,
      def: "wall",
    });
    expect(extractObject("wall")).toBeNull(); // already an instance
    expect(extractObject("missing")).toBeNull();
    expect(validateProject(demo)).toEqual([]);
    deleteDef("wall");
    demo = projectsStore.get().demo;
    expect(demo.objectDefs ?? []).toEqual([]);
    // baked back to the exact inline it was extracted from
    expect(demo.scenes[0].nodes.find((o) => o.id === "wall")).toMatchObject({
      sprite: "wall",
      kind: "static",
      solid: true,
    });
    expect(validateProject(demo)).toEqual([]);
  });

  it("patches defs with ref checks", () => {
    reset();
    addDef("crate", "wall");
    expect(patchDef("crate", { sprite: "ghost" })).toContain("unknown sprite");
    expect(patchDef("crate", { anim: "ghost" })).toContain("unknown animation");
    expect(patchDef("crate", { kind: "movable" })).toBeNull();
    expect(projectsStore.get().demo.objectDefs?.find((d) => d.id === "crate")).toMatchObject({
      kind: "movable",
      solid: true,
    });
  });
});
