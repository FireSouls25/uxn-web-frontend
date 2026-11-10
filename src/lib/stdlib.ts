/* Standard library: the uxn-dsl `lib/*.ux` modules, bundled verbatim
   (synced by `sh scripts/sync-stdlib.sh`). Scripts and custom code
   `import "screen.ux"` like a local file; the emitter ships exactly
   the modules a project imports (transitively), as siblings of
   main.ux — the backend only resolves sibling imports. */

const raw = import.meta.glob("./stdlib/*.ux", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;

/** Module file name (`screen.ux`) → source. */
export const STDLIB: Record<string, string> = Object.fromEntries(
  Object.entries(raw)
    .map(([path, src]) => [path.slice(path.lastIndexOf("/") + 1), src] as const)
    .sort(([a], [b]) => (a < b ? -1 : 1)),
);

export const STDLIB_NAMES = Object.keys(STDLIB);

/** Every `import "x"` target in a source, in order. */
export function importsOf(src: string): string[] {
  const out: string[] = [];
  for (const line of src.split("\n")) {
    const m = line.match(/^\s*import\s+"([^"]+)"/);
    if (m) out.push(m[1]);
  }
  return out;
}

/** The module's leading `( … )` comment, first sentence only. */
export function moduleSummary(name: string): string {
  const src = STDLIB[name] ?? "";
  const m = src.match(/^\s*\(\s*([\s\S]*?)\)/);
  if (!m) return "";
  const text = m[1].replace(/\s+/g, " ").replace(/^lib\/\S+\s+[—-]\s+/, "").trim();
  const cut = text.search(/[.:;](\s|$)/);
  return (cut > 0 ? text.slice(0, cut) : text).slice(0, 120);
}

export interface LibExport {
  name: string;
  kind: "fn" | "macro" | "const" | "data" | "global";
  /** Call/use form to insert (`blit(x, y, tile, mode)`). */
  sig: string;
}

/** Top-level names a module offers, in source order. Parameter
    lists are kept as written so inserted calls read like the docs. */
export function moduleExports(src: string): LibExport[] {
  const out: LibExport[] = [];
  for (const line of src.split("\n")) {
    let m = line.match(/^macro\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/);
    if (m) {
      out.push({ name: m[1], kind: "macro", sig: `${m[1]}(${paramNames(m[2])})` });
      continue;
    }
    m = line.match(/^([A-Za-z_]\w*)\s*::\s*fn\s*\(([^)]*)\)/);
    if (m) {
      out.push({ name: m[1], kind: "fn", sig: `${m[1]}(${paramNames(m[2])})` });
      continue;
    }
    m = line.match(/^([A-Za-z_]\w*)\s*::\s*-?[0-9]/);
    if (m) {
      out.push({ name: m[1], kind: "const", sig: m[1] });
      continue;
    }
    m = line.match(/^data\s+([A-Za-z_]\w*)/);
    if (m) {
      out.push({ name: m[1], kind: "data", sig: `&${m[1]}` });
      continue;
    }
    m = line.match(/^([A-Za-z_]\w*)\s*:\s*[^:=]/);
    if (m) out.push({ name: m[1], kind: "global", sig: m[1] });
  }
  return out;
}

function paramNames(params: string): string {
  return params
    .split(",")
    .map((p) => p.split(":")[0].trim())
    .filter(Boolean)
    .join(", ");
}

/** Stdlib modules reachable from `roots` through imports, in a
    stable (sorted) order. Unknown names are ignored here; validation
    reports them. */
export function stdlibClosure(roots: string[], skip: Set<string> = new Set()): string[] {
  const seen = new Set<string>();
  const walk = (name: string): void => {
    if (seen.has(name) || skip.has(name) || !(name in STDLIB)) return;
    seen.add(name);
    for (const dep of importsOf(STDLIB[name])) walk(dep);
  };
  for (const r of roots) walk(r);
  return [...seen].sort();
}
