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

  it("authors behavior through events and blocks", () => {
    expect(runTool("create_object_def", { name: "coin_obj", sprite: "coin" }).ok).toBe(true);
    const ev = runTool("add_event", { def: "coin_obj", trigger: "click" });
    expect(ev).toMatchObject({ ok: true, data: { id: "ev_1" } });
    expect(runTool("create_sound", { name: "sfx" }).ok).toBe(true);
    expect(runTool("set_sound_voice", { sound: "sfx", voice: 1, note: 72, vol: 100 }).ok).toBe(true);
    expect(runTool("set_sound_voice", { sound: "nope", voice: 0, note: 60, vol: 100 }).ok).toBe(false);
    expect(runTool("add_block", { def: "coin_obj", event: "ev_1", op: "play", sound: "sfx" }).ok).toBe(true);
    expect(runTool("add_block", { def: "coin_obj", event: "ev_1", op: "play", sound: "nope" }).ok).toBe(true);
    expect(runTool("validate", {})).toMatchObject({ ok: false });
    expect(runTool("delete_block", { def: "coin_obj", event: "ev_1", index: 1 }).ok).toBe(true);
    expect(runTool("add_block", { def: "coin_obj", event: "ev_1", op: "frobnicate" }).ok).toBe(false);
    expect(runTool("rename_sound", { from: "sfx", to: "ping" }).ok).toBe(true);
    expect(runTool("delete_sound", { sound: "ping" }).ok).toBe(false); // still referenced
    expect(runTool("create_sound", { name: "tmp" }).ok).toBe(true);
    expect(runTool("delete_sound", { sound: "tmp" }).ok).toBe(true);
    expect(runTool("validate", {})).toMatchObject({ ok: true });
    expect(runTool("place_instance", { def: "coin_obj", name: "bonus", x: 0, y: 0 }).ok).toBe(true);
    expect(runTool("add_event", { object: "coin", trigger: "collide", target: "def:coin_obj" }).ok).toBe(true);
    expect(runTool("add_block", { object: "coin", event: "ev_1", op: "destroy" }).ok).toBe(true);
    const preview = runTool("preview_event", { object: "coin", event: "ev_1" });
    expect(preview.ok).toBe(true);
    expect(preview.message as string).toContain("oflags[slot] = oflags[slot] & 247;");
    expect(runTool("validate", {})).toMatchObject({ ok: true });
    const emit = runTool("emit_files", {});
    const main = (emit.data as { files: Record<string, string> }).files["main.ux"];
    expect(main).toContain("collide_title_coin_0");
    expect(runTool("delete_block", { object: "coin", event: "ev_1", index: 0 }).ok).toBe(true);
    expect(runTool("delete_event", { object: "coin", event: "ev_1" }).ok).toBe(true);
    expect(runTool("preview_event", { object: "coin", event: "ev_1" }).ok).toBe(false);
  });

  it("authors shared behavior through object templates", () => {
    const def = runTool("create_object_def", { name: "crate", sprite: "wall", kind: "movable" });
    expect(def).toMatchObject({ ok: true, data: { id: "crate" } });
    expect(runTool("create_object_def", { name: "bad", sprite: "ghost" }).ok).toBe(false);
    const a = runTool("place_instance", { def: "crate", name: "box", x: 40, y: 40 });
    const b = runTool("place_instance", { def: "crate", name: "box2", x: 56, y: 40 });
    expect(a.ok && b.ok).toBe(true);
    expect(runTool("place_instance", { def: "nope" }).ok).toBe(false);
    expect(runTool("validate", {})).toMatchObject({ ok: true });
    // extract the inline hero into a template: same game, new structure
    expect(runTool("extract_object", { object: "coin" })).toMatchObject({ ok: true, data: { id: "coin" } });
    expect(runTool("validate", {})).toMatchObject({ ok: true });
    const snap = runTool("describe", {}).data as { defs: string[] };
    expect(snap.defs.sort()).toEqual(["coin", "crate"]);
  });
});
