/* Persisted session: profile + tokens from /auth/*. The stub is
   gone — login/register now hit the backend (see lib/auth.ts). */

export interface Session {
  name: string;
  email: string;
  access: string;
  refresh: string;
}

const KEY = "uxn.session";

export function getSession(): Session | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<Session>;
    return s.access && s.email ? (s as Session) : null;
  } catch {
    return null;
  }
}

export function setSession(s: Session): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function clearSession(): void {
  localStorage.removeItem(KEY);
}

/* True when the access JWT is already past its `exp` claim, so
   callers can drop a dead session quietly instead of provoking a
   401 from /auth/me (which the browser still logs as an error).
   Non-JWT tokens report false — the server stays the arbiter. */
export function isAccessExpired(access: string): boolean {
  try {
    const payload = JSON.parse(atob(access.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as {
      exp?: unknown;
    };
    return typeof payload.exp === "number" && payload.exp * 1000 <= Date.now();
  } catch {
    return false;
  }
}
