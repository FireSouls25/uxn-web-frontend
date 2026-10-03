/* Export flow: validate → emit → POST /compile → download.
   The anchor download lands in the browser's default directory —
   no server round-trip for the bytes. */
import { API_URL } from "./api";
import { t, type Lang } from "./i18n";
import { emitProject, validateProject, type Project } from "./project";

export type ExportTarget = "linux" | "web";
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

  let res: Response;
  try {
    const raw = localStorage.getItem("uxn.session");
    const access = raw ? (JSON.parse(raw) as { access?: string }).access : undefined;
    res = await fetch(`${API_URL}/compile`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(access ? { Authorization: `Bearer ${access}` } : {}),
      },
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
  const body = data as { status: string; message: string; diagnostics: Diagnostic[]; artifacts: Record<string, string> };
  if (body.status !== "ok") {
    return { ok: false, message: body.message || t(lang, "exp.failed"), diagnostics: body.diagnostics };
  }
  const key = mode === "tal" ? "tal" : mode === "rom" ? "rom_b64" : target === "web" ? "html_b64" : "bundle_b64";
  const payload = body.artifacts[key];
  if (typeof payload !== "string") return { ok: false, message: t(lang, "exp.failed") };
  const bytes =
    key === "tal"
      ? new TextEncoder().encode(payload)
      : Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
  const mime = key === "tal" ? "text/plain" : key === "html_b64" ? "text/html" : "application/octet-stream";
  return { ok: true, message: t(lang, "exp.done"), bytes, mime, filename: artifactFilename(project.name, target, mode) };
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
