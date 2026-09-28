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
