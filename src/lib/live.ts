/* Live check: a WebSocket to the backend's /ws/check that compiles the
   project as you edit and pushes the compiler's diagnostics back.

   One socket per tab, opened lazily and reconnected with backoff.
   Edits are debounced here; the server also applies "latest wins", so
   a burst of typing compiles at most the newest version. Results land
   in diagnosticsStore (the same store the manual Check fills), so the
   problems strip and error gutters need no extra wiring. */
import { atom } from "nanostores";
import { API_URL } from "./api";
import type { Lang } from "./i18n";
import { emitProject, validateProject, type Project } from "./project";
import { diagnosticsStore } from "./store";
import type { Diagnostic } from "./export";

export type LiveState = "off" | "connecting" | "idle" | "checking" | "ok" | "error" | "offline";

export interface LiveStatus {
  state: LiveState;
  /** Server/compiler message for the last result or error. */
  message?: string;
  ms?: number;
  romBytes?: number;
  count?: number;
}

const PREF = "uxn.livecheck";
export const liveEnabledStore = atom<boolean>(readPref());
export const liveStatusStore = atom<LiveStatus>({ state: "off" });

function readPref(): boolean {
  try {
    return localStorage.getItem(PREF) !== "0";
  } catch {
    return true;
  }
}

export function setLiveEnabled(on: boolean): void {
  liveEnabledStore.set(on);
  try {
    localStorage.setItem(PREF, on ? "1" : "0");
  } catch {
    /* private mode */
  }
  if (!on) disconnect();
  else liveStatusStore.set({ state: "idle" });
}

export function wsUrl(base: string, token?: string): string {
  const u = new URL("/ws/check", base);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  if (token) u.searchParams.set("token", token);
  return u.toString();
}

function accessToken(): string | undefined {
  try {
    const raw = localStorage.getItem("uxn.session");
    return raw ? (JSON.parse(raw) as { access?: string }).access : undefined;
  } catch {
    return undefined;
  }
}

let socket: WebSocket | null = null;
let ready = false;
let retry = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let debounce: ReturnType<typeof setTimeout> | undefined;
let seq = 0;
let lastSent = 0;
let queued: string | null = null;

function connect(): void {
  if (socket || typeof WebSocket === "undefined") return;
  liveStatusStore.set({ state: "connecting" });
  const ws = new WebSocket(wsUrl(API_URL, accessToken()));
  socket = ws;
  ws.onopen = () => {
    ready = true;
    retry = 0;
    if (queued) {
      ws.send(queued);
      queued = null;
    } else liveStatusStore.set({ state: "idle" });
  };
  ws.onmessage = (ev) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
    } catch {
      return;
    }
    // Ignore answers to versions we've already replaced.
    if (typeof msg.id === "number" && msg.id < lastSent) return;
    if (msg.type === "checking") liveStatusStore.set({ ...liveStatusStore.get(), state: "checking" });
    else if (msg.type === "result") {
      const diags = (msg.diagnostics as Diagnostic[]) ?? [];
      diagnosticsStore.set(diags);
      liveStatusStore.set({
        state: msg.ok ? "ok" : "error",
        message: String(msg.message ?? ""),
        ms: Number(msg.ms ?? 0),
        romBytes: Number(msg.rom_bytes ?? 0),
        count: diags.length,
      });
    } else if (msg.type === "error") {
      liveStatusStore.set({ state: "error", message: String(msg.message ?? ""), count: 0 });
    }
  };
  ws.onclose = (ev) => {
    socket = null;
    ready = false;
    if (!liveEnabledStore.get()) return;
    // 4401: not allowed (logged out / expired token) — don't hammer.
    liveStatusStore.set({ state: "offline", message: ev.code === 4401 ? "login" : undefined });
    if (ev.code === 4401) return;
    const wait = Math.min(15000, 1000 * 2 ** retry++);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, wait);
  };
}

function disconnect(): void {
  clearTimeout(retryTimer);
  clearTimeout(debounce);
  queued = null;
  const s = socket;
  socket = null;
  ready = false;
  s?.close();
  liveStatusStore.set({ state: "off" });
}

/** Queue a live check of `project` after a short pause in editing. */
export function scheduleLiveCheck(project: Project, lang: Lang, delay = 700): void {
  if (!liveEnabledStore.get()) return;
  clearTimeout(debounce);
  debounce = setTimeout(() => sendNow(project, lang), delay);
}

function sendNow(project: Project, lang: Lang): void {
  // Local validation errors already show in the problems strip; the
  // compiler would only repeat them less clearly.
  if (validateProject(project).length > 0) return;
  let files: Record<string, string>;
  try {
    files = emitProject(project);
  } catch {
    return;
  }
  const entry = project.kind === "code" ? (project.entry ?? "main.ux") : "main.ux";
  lastSent = ++seq;
  const frame = JSON.stringify({ type: "check", id: lastSent, entry, files, lang });
  if (ready && socket) socket.send(frame);
  else {
    queued = frame;
    connect();
  }
}

/** Drop the socket when the session changes (login/logout). */
export function resetLiveCheck(): void {
  const on = liveEnabledStore.get();
  disconnect();
  if (on) liveStatusStore.set({ state: "idle" });
}
