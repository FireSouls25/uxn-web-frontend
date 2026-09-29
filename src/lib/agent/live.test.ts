/* Live agent check: the real pi loop, the real HTTP relay, a real
   model. Skipped unless LIVE_AGENT=1, because it needs a running
   backend and burns real tokens.

   Backend (any OpenAI-compatible endpoint — a local model server is
   enough, no key, no spend):
     LLM_DEV_BASE_URL=http://127.0.0.1:11434/v1 \
     LLM_DEV_MODEL=llama3.1:latest \
     DATABASE_URL=sqlite:////tmp/live.db API_KEYS=secret \
     uv run uvicorn app.main:app --port 8078

   Then, in the frontend:
     LIVE_AGENT=1 PUBLIC_API_URL=http://localhost:8078 \
     npx vitest run src/lib/agent/live.test.ts
*/
import { beforeEach, describe, expect, it } from "vitest";
import { Agent } from "@mariozechner/pi-agent-core";
import { SAMPLE_PROJECT } from "../project";
import { currentIdStore, projectStore, projectsStore, sceneIdStore, selectionStore } from "../store";
import { buildPiTools, createStudioAgent, placeholderModel, relayStream } from "./pi";

const live = process.env["LIVE_AGENT"] === "1";

function reset() {
  projectsStore.set({ demo: structuredClone(SAMPLE_PROJECT) });
  currentIdStore.set("demo");
  sceneIdStore.set("title");
  selectionStore.set(null);
}

function report(agent: Agent) {
  const tools: string[] = [];
  agent.subscribe((e) => {
    const ev = e as unknown as Record<string, unknown>;
    if (ev["type"] === "tool_execution_start") tools.push(String(ev["toolName"]));
    if (ev["type"] === "message_end" && (ev["message"] as { role?: string }).role === "assistant") {
      const m = ev["message"] as { stopReason?: string; errorMessage?: string; content?: Array<{ type: string; text?: string }> };
      if (m.stopReason === "error") console.log("ERROR:", m.errorMessage);
      const text = (m.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("");
      if (text) console.log("AGENT:", text.slice(0, 200));
    }
  });
  return tools;
}

describe.skipIf(!live)("live agent over the real relay", () => {
  beforeEach(reset);

  it("runs the shipped prompt, corpus and all", async () => {
    const agent = createStudioAgent();
    const tools = report(agent);
    const started = Date.now();
    await agent.prompt("Add an 8x8 sprite named knight, then stop.");
    console.log("TOOLS:", tools.join(", "), `(${Math.round((Date.now() - started) / 1000)}s)`);
    expect(projectStore.get().sprites.map((s) => s.id)).toContain("knight");
  }, 900_000);

  it("runs a short prompt, for slow local models", async () => {
    const agent = new Agent({
      initialState: {
        model: placeholderModel() as never,
        systemPrompt: "You are a Uxn game agent. Use the tools to change the project.",
        tools: buildPiTools() as never,
      },
      streamFn: ((_m: unknown, ctx: never) => relayStream(ctx as never)) as never,
    });
    const tools = report(agent);
    await agent.prompt("Add an 8x8 sprite named knight, then stop.");
    console.log("TOOLS:", tools.join(", "));
    expect(projectStore.get().sprites.map((s) => s.id)).toContain("knight");
  }, 900_000);
});
