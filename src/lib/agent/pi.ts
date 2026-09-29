/* Pi bridge: pi-agent-core loop, running IN the browser, executing
   our tools.ts manifest against projectStore. The loop is client-side;
   the *model* is not. Every turn POSTs the transcript to
   /agent/turn, where the server picks the route (`llm.plan`: filters,
   ranking, then a walk down the candidates) and holds every key — so
   no provider id, model id, or API key is ever chosen or seen here.
   `POST /agent/route` is the operator's dry run of that same
   decision, not a door this client uses. Tools still run locally: the
   agent mutates this tab's project. */
import { Agent, type AgentTool } from "@mariozechner/pi-agent-core";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Model,
  type StreamOptions,
  type Usage,
} from "@mariozechner/pi-ai";
import { Optional, String as TString, Number as TNumber, Array as TArray, type TSchema } from "typebox";
import toolsMd from "./corpus/tools.md?raw";
import etalMd from "./corpus/etal.md?raw";
import varvaraMd from "./corpus/varvara.md?raw";
import examplesMd from "./corpus/examples.md?raw";
import { authFetch } from "../auth";
import { TOOLS, runTool } from "./tools";

export interface TurnReply {
  content: string | null;
  tool_calls: Array<{ id: string; name: string; arguments: string }>;
  usage: { in: number; out: number };
}

/** Carries the status so the UI can pick a translated message instead
    of surfacing the backend's English detail verbatim. */
export class TurnError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** One agent turn. The body carries the transcript and the tool
    schema — never a provider, a model id, or a key: the backend
    routes, holds the key, and walks its own fallback chain. */
async function relayTurn(
  messages: Array<Record<string, unknown>>,
  tools: Array<Record<string, unknown>>,
): Promise<TurnReply> {
  let res: Response;
  try {
    res = await authFetch("/agent/turn", {
      method: "POST",
      body: JSON.stringify({ messages, tools }),
    });
  } catch {
    throw new TurnError(0, "offline");
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new TurnError(res.status, data.detail ?? `agent: ${res.status}`);
  }
  return (await res.json()) as TurnReply;
}

/** Pi transcript → OpenAI chat-completions messages. Assistant tool
    calls and tool results must survive the round trip or the agent
    loop breaks after the first tool use. */
export function toWireMessages(context: {
  systemPrompt?: string;
  messages: Array<Record<string, unknown>>;
}): Array<Record<string, unknown>> {
  const wire: Array<Record<string, unknown>> = [];
  if (context.systemPrompt) wire.push({ role: "system", content: context.systemPrompt });
  for (const m of context.messages) {
    const role = m["role"];
    if (role === "user") {
      wire.push({ role: "user", content: flattenText(m["content"]) });
    } else if (role === "assistant") {
      const parts = (m["content"] as Array<Record<string, unknown>> | undefined) ?? [];
      const text = parts
        .filter((p) => p["type"] === "text")
        .map((p) => String(p["text"] ?? ""))
        .join("");
      const calls = parts
        .filter((p) => p["type"] === "toolCall")
        .map((p) => ({
          id: String(p["id"] ?? ""),
          type: "function",
          function: { name: String(p["name"] ?? ""), arguments: JSON.stringify(p["arguments"] ?? {}) },
        }));
      const entry: Record<string, unknown> = { role: "assistant", content: text || null };
      if (calls.length > 0) entry["tool_calls"] = calls;
      wire.push(entry);
    } else if (role === "toolResult") {
      wire.push({
        role: "tool",
        tool_call_id: String(m["toolCallId"] ?? ""),
        content: flattenText(m["content"]),
      });
    }
  }
  return wire;
}

function flattenText(content: unknown): string {
  if (typeof content === "string") return content;
  const parts = (content as Array<Record<string, unknown>> | undefined) ?? [];
  const text = parts
    .map((p) => (p["type"] === "text" ? String(p["text"] ?? "") : "[image]"))
    .join("");
  return text || JSON.stringify(content ?? "");
}

function zeroUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

/** StreamFn speaking our relay: pi-shaped context in, pi's event
    stream out. Non-streaming under the hood (one relay call per turn)
    and the model descriptor is a placeholder — routing happens
    server-side.

    It must be an AssistantMessageEventStream, not a bare generator:
    the loop awaits `response.result()` to learn the finished message,
    and a plain async iterator leaves it undefined (silently ending
    the turn with an empty assistant message). */
export function relayStream(
  context: { systemPrompt?: string; messages: Array<Record<string, unknown>>; tools?: Array<Record<string, unknown>> },
  api: string = "openai-completions",
): ReturnType<typeof createAssistantMessageEventStream> {
  const stream = createAssistantMessageEventStream();
  void (async () => {
    const base: AssistantMessage = {
      role: "assistant",
      content: [],
      api: api as AssistantMessage["api"],
      provider: BACKEND_ROUTE,
      model: BACKEND_ROUTE,
      usage: zeroUsage(),
      stopReason: "stop",
      timestamp: Date.now(),
    };
    stream.push({ type: "start", partial: base });
    let reply: TurnReply;
    try {
      reply = await relayTurn(toWireMessages(context), context.tools ?? []);
    } catch (err) {
      // The loop treats an error event as the end of the turn (it does
      // not reject), so the status travels in the message: the UI maps
      // it to its own language instead of showing backend English.
      const status = err instanceof TurnError ? err.status : 0;
      if (!(err instanceof TurnError)) console.error("agent turn failed", err);
      const error: AssistantMessage = {
        ...base,
        stopReason: "error",
        errorMessage: `turn:${status}`,
      };
      stream.push({ type: "error", reason: "error", error });
      stream.end(error);
      return;
    }
    const usage: Usage = {
      input: reply.usage?.in ?? 0,
      output: reply.usage?.out ?? 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: (reply.usage?.in ?? 0) + (reply.usage?.out ?? 0),
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
    let index = 0;
    if (reply.content) {
      const text = { type: "text" as const, text: reply.content };
      base.content.push(text);
      stream.push({ type: "text_start", contentIndex: index, partial: base });
      stream.push({ type: "text_delta", contentIndex: index, delta: reply.content, partial: base });
      stream.push({ type: "text_end", contentIndex: index, content: reply.content, partial: base });
      index += 1;
    }
    for (const c of reply.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(c.arguments || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }
      const toolCall = { type: "toolCall" as const, id: c.id, name: c.name, arguments: args };
      base.content.push(toolCall);
      base.stopReason = "toolUse";
      stream.push({ type: "toolcall_start", contentIndex: index, partial: base });
      stream.push({ type: "toolcall_delta", contentIndex: index, delta: c.arguments, partial: base });
      stream.push({ type: "toolcall_end", contentIndex: index, toolCall, partial: base });
      index += 1;
    }
    base.usage = usage;
    const reason = base.stopReason as "stop" | "toolUse";
    stream.push({ type: "done", reason, message: base });
    stream.end(base);
  })();
  return stream;
}

/** Manifest params → a TSchema the model sees and pi validates against.
    Extra keys are allowed on purpose: models love adding plausible
    ones ("w", "color"), our handlers read only what they know, and a
    strict schema would fail an otherwise fine call. Missing *required*
    keys still fail — that is the check worth making. */
function toSchema(params: Record<string, { type: string; required?: boolean }>): TSchema {
  const props: Record<string, TSchema> = {};
  for (const [name, def] of Object.entries(params)) {
    let base: TSchema;
    if (def.type === "array") base = TArray(TNumber());
    else if (def.type === "number") base = TNumber();
    else base = TString();
    props[name] = def.required ? base : Optional(base);
  }
  return { type: "object", properties: props, additionalProperties: true } as unknown as TSchema;
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

/** Stand-in identity for the model the backend picked. Pi wants a
    Model in its state; the real one is server-side and invisible. */
export const BACKEND_ROUTE = "backend";

export function placeholderModel(): Model<"openai-completions"> {
  return {
    id: BACKEND_ROUTE,
    name: BACKEND_ROUTE,
    api: "openai-completions",
    provider: BACKEND_ROUTE,
    baseUrl: "",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8192,
  };
}

export function createStudioAgent(): Agent {
  return new Agent({
    initialState: {
      model: placeholderModel() as never,
      systemPrompt: SYSTEM_PROMPT,
      tools: buildPiTools() as never,
    },
    streamFn: ((m: Model<"openai-completions">, context: never, options?: StreamOptions) => {
      void options;
      return relayStream(context as never, m.api);
    }) as never,
  });
}
