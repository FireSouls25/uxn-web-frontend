/* Export flow: validate → emit → POST /compile → download.
   The anchor download lands in the browser's default directory —
   no server round-trip for the bytes. */
import { API_URL } from "./api";
import { t, type Lang } from "./i18n";
import { emitProject, validateProject, type Project } from "./project";

export type ExportTarget = "linux" | "web" | "macos" | "macos-intel" | "windows";
export type ExportMode = "bundle" | "rom" | "tal";

export interface Diagnostic {
  file: string | null;
  line: number | null;
  col: number | null;
  msg: string;
}

export interface ExportResult {
  ok: boolean;
  message: string;
  diagnostics?: Diagnostic[];
}

export function artifactFilename(project: string, target: ExportTarget, mode: ExportMode): string {
  const slug =
    project
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "game";
  if (mode === "tal") return `${slug}.tal`;
  if (mode === "rom") return `${slug}.rom`;
  if (target === "web") return `${slug}.html`;
  if (target === "windows") return `${slug}.exe`;
  if (target === "macos" || target === "macos-intel") return `${slug}.${target}`;
  return `${slug}.linux`;
}

function downloadBlob(bytes: Uint8Array, filename: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export interface CompileResult extends ExportResult {
  bytes?: Uint8Array;
  mime?: string;
  filename?: string;
  /** Server compile job (share links point at it). */
  jobId?: string;
}

/* Last successful builds by request, so pressing Playtest again on an
   unchanged project opens instantly instead of re-sending the whole
   tree. Small and in memory: a handful of web pages at most. */
const BUILD_CACHE_MAX = 4;
const buildCache = new Map<string, CompileResult>();

function cacheKey(target: string, mode: string, entry: string, files: Record<string, string>, cursor: boolean): string {
  const names = Object.keys(files).sort();
  return JSON.stringify([target, mode, entry, cursor, names.map((n) => [n, files[n]])]);
}

function remember(key: string, r: CompileResult): void {
  buildCache.delete(key);
  buildCache.set(key, r);
  while (buildCache.size > BUILD_CACHE_MAX) buildCache.delete(buildCache.keys().next().value as string);
}

function authHeader(): Record<string, string> {
  try {
    const raw = localStorage.getItem("uxn.session");
    const access = raw ? (JSON.parse(raw) as { access?: string }).access : undefined;
    return access ? { Authorization: `Bearer ${access}` } : {};
  } catch {
    return {};
  }
}

/** Validate → emit → POST /compile, returning the artifact bytes
    without downloading. Powers both export-to-file and the in-studio
    playtest (same bytes either way). */
export async function compileProject(
  project: Project,
  target: ExportTarget,
  mode: ExportMode,
  lang: Lang,
): Promise<CompileResult> {
  const errs = validateProject(project);
  if (errs.length > 0) return { ok: false, message: errs[0] };
  const files = emitProject(project);
  const entry = project.kind === "code" ? (project.entry ?? "main.ux") : "main.ux";
  const key = cacheKey(target, mode, entry, files, !!project.gameCursor);
  const hit = buildCache.get(key);
  if (hit) {
    remember(key, hit);
    return { ...hit, filename: artifactFilename(project.name, target, mode) };
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}/compile`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ target, mode, entry, files, lang }),
    });
  } catch {
    return { ok: false, message: t(lang, "exp.offline") };
  }
  if (res.status === 401) return { ok: false, message: t(lang, "exp.login") };
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (data as { detail?: string }).detail;
    return { ok: false, message: typeof detail === "string" ? detail : t(lang, "exp.failed") };
  }
  const body = data as { status: string; job_id?: string; message: string; diagnostics: Diagnostic[]; artifacts: Record<string, string> };
  if (body.status !== "ok") {
    return { ok: false, message: body.message || t(lang, "exp.failed"), diagnostics: body.diagnostics };
  }
  const art = mode === "tal" ? "tal" : mode === "rom" ? "rom_b64" : target === "web" ? "html_b64" : "bundle_b64";
  const payload = body.artifacts[art];
  if (typeof payload !== "string") return { ok: false, message: t(lang, "exp.failed") };
  let bytes: Uint8Array =
    art === "tal"
      ? new TextEncoder().encode(payload)
      : Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
  if (art === "html_b64" && project.gameCursor) bytes = hideHostCursor(bytes);
  const mime = art === "tal" ? "text/plain" : art === "html_b64" ? "text/html" : target === "windows" ? "application/vnd.microsoft.portable-executable" : "application/octet-stream";
  const result: CompileResult = {
    ok: true,
    message: t(lang, "exp.done"),
    bytes,
    mime,
    filename: artifactFilename(project.name, target, mode),
    jobId: body.job_id,
  };
  remember(key, result);
  return result;
}

/** Web page: the game draws its own pointer, so hide the browser's
    over the game canvas (native uxn emulators always do). */
export function hideHostCursor(html: Uint8Array): Uint8Array {
  const text = new TextDecoder().decode(html);
  const style = "<style>#display{cursor:none}</style>";
  const at = text.indexOf("</head>");
  const out = at >= 0 ? text.slice(0, at) + style + text.slice(at) : style + text;
  return new TextEncoder().encode(out);
}

export async function exportProject(
  project: Project,
  target: ExportTarget,
  mode: ExportMode,
  lang: Lang,
): Promise<ExportResult> {
  const r = await compileProject(project, target, mode, lang);
  if (!r.ok || !r.bytes) return { ok: r.ok, message: r.message, diagnostics: r.diagnostics };
  downloadBlob(r.bytes, r.filename ?? "game", r.mime ?? "application/octet-stream");
  return { ok: true, message: r.message };
}

export interface ShareResult {
  ok: boolean;
  message: string;
  url?: string;
  expiresAt?: string;
  diagnostics?: Diagnostic[];
}

/** Compile the web page (cached if unchanged) and ask the server for a
    temporary public link to it: a small, throwaway deploy. */
export async function shareProject(project: Project, lang: Lang): Promise<ShareResult> {
  const built = await compileProject(project, "web", "bundle", lang);
  if (!built.ok || !built.jobId) return { ok: false, message: built.message, diagnostics: built.diagnostics };
  let res: Response;
  try {
    res = await fetch(`${API_URL}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ job_id: built.jobId, title: project.name.slice(0, 64), hide_cursor: !!project.gameCursor }),
    });
  } catch {
    return { ok: false, message: t(lang, "exp.offline") };
  }
  if (res.status === 401) return { ok: false, message: t(lang, "exp.login") };
  const data = (await res.json().catch(() => ({}))) as { url?: string; expires_at?: string; detail?: string };
  if (!res.ok || !data.url) return { ok: false, message: typeof data.detail === "string" ? data.detail : t(lang, "share.failed") };
  return { ok: true, message: t(lang, "share.ready"), url: data.url, expiresAt: data.expires_at };
}
