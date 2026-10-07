/* Real auth against the backend (/auth/*). Session shape stays
   {name, email} plus tokens; compile calls will reuse `authFetch`. */
import { API_URL } from "./api";

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

export async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  let access: string | undefined;
  try {
    const raw = localStorage.getItem("uxn.session");
    access = raw ? (JSON.parse(raw) as { access?: string }).access : undefined;
  } catch {
    access = undefined; // no session (RequireAuth should prevent this) — plain call
  }
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(access ? { Authorization: `Bearer ${access}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}
