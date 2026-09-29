import { describe, expect, it, vi, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TOOLS } from "./tools";
import { SYSTEM_PROMPT, buildPiTools, relayStream, toWireMessages } from "./pi";

describe("pi bridge", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adapts every manifest tool with a schema", () => {
    const adapted = buildPiTools();
    expect(adapted).toHaveLength(TOOLS.length);
    for (const t of adapted) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.parameters).toHaveProperty("properties");
      // Extra keys must not fail the call: models add plausible ones.
      expect((t.parameters as { additionalProperties?: boolean }).additionalProperties).toBe(true);
    }
  });

  it("executes through the protocol shape", async () => {
    const adapted = buildPiTools();
    const describe = adapted.find((t) => t.name === "describe")!;
    const result = await describe.execute("call-1", {});
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect((result.content[0] as { text: string }).text).toMatch(/^ok:/);
    const bad = adapted.find((t) => t.name === "put_on_scene")!;
    const failed = await bad.execute("call-2", { sprite: "ghost" });
    expect((failed.content[0] as { text: string }).text).toMatch(/^failed:/);
  });

  it("system prompt carries the corpus", () => {
    expect(SYSTEM_PROMPT).toContain("board[64]");
    expect(SYSTEM_PROMPT).toContain("2bpp");
    expect(SYSTEM_PROMPT).toContain("create_sprite");
  });

  it("translates a tool chain without losing the calls", () => {
    const wire = toWireMessages({
      systemPrompt: "sys",
      messages: [
        { role: "user", content: [{ type: "text", text: "add a knight" }] },
        {
          role: "assistant",
          content: [
            { type: "text", text: "one sprite" },
            { type: "toolCall", id: "c1", name: "create_sprite", arguments: { name: "knight" } },
          ],
        },
        {
          role: "toolResult",
          toolCallId: "c1",
          content: [{ type: "text", text: "ok: created" }],
        },
      ],
    });
    expect(wire[0]).toEqual({ role: "system", content: "sys" });
    expect(wire[1]).toEqual({ role: "user", content: "add a knight" });
    expect(wire[2]).toMatchObject({
      role: "assistant",
      content: "one sprite",
      tool_calls: [{ id: "c1", type: "function", function: { name: "create_sprite" } }],
    });
    const call = (wire[2]["tool_calls"] as Array<{ function: { arguments: string } }>)[0];
    expect(JSON.parse(call.function.arguments)).toEqual({ name: "knight" });
    expect(wire[3]).toEqual({ role: "tool", tool_call_id: "c1", content: "ok: created" });
  });

  it("sends no key material in the transcript", () => {
    const wire = toWireMessages({ systemPrompt: "s", messages: [{ role: "user", content: "hi" }] });
    expect(JSON.stringify(wire)).not.toMatch(/api[_-]?key|sk-|gsk_/i);
  });

  it("posts to /agent/turn with no route fields and replays the reply", async () => {
    let body: Record<string, unknown> = {};
    let url = "";
    vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
      url = String(input);
      body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          content: "made it",
          tool_calls: [{ id: "c9", name: "create_sprite", arguments: '{"name":"hero"}' }],
          usage: { in: 3, out: 4 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const events = [];
    for await (const e of relayStream({
      systemPrompt: "sys",
      messages: [{ role: "user", content: "a hero please" }],
      tools: [{ name: "create_sprite" }],
    })) {
      events.push(e);
    }

    expect(url).toMatch(/\/agent\/turn$/);
    expect(Object.keys(body).sort()).toEqual(["messages", "tools"]);
    expect(JSON.stringify(body)).not.toMatch(/provider|model|api[_-]?key/i);
    const kinds = events.map((e) => e.type);
    expect(kinds).toEqual([
      "start",
      "text_start",
      "text_delta",
      "text_end",
      "toolcall_start",
      "toolcall_delta",
      "toolcall_end",
      "done",
    ]);
    expect((events.at(-1) as { reason: string }).reason).toBe("toolUse");
  });

  it("the final message carries the text and the tool call", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            content: "here",
            tool_calls: [{ id: "c1", name: "describe", arguments: "{}" }],
            usage: { in: 7, out: 3 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    const stream = relayStream({ messages: [{ role: "user", content: "go" }] });
    for await (const _ of stream) void _;
    const message = await stream.result();
    expect(message.content.map((c) => c.type)).toEqual(["text", "toolCall"]);
    expect(message.stopReason).toBe("toolUse");
    expect(message.usage.totalTokens).toBe(10);
  });

  it("turn failures end the stream with a machine-readable status", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ detail: "no model answered" }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const stream = relayStream({ messages: [{ role: "user", content: "hi" }] });
    const seen = [];
    for await (const e of stream) seen.push(e);
    const last = seen.at(-1) as { type: string; error: { stopReason: string; errorMessage: string } };
    expect(last.type).toBe("error");
    expect(last.error.stopReason).toBe("error");
    expect(last.error.errorMessage).toBe("turn:502");
    // The final message is what the loop awaits; it must not be empty.
    const result = await stream.result();
    expect(result.errorMessage).toBe("turn:502");
  });

  it("keeps BYOK out of the client for good", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx|astro)$/.test(e.name) && !e.name.endsWith(".test.ts")) {
          const text = readFileSync(p, "utf-8");
          if (/uxn\.agent\.key|PUBLIC_AGENT_PROVIDERS|setApiKey/.test(text)) offenders.push(p);
        }
      }
    };
    walk(join(__dirname, "..", ".."));
    expect(offenders).toEqual([]);
  });
});
