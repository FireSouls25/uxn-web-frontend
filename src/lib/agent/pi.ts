/* Pi bridge: pi-agent-core loop, running IN the browser, executing
   our tools.ts manifest against projectStore. No Node runtime, no
   SSE hop — the Agent's tool_execution events map 1:1 onto runTool,
   and the transcript stays local. Verified: pi-ai + pi-agent-core
   bundle cleanly under Vite/Astro.
   Keys are BYOK in localStorage (per provider); nothing leaves the
   browser except LLM API calls. */
import { Agent, type AgentTool } from "@mariozechner/pi-agent-core";
import { getModel, getModels, getProviders, type KnownProvider } from "@mariozechner/pi-ai";
import { Optional, String as TString, Number as TNumber, Array as TArray, type TSchema } from "typebox";
import toolsMd from "./corpus/tools.md?raw";
import etalMd from "./corpus/etal.md?raw";
import varvaraMd from "./corpus/varvara.md?raw";
import examplesMd from "./corpus/examples.md?raw";
import { TOOLS, runTool } from "./tools";

const KEY_PREFIX = "uxn.agent.key.";

export function listProviders(): string[] {
  try {
    return [...getProviders()];
  } catch {
    return [];
  }
}

export function listModels(provider: string): Array<{ id: string; name: string }> {
  try {
    return getModels(provider as KnownProvider).map((m) => ({ id: m.id, name: m.name }));
  } catch {
    return [];
  }
}

export function getApiKey(provider: string): string | undefined {
  try {
    return localStorage.getItem(KEY_PREFIX + provider) ?? undefined;
  } catch {
    return undefined;
  }
}

export function setApiKey(provider: string, key: string): void {
  try {
    if (key) localStorage.setItem(KEY_PREFIX + provider, key);
    else localStorage.removeItem(KEY_PREFIX + provider);
  } catch {
    /* private mode */
  }
}

function toSchema(params: Record<string, { type: string; required?: boolean }>): TSchema {
  const props: Record<string, TSchema> = {};
  for (const [name, def] of Object.entries(params)) {
    let base: TSchema;
    if (def.type === "array") base = TArray(TNumber());
    else if (def.type === "number") base = TNumber();
    else base = TString();
    props[name] = def.required ? base : Optional(base);
  }
  return { type: "object", properties: props, additionalProperties: false } as unknown as TSchema;
}

/** Our manifest adapted to Pi tools. execute() IS the proposed
    tool_call protocol: Pi emits {name, args}, we runTool, Pi gets
    {ok, message, data} back as text. */
export function buildPiTools(): Array<AgentTool<TSchema, unknown>> {
  return TOOLS.map((t) => ({
    name: t.name,
    label: t.name,
    description: t.description,
    parameters: toSchema(t.params),
    execute: async (toolCallId: string, params: unknown) => {
      void toolCallId;
      const result = runTool(t.name, (params ?? {}) as Record<string, unknown>);
      return {
        content: [{ type: "text" as const, text: `${result.ok ? "ok" : "failed"}: ${result.message}${result.data ? `\ndata: ${JSON.stringify(result.data)}` : ""}` }],
        details: result,
      };
    },
  }));
}

export const SYSTEM_PROMPT = `You are the Forge studio agent. You build Uxn games by calling tools — never invent project state, always describe() first.

${toolsMd}

${etalMd}

${varvaraMd}

${examplesMd}

Rules: one player per scene max (0 allowed); movable implies solid; click targets accept nested paths (rack/jar); validate before long chains; export only via the UI compile flow. Keep replies short; narrate each tool call as you go.`;

export interface AgentConfig {
  provider: string;
  model: string;
}

export function createStudioAgent(config: AgentConfig): Agent {
  const model = getModel(config.provider as KnownProvider, config.model as never);
  return new Agent({
    initialState: {
      model: model as never,
      systemPrompt: SYSTEM_PROMPT,
      tools: buildPiTools() as never,
    },
    getApiKey: (provider: string) => getApiKey(provider),
  });
}
