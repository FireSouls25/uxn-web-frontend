import { beforeEach, describe, expect, it } from "vitest";
import { SAMPLE_PROJECT } from "../project";
import {
  currentIdStore,
  projectStore,
  projectsStore,
  sceneIdStore,
  selectionStore,
} from "../store";
import { TOOLS, runTool } from "./tools";

function reset() {
  projectsStore.set({ demo: structuredClone(SAMPLE_PROJECT) });
  currentIdStore.set("demo");
  sceneIdStore.set("title");
  selectionStore.set(null);
}

describe("agent tools", () => {
  beforeEach(reset);

  it("exposes a documented manifest", () => {
    expect(TOOLS.length).toBeGreaterThan(10);
    for (const t of TOOLS) {
      expect(t.description.length).toBeGreaterThan(20);
    }
    expect(runTool("nope", {}).ok).toBe(false);
  });

  it("builds a scene with full controls in code", () => {
    expect(runTool("create_scene", {}).data).toMatchObject({ id: "scene" });
    expect(runTool("create_sprite", { name: "ship", pixels: Array(64).fill(2) }).ok).toBe(true);
    const put = runTool("put_on_scene", { sprite: "ship", kind: "player", x: 10, y: 10, name: "hero" });
    expect(put.ok).toBe(true);
    expect(runTool("script_object", { object: "hero", code: "ox[slot] = ox[slot];" }).ok).toBe(true);
    expect(runTool("script_scene", { code: "tick = tick + 1;" }).ok).toBe(true);
    expect(runTool("add_transition", { event: "key", key: 32, goto: "title" }).ok).toBe(true);
    expect(runTool("set_sound", { voice: 0, note: 72, vol: 120 }).ok).toBe(true);
    expect(runTool("set_theme", { r: 0, g: 0, b: 0 }).ok).toBe(true);
    const v = runTool("validate", {});
    expect(v).toMatchObject({ ok: true });
    const emit = runTool("emit_files", {});
    expect(emit.ok).toBe(true);
    const files = (emit.data as { files: Record<string, string> }).files;
    expect(files["main.ux"]).toContain("tick_scene_hero");
  });

  it("nests scenes and refuses cycles", () => {
    runTool("create_scene", {}); // id "scene"
    expect(runTool("nest_scene", { scene: "title", into: "scene", name: "sub" }).ok).toBe(true);
    // Moving the branch back into its own subtree would cycle: refused.
    const cyc = runTool("move_node", { from_scene: "scene", from_index: 0, to_scene: "title" });
    expect(cyc.ok).toBe(false);
    // ...while a leaf move is fine.
    runTool("put_on_scene", { sprite: "hero", scene: "scene", name: "box" });
    const leaf = runTool("move_node", { from_scene: "scene", from_index: 1, to_scene: "title" });
    expect(leaf.ok).toBe(true);
  });

  it("rejects bad references with messages", () => {
    expect(runTool("put_on_scene", { sprite: "ghost" }).ok).toBe(false);
    expect(runTool("add_transition", { event: "click", object: "x", goto: "nowhere" }).ok).toBe(false);
    // click target missing but goto valid: binding added, validation catches
    runTool("add_transition", { event: "click", object: "nope", goto: "title" });
    expect(runTool("validate", {}).ok).toBe(false);
  });

  it("describe snapshots the project", () => {
    const d = runTool("describe", {});
    expect(d.data).toMatchObject({ project: "demo", scene: "title" });
  });

  it("creates multi-tile sprites and places them", () => {
    expect(runTool("create_sprite", { name: "wide", w: 2, h: 1 }).ok).toBe(true);
    const put = runTool("put_on_scene", { sprite: "wide", name: "banner", x: 0, y: 0 });
    expect(put.ok).toBe(true);
    expect(runTool("validate", {})).toMatchObject({ ok: true });
    const emit = runTool("emit_files", {});
    const main = (emit.data as { files: Record<string, string> }).files["main.ux"];
    expect(main).toContain("Screen.addr = ot[");
  });
});
