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

  it("builds a scene with full controls through tools", () => {
    expect(runTool("create_scene", {}).data).toMatchObject({ id: "scene" });
    expect(runTool("create_sprite", { name: "ship", pixels: Array(64).fill(2) }).ok).toBe(true);
    expect(runTool("put_on_scene", { sprite: "ship", kind: "player", x: 10, y: 10, name: "hero" }).ok).toBe(true);
    expect(runTool("add_transition", { event: "key", code: 32, goto: "title" }).ok).toBe(true);
    expect(runTool("set_sound", { voice: 0, note: 72, vol: 120 }).ok).toBe(true);
    expect(runTool("set_theme", { r: 0, g: 0, b: 0 }).ok).toBe(true);
    expect(runTool("validate", {})).toMatchObject({ ok: true });
    const files = (runTool("emit_files", {}).data as { files: Record<string, string> }).files;
    expect(files["main.ux"]).toContain("setup_scene :: fn()");
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
    expect(runTool("add_transition", { event: "click", object: "nope", goto: "title" }).ok).toBe(false);
    const ev = runTool("add_event", { object: "hero", trigger: "step" }).data as { id: string };
    runTool("add_action", { object: "hero", event: ev.id, action: JSON.stringify({ op: "goto", scene: "nowhere" }) });
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

  it("authors behaviour through events and JSON actions", () => {
    expect(runTool("create_object_def", { name: "coin_obj", sprite: "coin" }).ok).toBe(true);
    expect(runTool("add_event", { def: "coin_obj", trigger: "click" })).toMatchObject({ ok: true, data: { id: "ev_1" } });
    expect(runTool("create_sound", { name: "sfx" }).ok).toBe(true);
    expect(runTool("set_sound_voice", { sound: "sfx", voice: 1, note: 72, vol: 100 }).ok).toBe(true);
    const add = (action: unknown, extra: Record<string, unknown> = {}) => runTool("add_action", { def: "coin_obj", event: "ev_1", action: JSON.stringify(action), ...extra });
    expect(add({ op: "play", sound: "sfx" }).ok).toBe(true);
    expect(add({ op: "play", sound: "nope" }).ok).toBe(true);
    expect(runTool("validate", {}).ok).toBe(false);
    expect(runTool("delete_action", { def: "coin_obj", event: "ev_1", index: 1 }).ok).toBe(true);
    expect(add({ op: "frobnicate" }).ok).toBe(false);
    expect(runTool("add_action", { def: "coin_obj", event: "ev_1", action: "{not json" }).ok).toBe(false);
    expect(runTool("rename_sound", { from: "sfx", to: "ping" }).ok).toBe(true);
    expect(runTool("delete_sound", { sound: "ping" }).ok).toBe(false); // still played
    // Values, conditions and nested bodies.
    expect(runTool("add_variable", { name: "score" }).ok).toBe(true);
    expect(add({ op: "set", name: "score", mode: "add", value: { k: "math", op: "+", a: 1, b: { k: "random", max: 3 } } }).ok).toBe(true);
    expect(add({ op: "if", cond: { k: "all", of: [{ k: "cmp", a: { k: "var", name: "score" }, op: "gte", b: 10 }, { k: "mouse_down" }] }, then: [] }).ok).toBe(true);
    expect(add({ op: "goto", scene: "play" }, { path: "2.then" }).ok).toBe(true);
    expect(add({ op: "hide" }, { path: "bogus" }).ok).toBe(false);
    expect(runTool("validate", {})).toMatchObject({ ok: true });
    const preview = runTool("preview_event", { def: "coin_obj", event: "ev_1" });
    expect(preview.message as string).toContain("var_score[0] = var_score[0] + (1 + e_rnd(3));");
    expect(preview.message as string).toContain("e_sy[0] = SC_PLAY;");
    // Template variables + collisions with "other".
    expect(runTool("add_template_var", { def: "coin_obj", name: "worth", init: 5 }).ok).toBe(true);
    expect(runTool("add_event", { def: "coin_obj", trigger: "collide", target: "player" }).ok).toBe(true);
    expect(runTool("add_action", { def: "coin_obj", event: "ev_2", action: JSON.stringify({ op: "set", name: "score", mode: "add", value: { k: "my", name: "worth" } }) }).ok).toBe(true);
    expect(runTool("add_action", { def: "coin_obj", event: "ev_2", action: JSON.stringify({ op: "destroy" }) }).ok).toBe(true);
    expect(runTool("validate", {})).toMatchObject({ ok: true });
    expect(runTool("delete_event", { def: "coin_obj", event: "ev_2" }).ok).toBe(true);
    expect(runTool("preview_event", { def: "coin_obj", event: "ev_2" }).ok).toBe(false);
  });

  it("puts level rules on the scene itself", () => {
    expect(runTool("add_event", { scene: "title", trigger: "collide" }).ok).toBe(false);
    const ev = runTool("add_event", { scene: "title", trigger: "message", message: "boom" });
    expect(ev.ok).toBe(true);
    const id = (ev.data as { id: string }).id;
    expect(runTool("add_action", { scene: "title", event: id, action: JSON.stringify({ op: "move", dx: 1, dy: 0 }) }).ok).toBe(true);
    expect(runTool("validate", {}).message).toContain("scene events can't move");
    expect(runTool("delete_action", { scene: "title", event: id, index: 0 }).ok).toBe(true);
    expect(runTool("add_action", { scene: "title", event: id, action: JSON.stringify({ op: "overlay", scene: "play" }) }).ok).toBe(true);
    expect(runTool("add_transition", { event: "key", code: 13, goto: "play" }).ok).toBe(true);
    expect(runTool("validate", {})).toMatchObject({ ok: true });
  });

  it("sets sheet cells and node looks through tools", () => {
    // hero is a 1×1 sprite: a 1×1 grid is the whole sprite (no sheet).
    expect(runTool("set_sheet", { sprite: "hero", cell_w: 2, cell_h: 1 }).ok).toBe(false);
    expect(runTool("set_look", { object: "hero", flip_x: true, blend: 5 }).ok).toBe(true);
    expect(runTool("set_look", { object: "hero", blend: 16 }).ok).toBe(false);
    expect(runTool("set_look", { object: "ghost", blend: 5 }).ok).toBe(false);
    expect(runTool("validate", {})).toMatchObject({ ok: true });
    const main = ((runTool("emit_files", {}).data as { files: Record<string, string> }).files["main.ux"]) ?? "";
    expect(main).toContain(`data e_rows = [`);
    expect(main).toContain(`${0x80 | 0x10 | 5}, 57`);
    expect(runTool("set_look", { object: "hero", flip_x: false, blend: 1 }).ok).toBe(true);
  });

  it("authors labels on leaves through tools", () => {
    expect(runTool("set_label", { object: "hero", text: "HI" }).ok).toBe(true);
    expect(runTool("set_label", { object: "ghost", text: "HI" }).ok).toBe(false);
    expect(runTool("set_label", { text: "HI" }).ok).toBe(false);
    expect(runTool("set_label", { object: "hero", text: "x".repeat(40) }).ok).toBe(true); // truncated to 24
    expect(runTool("validate", {})).toMatchObject({ ok: true });
    expect(runTool("set_label", { object: "hero" }).ok).toBe(true); // cleared
    expect(runTool("validate", {})).toMatchObject({ ok: true });
  });

  it("tunes animations", () => {
    expect(runTool("add_anim_frame", { anim: "spin", sprite: "hero" }).ok).toBe(true);
    expect(runTool("add_anim_frame", { anim: "spin", sprite: "ghost" }).ok).toBe(false);
    expect(runTool("set_anim", { anim: "spin", rate: 12, pingpong: true }).ok).toBe(true);
    expect(runTool("set_anim", { anim: "nope", rate: 12 }).ok).toBe(false);
    expect(runTool("validate", {})).toMatchObject({ ok: true });
    const main = (runTool("emit_files", {}).data as { files: Record<string, string> }).files["main.ux"];
    expect(main).toContain("anim_tick :: fn()");
  });

  it("sets hitboxes from either side", () => {
    expect(runTool("set_mask", { object: "hero", x: 2, y: 2, w: 4, h: 4 }).ok).toBe(true);
    expect(runTool("set_mask", { object: "hero", x: 6, y: 0, w: 4, h: 8 }).ok).toBe(true);
    expect(runTool("validate", {})).toMatchObject({ ok: false });
    expect(runTool("set_mask", { object: "hero" }).ok).toBe(true);
    expect(runTool("set_mask", { object: "nope", x: 0, y: 0, w: 1, h: 1 }).ok).toBe(false);
    expect(runTool("set_mask", { x: 0, y: 0, w: 1, h: 1 }).ok).toBe(false);
    expect(runTool("validate", {})).toMatchObject({ ok: true });
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

  it("maps space: rects, solidity, free spots", () => {
    const map = runTool("scene_map", {});
    expect(map.ok).toBe(true);
    const data = map.data as { width: number; height: number; objects: Array<{ path: string; x: number; y: number; w: number; h: number; kind: string; solid: boolean; sprite: string }> };
    expect(data.width).toBe(128);
    expect(data.objects.length).toBeGreaterThan(0);
    for (const o of data.objects) {
      expect(o.w).toBeGreaterThan(0);
      expect(typeof o.solid).toBe("boolean");
    }
    // A solid crate blocks its own rect but not the empty corner.
    runTool("create_object_def", { name: "crate", sprite: "wall", kind: "movable" });
    runTool("place_instance", { def: "crate", name: "box", x: 0, y: 0 });
    const blocked = runTool("check_space", { x: 0, y: 0, w: 8, h: 8 });
    expect(blocked.data).toMatchObject({ inside: true, fits: false });
    expect((blocked.data as { solid: string[] }).solid).toContain("box");
    const free = runTool("find_space", { w: 8, h: 8 });
    expect(free.ok).toBe(true);
    const spot = (free.data as { x: number; y: number });
    const recheck = runTool("check_space", { x: spot.x, y: spot.y, w: 8, h: 8 });
    expect(recheck.data).toMatchObject({ inside: true, fits: true });
    // Outside the canvas never fits; unknown scenes fail cleanly.
    expect(runTool("check_space", { x: 200, y: 200 }).data).toMatchObject({ inside: false, fits: false });
    expect(runTool("scene_map", { scene: "nowhere" }).ok).toBe(false);
    expect(runTool("find_space", { w: 999, h: 999 }).ok).toBe(false);
  });

  it("scripts a whole game on the script loop", () => {
    expect(runTool("set_loop", { mode: "bogus" }).ok).toBe(false);
    expect(runTool("set_loop", { mode: "script" }).ok).toBe(true);
    // An existing custom.ux is kept; give it the frame hook explicitly.
    expect(runTool("set_custom_code", { code: "custom_frame :: fn() {\n    hud_tick();\n}" }).message).toContain("custom_frame");
    const made = runTool("write_script", {
      path: "hud.ux",
      code: `import "screen.ux"\nhud_tick :: fn() {\n    clear(128);\n    blit(4, 4, &spr_hero, 129);\n}`,
    });
    expect(made.ok).toBe(true);
    expect(runTool("write_script", { path: "hud.ux", code: `import "screen.ux"\nhud_tick :: fn() {\n    clear(129);\n}` }).message).toContain("updated");
    expect(runTool("validate", {}).ok).toBe(true);
    const snap = runTool("describe", {}).data as { loop: string; scripts: string[]; hooks: string[] };
    expect(snap).toMatchObject({ loop: "script", scripts: ["hud.ux"], hooks: ["custom_frame"] });
    const lib = runTool("list_library", { module: "screen" });
    expect((lib.data as { exports: Array<{ sig: string }> }).exports.map((x) => x.sig)).toContain("blit(x, y, tile, mode)");
    expect(runTool("list_library", { module: "nope" }).ok).toBe(false);
    expect(projectStore.get().loop).toBe("script");
    // Refused while imported; fine once nothing imports it.
    runTool("write_script", { path: "util.ux", code: "util_x :: fn() { }" });
    runTool("write_script", { path: "hud.ux", code: `import "util.ux"\nhud_tick :: fn() {\n    util_x();\n}` });
    expect(runTool("delete_script", { path: "util.ux" }).ok).toBe(false);
    runTool("write_script", { path: "hud.ux", code: "hud_tick :: fn() { }" });
    expect(runTool("delete_script", { path: "util.ux" }).ok).toBe(true);
  });

  it("builds a scrolling level: tile layer, movement, camera, hud", () => {
    const tiles = Array.from({ length: 2 * 64 }, (_, i) => (i < 64 ? 2 : 1));
    expect(runTool("create_sprite", { name: "ground", pixels: tiles, w: 2, h: 1 }).ok).toBe(true);
    expect(runTool("set_sheet", { sprite: "ground", cell_w: 1, cell_h: 1 }).ok).toBe(true);
    const rows = ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG"].join("\n");
    expect(runTool("set_tilemap", { scene: "play", sprite: "ground", rows, legend: '{"G":0}', solid: [0] })).toMatchObject({ ok: true });
    expect(runTool("create_object_def", { name: "runner", sprite: "hero" }).ok).toBe(true);
    expect(runTool("set_movement", { def: "runner", movement: "platformer", jump: 4 })).toMatchObject({ ok: true });
    expect(runTool("set_movement", { def: "runner", movement: "fly" }).ok).toBe(false);
    expect(runTool("place_instance", { def: "runner", scene: "play", x: 8, y: 16 }).ok).toBe(true);
    expect(runTool("set_camera", { scene: "play", follow: "runner" })).toMatchObject({ ok: true });
    expect(runTool("validate", {})).toMatchObject({ ok: true });
    const main = (runTool("emit_files", {}).data as { files: Record<string, string> }).files["main.ux"];
    expect(main).toContain("e_camera();");
    expect(runTool("set_tilemap", { scene: "play", sprite: "ground", rows: "GG", legend: '{"G":5}' }).ok).toBe(false);
  });

  it("draws art with shapes, tile sheets and headline type", () => {
    const r = runTool("draw_sprite", {
      name: "orb",
      w: 2,
      h: 2,
      ops: [
        { op: "disc", cx: 8, cy: 8, r: 6, c: 3 },
        { op: "dither", from: 3, to: 2, x: 8, y: 8 },
        { op: "pixel", x: 5, y: 5, c: 0 },
        { op: "outline", c: 1 },
      ],
    });
    expect(r).toMatchObject({ ok: true, data: { id: "orb" } });
    const orb = projectStore.get().sprites.find((x) => x.id === "orb")!;
    const at = (x: number, y: number) => orb.pixels[(Math.floor(x / 8) + Math.floor(y / 8) * 2) * 64 + (y % 8) * 8 + (x % 8)];
    expect(at(8, 8)).toBe(2); // dithered shade
    expect(at(5, 5)).toBe(0); // the shine survives the outline
    expect(at(8, 1)).toBe(1); // ink rim
    // Redrawing the same size keeps the id.
    expect(runTool("draw_sprite", { name: "orb", w: 2, h: 2, ops: [{ op: "rect", x: 0, y: 0, w: 4, h: 4, c: 1 }] }).data).toMatchObject({ id: "orb" });
    expect(runTool("draw_sprite", { name: "bad", ops: [{ op: "spray" }] }).ok).toBe(false);

    const cell = ["11111111", "10000001", "10000001", "10000001", "10000001", "10000001", "10000001", "11111111"];
    expect(runTool("create_tile_sheet", { name: "ui", cells: [cell, cell.map((x) => x.replace(/0/g, "2"))] })).toMatchObject({ ok: true });
    expect(projectStore.get().sprites.find((x) => x.id === "ui")?.cell).toEqual({ w: 1, h: 1 });
    expect(runTool("create_tile_sheet", { name: "ui2", cells: [["0123"]] }).ok).toBe(false);

    const h = runTool("headline", { name: "logo", text: "Hi there", scene: "title", x: 0, y: 20 });
    expect(h).toMatchObject({ ok: true });
    expect((h.data as { ids: string[] }).ids).toHaveLength(4);
    const nodes = projectStore.get().scenes.find((x) => x.id === "title")!.nodes.filter((n) => n.id.startsWith("logo"));
    expect(nodes.map((n) => n.x)).toEqual([0, 32, 64, 96]);
    expect(nodes.every((n) => n.blend === 5)).toBe(true);
    expect(runTool("validate", {})).toMatchObject({ ok: true });
  });
});
