import { describe, expect, it } from "vitest";
import { artifactFilename } from "./export";
import { clampToCanvas, moveObject, renameObject, reorderObject } from "./store";
import { currentIdStore, projectsStore, sceneIdStore, selectionStore } from "./store";
import { SAMPLE_PROJECT } from "./project";

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
    const hero = next.scenes.find((s) => s.id === "title")?.objects.find((o) => o.id === "hero");
    const coin = next.scenes.find((s) => s.id === "title")?.objects.find((o) => o.id === "coin");
    expect(hero).toMatchObject({ x: 120, y: 120 });
    expect(coin).toMatchObject({ x: 96, y: 96 });
    // Input untouched (immutable update).
    expect(SAMPLE_PROJECT.scenes[0].objects[0]).toMatchObject({ x: 16, y: 40 });
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
    expect(s.objects.some((o) => o.id === "champ")).toBe(true);
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
    expect(projectsStore.get().demo.scenes[0].objects.map((o) => o.id)).toEqual(["wall", "coin", "hero"]);
    reorderObject(9, 0);
    expect(projectsStore.get().demo.scenes[0].objects.map((o) => o.id)).toEqual(["wall", "coin", "hero"]);
  });
});
