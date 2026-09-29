import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { SAMPLE_PROJECT } from "../project";
import { currentIdStore, projectStore, projectsStore, sceneIdStore, selectionStore } from "../store";
import { createStudioAgent } from "./pi";
import { TOOLS, runTool } from "./tools";

function reset() {
  projectsStore.set({ demo: structuredClone(SAMPLE_PROJECT) });
  currentIdStore.set("demo");
  sceneIdStore.set("title");
  selectionStore.set(null);
}

/* End-to-end shape of one agent turn, HTTP boundary stubbed: pi's loop
   asks the relay, the relay answers with a tool call, the tool runs
   against the open project, and the second turn closes with prose.
   This is the whole chain minus the network — if it breaks, the chat
   is broken even when the backend is perfect. */
describe("agent loop over the relay", () => {
  beforeEach(reset);
  afterEach(() => vi.unstubAllGlobals());

  it("runs a tool call and then answers", async () => {
    const seen: Array<{ messages: Array<{ role: string }> }> = [];
    let call = 0;
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      seen.push(JSON.parse(String(init?.body)) as { messages: Array<{ role: string }> });
      call += 1;
      const reply =
        call === 1
          ? {
              content: "",
              tool_calls: [
                { id: "t1", name: "create_sprite", arguments: '{"name":"knight","pixels":[]}' },
              ],
              usage: { in: 1, out: 1 },
            }
          : { content: "Knight sprite ready.", tool_calls: [], usage: { in: 2, out: 2 } };
      return new Response(JSON.stringify(reply), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const agent = createStudioAgent();
    await agent.prompt("make a knight sprite");

    expect(call).toBe(2);
    // The tool really ran against the open project.
    const ids = projectStore.get().sprites.map((s) => s.id);
    expect(ids).toContain("knight");
    // The second turn carried the tool result back to the relay.
    const roles = seen[1].messages.map((m) => m.role);
    expect(roles).toContain("assistant");
    expect(roles).toContain("tool");
  });

  it("sends the tool manifest so the model can call any of them", async () => {
    let sent: Array<{ name: string }> = [];
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { tools: Array<{ name: string }> };
      if (sent.length === 0) sent = body.tools;
      return new Response(JSON.stringify({ content: "ok", tool_calls: [], usage: { in: 1, out: 1 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    await createStudioAgent().prompt("hello");
    expect(sent.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
  });

  it("tolerates invented arguments instead of failing the call", async () => {
    let call = 0;
    vi.stubGlobal("fetch", async () => {
      call += 1;
      const reply =
        call === 1
          ? {
              content: "",
              // "w"/"h" are not create_sprite params; a model will
              // invent them anyway, and the call should still work.
              tool_calls: [
                { id: "t1", name: "create_sprite", arguments: '{"name":"knight","w":8,"h":8}' },
              ],
              usage: { in: 1, out: 1 },
            }
          : { content: "done", tool_calls: [], usage: { in: 1, out: 1 } };
      return new Response(JSON.stringify(reply), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const agent = createStudioAgent();
    const results: string[] = [];
    agent.subscribe((e) => {
      const ev = e as unknown as Record<string, unknown>;
      if (ev["type"] === "tool_execution_end") {
        results.push(String((ev["result"] as { content: Array<{ text: string }> }).content[0].text));
      }
    });
    await agent.prompt("a knight please");
    expect(results[0]).toMatch(/^ok:/);
    expect(projectStore.get().sprites.map((s) => s.id)).toContain("knight");
  });

  it("keeps the conversation across prompts", async () => {
    let call = 0;
    const sizes: number[] = [];
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: unknown[] };
      call += 1;
      sizes.push(body.messages.length);
      return new Response(
        JSON.stringify({ content: `reply ${call}`, tool_calls: [], usage: { in: 1, out: 1 } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const agent = createStudioAgent();
    await agent.prompt("first");
    await agent.prompt("second");
    expect(sizes[1]).toBeGreaterThan(sizes[0]);
  });

  it("a refused turn surfaces as an error event and changes nothing", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ detail: "no model available" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const agent = createStudioAgent();
    const errors: string[] = [];
    agent.subscribe((e) => {
      const ev = e as unknown as Record<string, unknown>;
      // The loop swallows the error event into the final message, so
      // this is the only place the UI can learn a turn failed.
      if (ev["type"] === "message_end") {
        const message = ev["message"] as { stopReason?: string; errorMessage?: string };
        if (message.stopReason === "error") errors.push(String(message.errorMessage));
      }
    });
    // prompt() resolves: an error event ends the turn, it does not throw.
    await agent.prompt("do something");
    expect(errors).toEqual(["turn:503"]);
    expect(runTool("describe", {}).ok).toBe(true);
  });
});
