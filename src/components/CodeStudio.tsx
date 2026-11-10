import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@nanostores/react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileCode2,
  Library,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import CodeEditor, { outline, type EditorApi } from "./CodeEditor";
import { t, useLang, type Lang } from "../lib/i18n";
import { compileProject } from "../lib/export";
import { liveEnabledStore, liveStatusStore, scheduleLiveCheck, setLiveEnabled } from "../lib/live";
import {
  HOOKS,
  definedHooks,
  emitProject,
  loopOf,
  scriptAssetNames,
  usedStdlib,
  validateProject,
  type HookName,
  type Project,
} from "../lib/project";
import { STDLIB, STDLIB_NAMES, importsOf, moduleExports, moduleSummary } from "../lib/stdlib";
import {
  addScript,
  addVariable,
  codeFileStore,
  deleteScript,
  deleteVariable,
  diagnosticsStore,
  moveScript,
  projectStore,
  renameScript,
  renameVariable,
  setCustomCode,
  setGameCursor,
  setLoopMode,
  setScriptCode,
  setVariableInit,
} from "../lib/store";

/* Code page = the scripting workspace. Three columns:
   - files: game-loop switch, your scripts (custom.ux hooks + modules),
     snippets/variables, the standard library, generated output;
   - editor: highlighted, Tab/indent aware, problems strip with
     jump-to-line (local validation live, compiler diagnostics after
     Check/Playtest/Export), Ctrl+S = Check;
   - reference: hooks (defined or one-click stub), every engine name
     the code may use for this loop, and the exports of every library
     module the open file imports — click to insert at the caret.
   File keys (codeFileStore): "custom.ux", a script path, "lib/<mod>",
   or a generated file name. */

const GENERATED = ["main.ux", "devices.ux", "assets.ux"];

const HOOK_STUBS: Record<HookName, string> = {
  custom_setup: "custom_setup :: fn() {\n    ( once, at boot )\n}\n",
  custom_frame: "custom_frame :: fn() {\n    ( every frame )\n}\n",
  custom_draw: "custom_draw :: fn() {\n    ( after the scene draws: HUD, overlays )\n}\n",
  custom_key: "custom_key :: fn() {\n    ( controller vector: latch Controller.key here, act in the frame )\n}\n",
  custom_mouse: "custom_mouse :: fn() {\n    ( mouse vector: latch Mouse.state here, act in the frame )\n}\n",
};

interface Problem {
  file: string | null;
  line: number | null;
  msg: string;
  source: "check" | "compile";
}

/** Local validation errors that name a file ("game.ux: …"). */
function localProblems(p: Project): Problem[] {
  return validateProject(p).map((msg) => {
    const m = msg.match(/^([A-Za-z][A-Za-z0-9_]*\.ux): /);
    return { file: m ? m[1] : null, line: null, msg, source: "check" as const };
  });
}

/** Compiler diagnostics → our file keys. custom.ux is spliced into
    main.ux, so main.ux lines inside that block map back to custom.ux. */
function mapDiagnostic(
  d: { file: string | null; line: number | null; msg: string },
  files: Record<string, string>,
  custom: string,
): Problem {
  const base = d.file ? d.file.slice(d.file.lastIndexOf("/") + 1) : null;
  if (base === "main.ux" && d.line && custom) {
    const main = (files["main.ux"] ?? "").split("\n");
    const start = main.findIndex((l) => l.startsWith("( --- custom.ux"));
    const text = main[d.line - 1];
    if (start >= 0 && d.line - 1 > start && text !== undefined) {
      const rel = d.line - 1 - start - 1;
      const src = custom.split("\n");
      for (let i = Math.max(0, rel); i < src.length; i++) {
        if (src[i] === text) return { file: "custom.ux", line: i + 1, msg: d.msg, source: "compile" };
      }
      const any = src.indexOf(text);
      if (any >= 0) return { file: "custom.ux", line: any + 1, msg: d.msg, source: "compile" };
    }
  }
  return { file: base, line: d.line, msg: d.msg, source: "compile" };
}

export default function CodeStudio() {
  const lang = useLang();
  const project = useStore(projectStore);
  const fileKey = useStore(codeFileStore);
  const diags = useStore(diagnosticsStore);
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkMsg, setCheckMsg] = useState<string | null>(null);
  const apiRef = useRef<EditorApi | null>(null);
  const liveOn = useStore(liveEnabledStore);
  const live = useStore(liveStatusStore);

  const isCode = project.kind === "code";
  const locked = !!project.locked;
  const loop = loopOf(project);
  const scripts = project.scripts ?? [];

  const files = useMemo(() => {
    try {
      return emitProject(project);
    } catch {
      return {} as Record<string, string>;
    }
  }, [project]);
  const hooks = useMemo(() => definedHooks(project), [project]);
  // Live check: every pause in editing streams the tree to /ws/check.
  useEffect(() => {
    if (liveOn) scheduleLiveCheck(project, lang);
  }, [project, liveOn, lang]);
  const libsUsed = useMemo(() => new Set(isCode ? [] : usedStdlib(project)), [project, isCode]);
  const problems = useMemo<Problem[]>(() => {
    if (isCode) return [];
    const local = localProblems(project);
    const compiled = diags.map((d) => mapDiagnostic(d, files, project.customCode ?? ""));
    return [...local, ...compiled];
  }, [project, diags, files, isCode]);

  // ---- resolve the open document ----
  const codeTabs = isCode ? Object.keys(project.codeFiles ?? {}) : [];
  const snippet = null as { id: string; code: string } | null;
  const script = scripts.find((s) => s.path === fileKey) ?? null;
  const libName = fileKey.startsWith("lib/") ? fileKey.slice(4) : null;
  let key = fileKey;
  if (isCode && !codeTabs.includes(key)) key = codeTabs[0] ?? "main.ux";
  if (!isCode && !script && !libName && key !== "custom.ux" && !(key in files)) key = loop === "script" ? "custom.ux" : "main.ux";

  let text = "";
  let title = key;
  let editable = false;
  let onEdit: ((v: string) => void) | undefined;
  if (isCode) {
    text = project.codeFiles?.[key] ?? "";
  } else if (script) {
    text = script.code;
    editable = !locked;
    onEdit = (v) => setScriptCode(script.path, v);
  } else if (libName) {
    text = STDLIB[libName] ?? "";
    title = libName;
  } else if (key === "custom.ux") {
    text = project.customCode ?? "";
    editable = !locked;
    onEdit = setCustomCode;
  } else {
    text = files[key] ?? "";
  }
  const openFile = snippet ? null : libName ?? key;

  const lineCount = text === "" ? 1 : text.split("\n").length;
  const symbols = useMemo(() => outline(text), [text]);
  const hits = useMemo(() => {
    if (!query) return [];
    const q = query.toLowerCase();
    const out: number[] = [];
    text.split("\n").forEach((ln, i) => {
      if (ln.toLowerCase().includes(q)) out.push(i + 1);
    });
    return out;
  }, [text, query]);
  const errorLines = useMemo(
    () => new Set(problems.filter((x) => x.file === openFile && x.line).map((x) => x.line as number)),
    [problems, openFile],
  );
  const imported = useMemo(() => importsOf(text).filter((n) => n in STDLIB), [text]);

  function open(k: string) {
    codeFileStore.set(k);
        setQuery("");
  }

  function jump(pr: Problem) {
    if (pr.file && pr.file !== openFile) {
      const k = pr.file in STDLIB && !scripts.some((s) => s.path === pr.file) ? `lib/${pr.file}` : pr.file;
      open(k);
    }
    if (pr.line) {
      const line = pr.line;
      requestAnimationFrame(() => requestAnimationFrame(() => apiRef.current?.goto(line)));
    }
  }

  async function check() {
    setChecking(true);
    setCheckMsg(null);
    try {
      const r = await compileProject(projectStore.get(), "web", "rom", lang);
      diagnosticsStore.set(r.diagnostics ?? []);
      setCheckMsg(r.ok ? t(lang, "code.check_ok") : r.message);
    } catch {
      setCheckMsg(t(lang, "exp.offline"));
    } finally {
      setChecking(false);
    }
  }

  /** Insert at the caret when the open file is editable; else copy. */
  function use(snippetText: string) {
    if (editable && apiRef.current) {
      apiRef.current.insert(snippetText);
      return;
    }
    void navigator.clipboard?.writeText(snippetText).catch(() => undefined);
    setNote(t(lang, "code.copied_ref"));
    window.setTimeout(() => setNote(null), 1500);
  }

  function addHook(h: HookName) {
    const cur = project.customCode ?? "";
    setCustomCode(`${cur.replace(/\s*$/, "")}${cur.trim() ? "\n\n" : ""}${HOOK_STUBS[h]}`);
    open("custom.ux");
  }

  function addImport(mod: string) {
    if (!editable || !onEdit) {
      use(`import "${mod}"`);
      return;
    }
    if (importsOf(text).includes(mod)) return;
    const lines = text.split("\n");
    let at = 0;
    lines.forEach((l, i) => {
      if (/^\s*import\s+"/.test(l)) at = i + 1;
    });
    if (at === 0) {
      // After a leading comment block, if any.
      const m = text.match(/^\s*\([\s\S]*?\)\s*\n/);
      at = m ? m[0].split("\n").length - 1 : 0;
    }
    lines.splice(at, 0, `import "${mod}"`);
    onEdit(lines.join("\n"));
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard denied */
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = snippet ? `${snippet.id}.ux` : (libName ?? key);
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  const rowCls = (active: boolean) =>
    `flex w-full items-center gap-2 rounded-lg px-2 py-1.5 font-mono text-[12px] transition-colors ${
      active ? "seg-active" : "text-subtext0 hover:bg-surface0 hover:text-text"
    }`;
  const muted = (active: boolean) => `ml-auto shrink-0 text-[10px] ${active ? "seg-active-muted" : "text-overlay0"}`;
  const head = "font-mono text-[11px] uppercase tracking-widest text-subtext0";
  const iconBtn = "grid size-6 shrink-0 place-items-center rounded-md text-subtext0 transition-colors hover:bg-surface0 hover:text-text";
  const lines = (s: string) => (s === "" ? 1 : s.split("\n").length);

  const assets = scriptAssetNames(project);
  const refGroups: Array<{ title: string; items: Array<{ label: string; insert: string }> }> = isCode
    ? []
    : loop === "script"
      ? [
          { title: t(lang, "ref.sprites"), items: assets.sprites.map((id) => ({ label: `&spr_${id}`, insert: `&spr_${id}` })) },
          { title: t(lang, "ref.sounds"), items: assets.sounds.map((id) => ({ label: `snd_${id}()`, insert: `snd_${id}();` })) },
          { title: t(lang, "ref.vars"), items: assets.vars.map((id) => ({ label: `var_${id}[0]`, insert: `var_${id}[0]` })) },
          { title: t(lang, "ref.inputs"), items: assets.inputs.map((id) => ({ label: `KEY_${id.toUpperCase()}`, insert: `KEY_${id.toUpperCase()}` })) },
          {
            title: t(lang, "ref.devices"),
            items: ["Screen.x", "Screen.y", "Screen.addr", "Screen.sprite", "Screen.pixel", "Controller.button", "Controller.key", "Mouse.x", "Mouse.y", "Mouse.state", "Audio0.pitch", "DateTime.second"].map(
              (x) => ({ label: x, insert: x }),
            ),
          },
        ]
      : [
          { title: t(lang, "ref.scenes"), items: project.scenes.map((s) => ({ label: `SC_${s.id.toUpperCase()}`, insert: `scene_go(SC_${s.id.toUpperCase()});` })) },
          { title: t(lang, "ref.vars"), items: assets.vars.map((id) => ({ label: `var_${id}[0]`, insert: `var_${id}[0]` })) },
          {
            title: t(lang, "ref.my_vars"),
            items: [...new Set((project.objectDefs ?? []).flatMap((d) => (d.vars ?? []).map((v) => v.id)))].map((id) => ({ label: `iv_${id}[self]`, insert: `iv_${id}[self]` })),
          },
          {
            title: t(lang, "ref.state"),
            items: ["self", "other", "ox[self]", "oy[self]", "ocell[self]", "oflags[self]", "ocount", "scene"].map((x) => ({ label: x, insert: x })),
          },
          { title: t(lang, "ref.sprites"), items: assets.sprites.map((id) => ({ label: `&spr_${id}`, insert: `&spr_${id}` })) },
        ];

  return (
    <div className="absolute inset-0 overflow-hidden bg-base">
      <div className="grid h-full gap-3 p-3 lg:grid-cols-[256px_minmax(0,1fr)_272px]">
        {/* ---------- files ---------- */}
        <section className="dock min-h-0 overflow-y-auto rounded-2xl p-3">
          {isCode ? (
            <>
              <p className={head}>{t(lang, "code.files")}</p>
              <ul className="mt-2 space-y-0.5">
                {codeTabs.map((f) => (
                  <li key={f}>
                    <button onClick={() => open(f)} className={rowCls(key === f)}>
                      <span className="truncate">{f}</span>
                      <span className={muted(key === f)}>{lines(project.codeFiles?.[f] ?? "")} ln</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <p className={head}>{t(lang, "loop.title")}</p>
              <div role="radiogroup" aria-label={t(lang, "loop.title")} className="mt-2 grid grid-cols-2 gap-1 rounded-lg border border-surface0 p-1">
                {(["engine", "script"] as const).map((m) => (
                  <button
                    key={m}
                    role="radio"
                    aria-checked={loop === m}
                    disabled={locked}
                    title={locked ? t(lang, "locked.note") : undefined}
                    onClick={() => setLoopMode(m)}
                    className={`rounded-md px-2 py-1 font-mono text-[11px] transition-colors disabled:cursor-not-allowed ${
                      loop === m ? "seg-active" : "text-subtext0 hover:bg-surface0 hover:text-text"
                    }`}
                  >
                    {t(lang, m === "engine" ? "loop.engine" : "loop.script")}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-overlay0">
                {t(lang, loop === "engine" ? "loop.engine_hint" : "loop.script_hint")}
              </p>
              <label
                className={`mt-2 flex items-start gap-2 text-[11px] leading-snug text-subtext0 ${locked ? "cursor-not-allowed" : "cursor-pointer"}`}
                title={t(lang, "loop.game_cursor_hint")}
              >
                <input
                  type="checkbox"
                  checked={!!project.gameCursor}
                  disabled={locked}
                  onChange={(e) => setGameCursor(e.target.checked)}
                  className="mt-0.5 accent-mauve"
                />
                <span>{t(lang, "loop.game_cursor")}</span>
              </label>

              <div className="mt-4 flex items-center justify-between">
                <p className={head}>
                  {t(lang, "code.scripts")} ({1 + scripts.length})
                </p>
                {!locked && (
                  <button
                    onClick={() => {
                      const name = window.prompt(t(lang, "code.script_name"), "game");
                      if (name !== null) setNote(addScript(name));
                    }}
                    title={t(lang, "code.script_add")}
                    aria-label={t(lang, "code.script_add")}
                    className={iconBtn}
                  >
                    <Plus size={13} />
                  </button>
                )}
              </div>
              <ul className="mt-2 space-y-0.5">
                <li>
                  <button onClick={() => open("custom.ux")} className={rowCls(!snippet && key === "custom.ux")}>
                    <FileCode2 size={12} className="shrink-0" />
                    <span className="truncate">custom.ux</span>
                    <span className={muted(!snippet && key === "custom.ux")}>{t(lang, "code.hooks_badge")}</span>
                  </button>
                </li>
                {scripts.map((s, i) => {
                  const active = !snippet && key === s.path;
                  const bad = problems.some((x) => x.file === s.path);
                  return (
                    <li key={s.path} className="group relative">
                      <button onClick={() => open(s.path)} className={rowCls(active)}>
                        <FileCode2 size={12} className={`shrink-0 ${bad ? "text-red" : ""}`} />
                        <span className="truncate">{s.path}</span>
                        <span className={`${muted(active)} ${locked ? "" : "group-hover:invisible"}`}>{lines(s.code)} ln</span>
                      </button>
                      {!locked && (
                        <span className="absolute right-1 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 group-hover:flex">
                          <button onClick={() => moveScript(s.path, -1)} disabled={i === 0} aria-label={t(lang, "code.move_up")} className={`${iconBtn} size-5 disabled:opacity-30`}>
                            <ArrowUp size={11} />
                          </button>
                          <button onClick={() => moveScript(s.path, 1)} disabled={i === scripts.length - 1} aria-label={t(lang, "code.move_down")} className={`${iconBtn} size-5 disabled:opacity-30`}>
                            <ArrowDown size={11} />
                          </button>
                          <button
                            onClick={() => {
                              const name = window.prompt(t(lang, "sound.rename"), s.path.replace(/\.ux$/, ""));
                              if (name !== null) setNote(renameScript(s.path, name));
                            }}
                            aria-label={`${t(lang, "sound.rename")} ${s.path}`}
                            className={`${iconBtn} size-5`}
                          >
                            <Pencil size={11} />
                          </button>
                          <button
                            onClick={() => {
                              if (window.confirm(`${t(lang, "code.script_delete")} ${s.path}?`)) setNote(deleteScript(s.path));
                            }}
                            aria-label={`${t(lang, "insp.remove")} ${s.path}`}
                            className={`${iconBtn} size-5 hover:text-red`}
                          >
                            <Trash2 size={11} />
                          </button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              {scripts.length === 0 && <p className="mt-1.5 text-[11px] leading-relaxed text-overlay0">{t(lang, "code.scripts_empty")}</p>}

              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <p className={head}>
                    {t(lang, "code.variables")} ({(project.vars ?? []).length})
                  </p>
                  {!locked && (
                    <button onClick={() => addVariable("var")} title={t(lang, "code.var_add")} aria-label={t(lang, "code.var_add")} className={iconBtn}>
                      <Plus size={13} />
                    </button>
                  )}
                </div>
                {(project.vars ?? []).length === 0 ? (
                  <p className="mt-2 font-mono text-[11px] leading-relaxed text-overlay0">{t(lang, "code.vars_empty")}</p>
                ) : (
                  <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                    {(project.vars ?? []).map((v) => (
                      <li key={v.id} className="flex items-center gap-1.5 rounded-lg border border-surface0 px-2 py-1">
                        <button
                          onClick={() => {
                            if (locked) return;
                            const name = window.prompt(t(lang, "sound.rename"), v.id);
                            if (name !== null) setNote(renameVariable(v.id, name) ?? null);
                          }}
                          title={v.id}
                          className="min-w-0 flex-1 truncate text-left font-mono text-[12px] hover:text-teal"
                        >
                          {v.id}
                        </button>
                        <input
                          type="number"
                          value={v.init}
                          min={0}
                          max={65535}
                          disabled={locked}
                          onChange={(e) => {
                            const n = Math.round(e.target.valueAsNumber);
                            if (!Number.isNaN(n)) setNote(setVariableInit(v.id, n) ?? null);
                          }}
                          aria-label={t(lang, "code.var_init")}
                          className="w-16 rounded-md border border-surface1 bg-base px-1.5 py-1 text-right font-mono text-[11px] outline-none focus:border-mauve"
                        />
                        {!locked && (
                          <button onClick={() => setNote(deleteVariable(v.id) ?? null)} title={t(lang, "insp.remove")} aria-label={`${t(lang, "insp.remove")} ${v.id}`} className={`${iconBtn} hover:text-red`}>
                            <Trash2 size={12} />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <p className={`${head} mt-4`}>{t(lang, "code.library")}</p>
              <ul className="mt-2 max-h-56 space-y-0.5 overflow-y-auto">
                {STDLIB_NAMES.map((n) => {
                  const active = !snippet && libName === n;
                  return (
                    <li key={n}>
                      <button onClick={() => open(`lib/${n}`)} title={moduleSummary(n)} className={rowCls(active)}>
                        <Library size={12} className="shrink-0" />
                        <span className="truncate">{n}</span>
                        {libsUsed.has(n) && <span className={muted(active)}>{t(lang, "code.lib_used")}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>

              <p className={`${head} mt-4`}>{t(lang, "code.generated")}</p>
              <ul className="mt-2 space-y-0.5">
                {GENERATED.filter((f) => f in files).map((f) => (
                  <li key={f}>
                    <button onClick={() => open(f)} className={rowCls(!snippet && key === f)}>
                      <span className="truncate">{f}</span>
                      <span className={muted(!snippet && key === f)}>{lines(files[f] ?? "")} ln</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          <p className={`${head} mb-2 mt-4`}>{t(lang, "studio.symbols")}</p>
          {symbols.length === 0 ? (
            <p className="font-mono text-[11px] text-overlay0">—</p>
          ) : (
            <ul className="max-h-64 space-y-0.5 overflow-y-auto">
              {symbols.map((s, i) => (
                <li key={i}>
                  <button
                    onClick={() => apiRef.current?.goto(s.line)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1 font-mono text-[11px] text-subtext0 transition-colors hover:bg-surface0 hover:text-text"
                  >
                    <span className="truncate text-text">{s.name}</span>
                    <span className="ml-auto shrink-0 text-overlay0">
                      {s.kind}:{s.line}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---------- editor ---------- */}
        <section className="dock flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-surface0 p-2.5">
            <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${editable ? "bg-teal/15 text-teal" : "tint-text-10 text-subtext1"}`}>
              {editable ? t(lang, "studio.editable") : t(lang, "studio.readonly")}
            </span>
            <span className="font-mono text-[11px] text-subtext0">
              {title} · {lineCount} {t(lang, "studio.lines")}
            </span>
            <span className="ml-auto flex items-center gap-1">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t(lang, "studio.find")}
                className="w-32 rounded-md border border-surface1 bg-base px-2 py-1 font-mono text-[11px] outline-none placeholder:text-overlay0 focus:border-mauve"
              />
              {query && <span className="font-mono text-[10px] text-overlay0">{hits.length}</span>}
              <button onClick={() => void copy()} title={t(lang, "code.copy")} aria-label={t(lang, "code.copy")} className="grid size-7 place-items-center rounded-md text-subtext0 hover:bg-surface0 hover:text-text">
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
              <button onClick={download} title={t(lang, "code.download")} aria-label={t(lang, "code.download")} className="grid size-7 place-items-center rounded-md text-subtext0 hover:bg-surface0 hover:text-text">
                <Download size={13} />
              </button>
              <button
                onClick={() => setLiveEnabled(!liveOn)}
                aria-pressed={liveOn}
                title={t(lang, "code.live_hint")}
                className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] ${liveOn ? "bg-surface0 text-text" : "text-overlay0 hover:bg-surface0"}`}
              >
                <span
                  className={`size-2 rounded-full ${
                    !liveOn || live.state === "off"
                      ? "bg-overlay0"
                      : live.state === "ok"
                        ? "bg-green"
                        : live.state === "error"
                          ? "bg-red"
                          : live.state === "offline"
                            ? "bg-peach"
                            : "animate-pulse bg-blue"
                  }`}
                />
                {t(lang, "code.live")}
                {liveOn && live.state !== "off" && live.state !== "idle" && (
                  <span className="text-subtext0">
                    {live.state === "ok"
                      ? t(lang, "code.live_ok").replace("{ms}", String(live.ms ?? 0)).replace("{bytes}", String(live.romBytes ?? 0))
                      : live.state === "error"
                        ? (live.count ? t(lang, "code.live_err").replace("{n}", String(live.count)) : live.message ?? "")
                        : live.state === "offline"
                          ? t(lang, live.message === "login" ? "code.live_login" : "code.live_offline")
                          : t(lang, "code.live_busy")}
                  </span>
                )}
              </button>
              <button
                onClick={() => void check()}
                disabled={checking}
                title={t(lang, "code.check_hint")}
                className="inline-flex items-center gap-1.5 rounded-md bg-surface0 px-2.5 py-1 font-mono text-[11px] text-text hover:bg-surface1 disabled:opacity-60"
              >
                {checking ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                {t(lang, "code.check")}
              </button>
            </span>
          </div>
          {query && hits.length > 0 && (
            <div className="flex gap-1 overflow-x-auto border-b border-surface0 px-2.5 py-1.5">
              {hits.slice(0, 40).map((ln) => (
                <button key={ln} onClick={() => apiRef.current?.goto(ln)} className="shrink-0 rounded-md bg-surface0 px-2 py-0.5 font-mono text-[10px] text-subtext0 hover:text-text">
                  {ln}
                </button>
              ))}
              {hits.length > 40 && <span className="font-mono text-[10px] text-overlay0">+{hits.length - 40}</span>}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-auto">
            <CodeEditor
              key={snippet ? `snip:${snippet.id}` : `file:${libName ?? key}`}
              value={text}
              onChange={onEdit}
              readOnly={!editable}
              apiRef={apiRef}
              errorLines={errorLines}
              onSave={() => void check()}
            />
          </div>
          {!isCode && (
            <div className="max-h-36 shrink-0 overflow-y-auto border-t border-surface0">
              <div className="flex items-center gap-2 px-3 py-1.5">
                {problems.length === 0 ? (
                  <CheckCircle2 size={12} className="text-green" />
                ) : (
                  <AlertTriangle size={12} className="text-red" />
                )}
                <span className="font-mono text-[10px] uppercase tracking-widest text-subtext0">
                  {t(lang, "code.problems")} ({problems.length})
                </span>
                {(checkMsg || note) && <span className="truncate font-mono text-[11px] text-subtext0">· {note ?? checkMsg}</span>}
              </div>
              {problems.length > 0 && (
                <ul className="pb-1.5">
                  {problems.slice(0, 50).map((pr, i) => (
                    <li key={i}>
                      <button
                        onClick={() => jump(pr)}
                        className="flex w-full items-baseline gap-2 px-3 py-0.5 text-left font-mono text-[11px] text-subtext0 hover:bg-surface0 hover:text-text"
                      >
                        <span className={`shrink-0 ${pr.source === "compile" ? "text-red" : "text-yellow"}`}>
                          {pr.source === "compile" ? t(lang, "code.p_compile") : t(lang, "code.p_check")}
                        </span>
                        {pr.file && (
                          <span className="shrink-0 text-overlay0">
                            {pr.file}
                            {pr.line ? `:${pr.line}` : ""}
                          </span>
                        )}
                        <span className="min-w-0 break-words">{pr.msg}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <p className="border-t border-surface0 px-3 py-1.5 font-mono text-[10px] text-overlay0">{footNote(lang, isCode, editable, !!libName, loop)}</p>
        </section>

        {/* ---------- reference ---------- */}
        <section className="dock min-h-0 overflow-y-auto rounded-2xl p-3">
          {isCode ? (
            <p className="font-mono text-[11px] leading-relaxed text-subtext0">{t(lang, "code.side_note")}</p>
          ) : (
            <>
              <p className={head}>{t(lang, "ref.hooks")}</p>
              <ul className="mt-2 space-y-1">
                {HOOKS.filter((h) => loop === "engine" || h !== "custom_draw").map((h) => {
                  const has = hooks.has(h);
                  const required = loop === "script" && h === "custom_frame";
                  return (
                    <li key={h} className="rounded-lg border border-surface0 px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className={`font-mono text-[11px] ${has ? "text-text" : "text-subtext0"}`}>{h}()</span>
                        {required && !has && <span className="font-mono text-[9px] uppercase text-red">{t(lang, "ref.required")}</span>}
                        {has ? (
                          <Check size={12} className="ml-auto text-green" aria-label={t(lang, "ref.defined")} />
                        ) : (
                          !locked && (
                            <button onClick={() => addHook(h)} className="ml-auto rounded px-1.5 py-0.5 font-mono text-[10px] text-mauve hover:bg-surface0">
                              + {t(lang, "ref.add_hook")}
                            </button>
                          )
                        )}
                      </div>
                      <p className="mt-0.5 text-[11px] leading-snug text-overlay0">{t(lang, `hook.${h}.${loop}`)}</p>
                    </li>
                  );
                })}
              </ul>

              <p className={`${head} mt-4`}>{t(lang, loop === "script" ? "ref.names_script" : "ref.names_engine")}</p>
              <p className="mt-1 text-[11px] leading-snug text-overlay0">{t(lang, editable ? "ref.click_insert" : "ref.click_copy")}</p>
              {refGroups
                .filter((g) => g.items.length > 0)
                .map((g) => (
                  <div key={g.title} className="mt-2">
                    <p className="font-mono text-[10px] text-overlay0">{g.title}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {g.items.map((it) => (
                        <button
                          key={it.label}
                          onClick={() => use(it.insert)}
                          className="rounded bg-surface0 px-1.5 py-0.5 font-mono text-[10px] text-sky hover:bg-surface1"
                        >
                          {it.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

              <p className={`${head} mt-4`}>{t(lang, "ref.library")}</p>
              {(libName ? [libName] : imported).length === 0 ? (
                <p className="mt-1 text-[11px] leading-snug text-overlay0">{t(lang, "ref.library_empty")}</p>
              ) : (
                (libName ? [libName] : imported).map((mod) => (
                  <div key={mod} className="mt-2">
                    <p className="font-mono text-[10px] text-overlay0">
                      {mod} <span className="text-overlay0/70">— {moduleSummary(mod)}</span>
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {moduleExports(STDLIB[mod]).map((x) => (
                        <button
                          key={x.name}
                          onClick={() => use(x.kind === "fn" || x.kind === "macro" ? `${x.sig};` : x.sig)}
                          title={x.kind}
                          className={`rounded bg-surface0 px-1.5 py-0.5 font-mono text-[10px] hover:bg-surface1 ${
                            x.kind === "macro" || x.kind === "fn" ? "text-mauve" : "text-peach"
                          }`}
                        >
                          {x.sig}
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
              {!libName && editable && (
                <div className="mt-3">
                  <p className="font-mono text-[10px] text-overlay0">{t(lang, "ref.add_import")}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {STDLIB_NAMES.filter((n) => !imported.includes(n)).map((n) => (
                      <button key={n} onClick={() => addImport(n)} title={moduleSummary(n)} className="rounded border border-surface0 px-1.5 py-0.5 font-mono text-[10px] text-subtext0 hover:bg-surface0 hover:text-text">
                        + {n}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function footNote(lang: Lang, isCode: boolean, editable: boolean, isLib: boolean, loop: "engine" | "script"): string {
  if (isCode) return t(lang, "code.hand_note");
  if (isLib) return t(lang, "code.lib_note");
  if (!editable) return t(lang, "code.note");
  return t(lang, loop === "script" ? "code.script_note" : "code.custom_note");
}
