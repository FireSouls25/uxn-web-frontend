/* Real auth against the backend (/auth/*). Session shape stays
   {name, email} plus tokens; compile calls will reuse `authFetch`. */
import { API_URL } from "./api";
import { clearSession, getSession, isAccessExpired, setSession } from "./session";

function lang(): string {
  return typeof document !== "undefined" &&
    document.documentElement.dataset.lang === "es"
    ? "es"
    : "en";
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface Profile {
  id: string;
  name: string;
  email: string;
}

async function post(path: string, body: unknown): Promise<TokenPair> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...(body as object), lang: lang() }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { detail?: string }).detail ?? `auth: ${res.status}`);
  return data as TokenPair;
}

export const apiRegister = (name: string, email: string, password: string) =>
  post("/auth/register", { name, email, password });

export const apiLogin = (email: string, password: string) =>
  post("/auth/login", { email, password });

export async function apiMe(access: string): Promise<Profile> {
  const res = await fetch(`${API_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${access}` },
  });
  if (!res.ok) throw new Error(`auth: ${res.status}`);
  return (await res.json()) as Profile;
}

export async function apiLogout(refresh: string): Promise<void> {
  try {
    await fetch(`${API_URL}/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refresh }),
    });
  } catch {
    /* best-effort: local session clears regardless */
  }
}

/* One refresh at a time: parallel calls that all hit a stale token
   share it instead of each rotating (and revoking) the refresh token. */
let refreshing: Promise<boolean> | null = null;

/** Trade the stored refresh token for a new pair. False (and the
    session is dropped) when the backend no longer knows it: expired,
    revoked, or issued by another deployment (new database or secret). */
export function refreshSession(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const s = getSession();
    if (!s?.refresh) return false;
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: s.refresh }),
      });
      if (res.ok) {
        const pair = (await res.json()) as TokenPair;
        setSession({ ...s, access: pair.access_token, refresh: pair.refresh_token });
        return true;
      }
      if (res.status === 401 || res.status === 400) clearSession();
      return false;
    } catch {
      return false; // offline: keep the session, the call reports offline
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** fetch with the session's access token. An expired or rejected token
    is refreshed once and the call retried; when the session is dead
    (see refreshSession) the call is retried without it, so endpoints
    open to guests (compile, agent turns) keep working and the rest
    answer 401 as before. */
export async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  const send = (access?: string) =>
    fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(access ? { Authorization: `Bearer ${access}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
  let s = getSession();
  if (!s) return send();
  if (isAccessExpired(s.access)) {
    await refreshSession();
    s = getSession();
    if (!s) return send();
  }
  const res = await send(s.access);
  if (res.status !== 401) return res;
  await refreshSession();
  const again = getSession();
  return send(again && again.access !== s.access ? again.access : undefined);
}
