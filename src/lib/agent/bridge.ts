/* Agent bridge, studio side: lets an outside agent (Claude Code or any
   MCP client) use this tab's tools on the open project.

   The tab holds a pairing key from POST /bridge/keys, connects to
   WS /ws/bridge with it, announces its tool manifest (the same TOOLS
   the in-app agent uses), then answers each `call` frame by running
   the tool here and sending the result back. The MCP client talks to
   the backend's /mcp with the same key. See backend/app/bridge.py.

   The key is remembered in localStorage, so the bridge reconnects on
   reload and across studio pages until the user disconnects. */
import { atom } from "nanostores";
import { API_URL } from "../api";
import { projectStore } from "../store";
import { TOOLS, projectContext, runToolAsync, type ToolResult } from "./tools";

export type BridgeStatus = "off" | "connecting" | "on" | "replaced" | "expired" | "error";

export interface BridgeState {
  status: BridgeStatus;
  key?: string;
  mcpUrl?: string;
  calls: number;
  last?: string;
}

const STORE_KEY = "uxn.bridge";
export const bridgeStore = atom<BridgeState>({ status: "off", calls: 0 });

let socket: WebSocket | null = null;
let wanted = false;
let retry = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastProject = "";

/** Extra tool only bridged agents need: the summary the in-app agent
    gets at the top of every request. */
const BRIDGE_TOOLS = [
  {
    name: "project_context",
    description: "The open project's summary (scenes, templates, events, scripts with signatures, sprites, sounds, variables): the same text the in-app agent starts every request with. Call it first and after big changes.",
    params: {},
  },
];

export function manifest(): Array<{ name: string; description: string; params: Record<string, unknown> }> {
  return [...BRIDGE_TOOLS, ...TOOLS.map((t) => ({ name: t.name, description: t.description, params: t.params }))];
}

export function bridgeWsUrl(base: string, key: string): string {
  const u = new URL("/ws/bridge", base);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.searchParams.set("key", key);
  return u.toString();
}

/** The command that registers this studio with Claude Code. */
export function claudeCommand(mcpUrl: string, key: string): string {
  return `claude mcp add --transport http uxn-forge ${mcpUrl} --header "Authorization: Bearer ${key}"`;
}

/** Config for MCP clients that take JSON (mcpServers entry). */
export function mcpJson(mcpUrl: string, key: string): string {
  return JSON.stringify({ mcpServers: { "uxn-forge": { type: "http", url: mcpUrl, headers: { Authorization: `Bearer ${key}` } } } }, null, 2);
}

function accessToken(): string | undefined {
  try {
    const raw = localStorage.getItem("uxn.session");
    return raw ? (JSON.parse(raw) as { access?: string }).access : undefined;
  } catch {
    return undefined;
  }
}

function saved(): { key: string; mcpUrl: string } | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const v = raw ? (JSON.parse(raw) as { key?: string; mcpUrl?: string }) : null;
    return v?.key && v.mcpUrl ? { key: v.key, mcpUrl: v.mcpUrl } : null;
  } catch {
    return null;
  }
}

function save(v: { key: string; mcpUrl: string } | null): void {
  try {
    if (v) localStorage.setItem(STORE_KEY, JSON.stringify(v));
    else localStorage.removeItem(STORE_KEY);
  } catch {
    /* private mode: the bridge lasts for this page only */
  }
}

function set(patch: Partial<BridgeState>): void {
  bridgeStore.set({ ...bridgeStore.get(), ...patch });
}

function projectInfo(): { id: string; name: string } {
  const p = projectStore.get();
  return { id: p.id, name: p.name };
}

/** Run one relayed call. Exported for tests. */
export async function runBridgeCall(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (name === "project_context") return { ok: true, message: projectContext() };
  try {
    return await runToolAsync(name, args ?? {});
  } catch (e) {
    return { ok: false, message: `tool ${name} failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function open(key: string): void {
  if (timer) clearTimeout(timer);
  set({ status: "connecting" });
  const ws = new WebSocket(bridgeWsUrl(API_URL, key));
  socket = ws;
  ws.onmessage = async (ev) => {
    let msg: { type?: string; id?: number; name?: string; args?: Record<string, unknown> };
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (msg.type === "ready") {
      retry = 0;
      lastProject = projectInfo().id;
      ws.send(JSON.stringify({ type: "hello", tools: manifest(), project: projectInfo() }));
      set({ status: "on" });
    } else if (msg.type === "call" && typeof msg.name === "string") {
      set({ calls: bridgeStore.get().calls + 1, last: msg.name });
      const r = await runBridgeCall(msg.name, msg.args ?? {});
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "result", id: msg.id, ok: r.ok, message: r.message, data: r.data }));
    }
  };
  ws.onclose = (ev) => {
    if (socket !== ws) return;
    socket = null;
    if (ev.code === 4401) {
      wanted = false;
      save(null);
      set({ status: "expired", key: undefined, mcpUrl: undefined });
    } else if (ev.code === 4409) {
      wanted = false;
      set({ status: "replaced" });
    } else if (wanted) {
      set({ status: "connecting" });
      retry = Math.min(retry + 1, 6);
      timer = setTimeout(() => open(key), 500 * 2 ** retry);
    } else set({ status: "off" });
  };
}

/** Tell the server when the user opens another project. */
projectStore.listen((p) => {
  if (socket?.readyState === WebSocket.OPEN && p.id !== lastProject) {
    lastProject = p.id;
    socket.send(JSON.stringify({ type: "project", project: { id: p.id, name: p.name } }));
  }
});

/** Pair: ask the backend for a key, remember it, connect. */
export async function connectBridge(): Promise<{ ok: boolean; status?: number }> {
  const token = accessToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}/bridge/keys`, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {} });
  } catch {
    set({ status: "error" });
    return { ok: false, status: 0 };
  }
  if (!res.ok) {
    set({ status: "error" });
    return { ok: false, status: res.status };
  }
  const body = (await res.json()) as { key: string; mcp_url: string };
  save({ key: body.key, mcpUrl: body.mcp_url });
  set({ key: body.key, mcpUrl: body.mcp_url, calls: 0, last: undefined });
  wanted = true;
  open(body.key);
  return { ok: true };
}

/** Reconnect with the remembered key (page load, or "use this tab"). */
export function resumeBridge(): void {
  const s = saved();
  if (!s || (socket && socket.readyState <= WebSocket.OPEN)) return;
  set({ key: s.key, mcpUrl: s.mcpUrl });
  wanted = true;
  open(s.key);
}

/** Disconnect and revoke the key (the agent loses access). */
export async function disconnectBridge(): Promise<void> {
  const s = saved();
  wanted = false;
  if (timer) clearTimeout(timer);
  const ws = socket;
  socket = null;
  ws?.close();
  save(null);
  set({ status: "off", key: undefined, mcpUrl: undefined, calls: 0, last: undefined });
  if (s) {
    try {
      await fetch(`${API_URL}/bridge/keys`, { method: "DELETE", headers: { Authorization: `Bearer ${s.key}` } });
    } catch {
      /* offline: the key still expires on its own */
    }
  }
}
