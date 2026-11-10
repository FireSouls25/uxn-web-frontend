import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authFetch } from "./auth";
import { getSession, setSession } from "./session";

/* authFetch: a login the backend no longer knows (expired, revoked, or
   from an earlier deployment) must not break calls guests may make. */

function memoryBox() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

/** A JWT-shaped token whose `exp` is `secs` from now. */
const jwt = (secs: number) => `h.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + secs }))}.s`;

type Call = { url: string; auth?: string };

function stubFetch(answer: (c: Call) => { status: number; body?: unknown }): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    const c = { url: String(url), auth };
    calls.push(c);
    const { status, body } = answer(c);
    return new Response(JSON.stringify(body ?? {}), { status });
  });
  return calls;
}

describe("authFetch", () => {
  beforeEach(() => {
    (globalThis as unknown as Record<string, unknown>).localStorage = memoryBox();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("drops a dead session and retries as a guest", async () => {
    const stale = jwt(600);
    setSession({ name: "a", email: "a@x", access: stale, refresh: "r-old" });
    const calls = stubFetch((c) =>
      c.url.endsWith("/auth/refresh") ? { status: 401 } : c.auth ? { status: 401 } : { status: 200, body: { ok: true } },
    );
    const res = await authFetch("/compile", { method: "POST", body: "{}" });
    expect(res.status).toBe(200);
    expect(calls.map((c) => [c.url.replace(/^.*\/\/[^/]+/, ""), !!c.auth])).toEqual([
      ["/compile", true],
      ["/auth/refresh", false],
      ["/compile", false],
    ]);
    expect(getSession()).toBeNull();
  });

  it("refreshes an expired token before the call", async () => {
    setSession({ name: "a", email: "a@x", access: jwt(-60), refresh: "r-old" });
    const fresh = jwt(1800);
    const calls = stubFetch((c) =>
      c.url.endsWith("/auth/refresh")
        ? { status: 200, body: { access_token: fresh, refresh_token: "r-new", expires_in: 1800 } }
        : { status: c.auth === `Bearer ${fresh}` ? 200 : 401 },
    );
    const res = await authFetch("/share", { method: "POST" });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(getSession()).toMatchObject({ access: fresh, refresh: "r-new" });
  });
});
