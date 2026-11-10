import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chessProject } from "../examples";
import { currentIdStore, projectStore, projectsStore, sceneIdStore, selectionStore } from "../store";
import { buildPrompt } from "./rag";
import { SYSTEM_PROMPT } from "./pi";
import { projectContext, runTool, runToolAsync, scriptSignatures } from "./tools";

function openChess() {
  const p = chessProject();
  projectsStore.set({ [p.id]: p });
  currentIdStore.set(p.id);
  sceneIdStore.set("play");
  selectionStore.set(null);
}

describe("agent context", () => {
  beforeEach(openChess);
  afterEach(() => vi.unstubAllGlobals());

  it("summarizes the open project with real ids", () => {
    const ctx = projectContext();
    expect(ctx).toContain('Project "Chess"');
    expect(ctx).toContain("READ-ONLY");
    expect(ctx).toMatch(/- play pool 28/);
    expect(ctx).toMatch(/piece: sprite pieces.*vars sq=0/);
    expect(ctx).toContain("layout_sq(x: u16, y: u16) -> u16");
    expect(ctx).toContain("Game variables: side=0");
    expect(ctx.length).toBeLessThan(6200);
  });

  it("puts the project in front of every request", () => {
    const prompt = buildPrompt("make the dots red");
    expect(prompt.startsWith("Current project:\n")).toBe(true);
    expect(prompt.endsWith("User request: make the dots red")).toBe(true);
  });

  it("reads scripts, generated files and library modules with line numbers", () => {
    const r = runTool("read_file", { path: "chess.ux", from: 27, to: 30 });
    expect(r.ok).toBe(true);
    expect((r.data as { text: string }).text).toContain("  27  to8 :: fn(v: u16) -> u8 {");
    expect(runTool("read_file", { path: "main.ux" }).ok).toBe(true);
    expect(runTool("read_file", { path: "lib/fix16.ux" }).ok).toBe(true);
    expect(runTool("read_file", { path: "nope.ux" }).ok).toBe(false);
  });

  it("parses fn signatures", () => {
    expect(scriptSignatures("a :: fn() {\n}\nb :: fn(x: u16,\n y: u8) -> u16 {\n")).toEqual(["a()", "b(x: u16, y: u8) -> u16"]);
  });

  it("check_build reports compiler diagnostics by file and line", async () => {
    const p = structuredClone(projectStore.get());
    p.locked = false;
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
    projectsStore.set({ [p.id]: p });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ status: "error", message: "Compilation failed.", diagnostics: [{ file: "/tmp/x/chess.ux", line: 12, col: 3, msg: "unknown identifier `foo`" }], artifacts: {} }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const r = await runToolAsync("check_build", {});
    expect(r.ok).toBe(false);
    expect(r.message).toContain("chess.ux:12 unknown identifier");
    expect((r.data as { diagnostics: Array<{ file: string }> }).diagnostics[0].file).toBe("chess.ux");
  });

  it("system prompt carries the engine model, ETAL rules and the check loop", () => {
    expect(SYSTEM_PROMPT).toContain("The engine model");
    expect(SYSTEM_PROMPT).toContain("No implicit narrowing");
    expect(SYSTEM_PROMPT).toContain("check_build");
  });
});
