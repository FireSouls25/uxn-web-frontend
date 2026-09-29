import { describe, expect, it } from "vitest";
import { TOOLS } from "./tools";
import {
  SYSTEM_PROMPT,
  buildPiTools,
  listModels,
  listProviders,
} from "./pi";

describe("pi bridge", () => {
  it("discovers providers and models without network", () => {
    const providers = listProviders();
    expect(providers).toContain("openai");
    expect(providers).toContain("anthropic");
    expect(providers).toContain("openrouter");
    // Local engines (Ollama/LM Studio) are not pi-ai providers; they
    // attach via OpenAI-compatible endpoints (future baseUrl override).
    expect(providers).not.toContain("ollama");
    const models = listModels("openai");
    expect(models.length).toBeGreaterThan(0);
    expect(models[0]).toHaveProperty("id");
    expect(listModels("nope")).toEqual([]);
  });

  it("adapts every manifest tool with a schema", () => {
    const adapted = buildPiTools();
    expect(adapted).toHaveLength(TOOLS.length);
    for (const t of adapted) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.parameters).toHaveProperty("properties");
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
});
