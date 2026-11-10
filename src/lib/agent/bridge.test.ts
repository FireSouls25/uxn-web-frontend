import { beforeEach, describe, expect, it } from "vitest";
import { SAMPLE_PROJECT } from "../project";
import { currentIdStore, projectStore, projectsStore, sceneIdStore } from "../store";
import { bridgeWsUrl, claudeCommand, manifest, mcpJson, runBridgeCall } from "./bridge";
import { TOOLS } from "./tools";

describe("agent bridge (studio side)", () => {
  beforeEach(() => {
    projectsStore.set({ demo: structuredClone(SAMPLE_PROJECT) });
    currentIdStore.set("demo");
    sceneIdStore.set("title");
  });

  it("announces every studio tool plus project_context", () => {
    const names = manifest().map((t) => t.name);
    expect(names[0]).toBe("project_context");
    expect(names).toEqual(expect.arrayContaining(TOOLS.map((t) => t.name)));
    expect(names).toContain("draw_sprite");
    // JSON-safe: run functions never travel.
    expect(JSON.parse(JSON.stringify(manifest()))).toEqual(manifest());
  });

  it("runs relayed calls on the open project", async () => {
    const ctx = await runBridgeCall("project_context", {});
    expect(ctx.ok).toBe(true);
    expect(ctx.message).toContain(SAMPLE_PROJECT.name);
    const r = await runBridgeCall("draw_sprite", { name: "gem", w: 1, h: 1, ops: [{ op: "disc", cx: 4, cy: 4, r: 3, c: 2 }, { op: "outline", c: 1 }] });
    expect(r.ok).toBe(true);
    expect(projectStore.get().sprites.some((s) => s.id === "gem")).toBe(true);
    expect((await runBridgeCall("no_such_tool", {})).ok).toBe(false);
  });

  it("builds the socket URL and client configs", () => {
    expect(bridgeWsUrl("https://api.example.com", "uxf_abc")).toBe("wss://api.example.com/ws/bridge?key=uxf_abc");
    expect(bridgeWsUrl("http://localhost:8000", "k")).toBe("ws://localhost:8000/ws/bridge?key=k");
    expect(claudeCommand("https://api.example.com/mcp", "uxf_abc")).toBe('claude mcp add --transport http uxn-forge https://api.example.com/mcp --header "Authorization: Bearer uxf_abc"');
    expect(JSON.parse(mcpJson("u", "k")).mcpServers["uxn-forge"]).toEqual({ type: "http", url: "u", headers: { Authorization: "Bearer k" } });
  });
});
