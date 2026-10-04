import { useMemo, useRef, useState } from "react";
import { useStore } from "@nanostores/react";
import { Check, Copy, Download } from "lucide-react";
import { t, useLang } from "../lib/i18n";
import { emitProject } from "../lib/project";
import { codeFileStore, currentIdStore, projectStore, projectsStore } from "../lib/store";

/* Full-page code studio.
   Coloring lives in the WEBPAGE, not the compiler, on purpose: the
   compiler owns the grammar (and its file:line:col diagnostics stay
   the arbiter), while color is presentation — theme, density and
   navigation choices that must never change emitted bytes. This
   highlighter is a regex/stack projection of ETAL/Uxntal, good enough
   to read; `POST /compile` failures still win over any color here. */

type Tok = { text: string; kind: "plain" | "comment" | "string" | "directive" | "port" | "keyword" | "type" | "number" };

const KEYWORDS = new Set([
  "fn", "event", "device", "buffer", "data", "group", "struct", "macro",
  "import", "return", "if", "elif", "else", "while", "for", "match",
  "brk", "print", "assert", "meta", "is",
]);
const TYPES = new Set(["u8", "u16", "i8", "i16", "bool", "void", "mod"]);

const KIND_COLOR: Record<Tok["kind"], string> = {
  plain: "var(--ctp-text)",
  comment: "#6b7280",
  string: "#a6e3a1",
  directive: "#f9e2af",
  port: "#89dceb",
  keyword: "#cba6f7",
  type: "#94e2d5",
  number: "#fab387",
};

function tokenize(src: string): Tok[][] {
  const lines: Tok[][] = [[]];
  let i = 0;
  let commentDepth = 0;
  const push = (text: string, kind: Tok["kind"]) => {
    if (!text) return;
    const parts = text.split("\n");
    parts.forEach((p, k) => {
      if (k > 0) lines.push([]);
      if (p) lines[lines.length - 1].push({ text: p, kind });
    });
  };
  const prevCode = (): string => {
    for (let j = lines.length - 1; j >= 0; j--) {
      const row = lines[j];
      for (let k = row.length - 1; k >= 0; k--) {
        const m = row[k].text.match(/(\S)\s*$/);
        if (m) return m[1];
      }
      const raw = src.slice(0, i).match(/(\S)\s*$/);
      if (raw) return raw[1];
      break;
    }
    const raw = src.slice(0, i).match(/(\S)\s*$/);
    return raw ? raw[1] : "";
  };
  while (i < src.length) {
    const c = src[i];
    if (commentDepth > 0) {
      if (c === "(") commentDepth++;
      if (c === ")") commentDepth--;
      push(c, "comment");
      i++;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"' && src[j] !== "\n") {
        if (src[j] === "\\") j++;
        j++;
      }
      if (src[j] === '"') j++;
      push(src.slice(i, j), "string");
      i = j;
      continue;
    }
    if (c === "(" && !/[A-Za-z0-9_\]\)]/.test(prevCode())) {
      commentDepth = 1;
      push(c, "comment");
      i++;
      continue;
    }
    if (c === "." && /[A-Za-z]/.test(src[i + 1] ?? "")) {
      const m = src.slice(i).match(/^\.[A-Za-z_][\w/]*/);
      push(m![0], "port");
      i += m![0].length;
      continue;
    }
    if ("@|;&#".includes(c)) {
      const m = src.slice(i).match(/^[@|;&#][A-Za-z0-9_]+/);
      if (m) {
        push(m[0], "directive");
        i += m[0].length;
        continue;
      }
      push(c, "plain");
      i++;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = src.slice(i).match(/^[A-Za-z_]\w*/)!;
      const w = m[0];
      push(w, KEYWORDS.has(w) ? "keyword" : TYPES.has(w) ? "type" : "plain");
      i += w.length;
      continue;
    }
    if (/[0-9]/.test(c)) {
      const m = src.slice(i).match(/^[0-9A-Fa-fx]*/)!;
      push(m[0], "number");
      i += m[0].length;
      continue;
    }
    push(c, "plain");
    i++;
  }
  return lines;
}

interface Symbol {
  line: number;
  name: string;
  kind: string;
}

function outline(src: string): Symbol[] {
  const out: Symbol[] = [];
  src.split("\n").forEach((ln, idx) => {
    const m = ln.match(/^\s*([A-Za-z_]\w*)\s*::\s*(fn|event|device|buffer|data|group|struct|macro)\b/);
    if (m) out.push({ line: idx + 1, name: m[1], kind: m[2] });
    else {
      const c = ln.match(/^\s*([A-Za-z_]\w*)\s*::/);
      if (c) out.push({ line: idx + 1, name: c[1], kind: "const" });
    }
  });
  return out;
}

const LINE_H = 18;

function CodeEditor({
  value,
  onChange,
  readOnly,
  gotoRef,
}: {
  value: string;
  onChange?: (v: string) => void;
  readOnly: boolean;
  gotoRef: React.MutableRefObject<((line: number) => void) | null>;
}) {
  const lines = useMemo(() => tokenize(value), [value]);
  const preRef = useRef<HTMLPreElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const gutRef = useRef<HTMLDivElement>(null);

  gotoRef.current = (line: number) => {
    const y = (line - 1) * LINE_H;
    if (readOnly) preRef.current?.scrollTo({ top: y - 60 });
    else if (areaRef.current) {
      areaRef.current.focus();
      areaRef.current.scrollTop = y - 60;
      let off = 0;
      const raw = value.split("\n");
      for (let k = 0; k < line - 1 && k < raw.length; k++) off += raw[k].length + 1;
      areaRef.current.setSelectionRange(off, off + (raw[line - 1]?.length ?? 0));
    }
  };

  const sync = () => {
    const a = areaRef.current;
    if (!a) return;
    if (preRef.current) {
      preRef.current.scrollTop = a.scrollTop;
      preRef.current.scrollLeft = a.scrollLeft;
    }
    if (gutRef.current) gutRef.current.style.transform = `translateY(${-a.scrollTop}px)`;
  };

  const gutter = lines.map((_, i) => i + 1);
  const pad = "12px 12px 12px 56px";

  if (readOnly) {
    return (
      <div className="relative min-h-full">
        <div ref={gutRef} className="absolute bottom-0 left-0 top-0 w-11 select-none overflow-hidden pt-3 text-right font-mono text-[11px] leading-[18px] text-overlay0">
          {gutter.map((n) => (
            <div key={n} className="pr-2">{n}</div>
          ))}
        </div>
        <pre
          ref={preRef}
          className="overflow-auto whitespace-pre p-3 font-mono text-[12px] leading-[18px]"
          style={{ padding: pad }}
        >
          {lines.map((row, i) => (
            <div key={i}>
              {row.length === 0 ? " " : row.map((s, k) => (
                <span key={k} style={{ color: KIND_COLOR[s.kind], fontStyle: s.kind === "comment" ? "italic" : undefined }}>
                  {s.text}
                </span>
              ))}
            </div>
          ))}
        </pre>
      </div>
    );
  }

  return (
    <div className="relative min-h-full">
      <div className="absolute bottom-0 left-0 top-0 z-10 w-11 select-none overflow-hidden pt-3 text-right font-mono text-[11px] leading-[18px] text-overlay0">
        <div ref={gutRef}>
          {gutter.map((n) => (
            <div key={n} className="pr-2">{n}</div>
          ))}
        </div>
      </div>
      <pre
        ref={preRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre p-3 font-mono text-[12px] leading-[18px]"
        style={{ padding: pad }}
      >
        {lines.map((row, i) => (
          <div key={i}>
            {row.length === 0 ? " " : row.map((s, k) => (
              <span key={k} style={{ color: KIND_COLOR[s.kind], fontStyle: s.kind === "comment" ? "italic" : undefined }}>
                {s.text}
              </span>
            ))}
          </div>
        ))}
      </pre>
      <textarea
        ref={areaRef}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        onScroll={sync}
        spellCheck={false}
        wrap="off"
        className="absolute inset-0 h-full w-full resize-none overflow-auto whitespace-pre bg-transparent p-3 font-mono text-[12px] leading-[18px] text-transparent outline-none"
        style={{ padding: pad, caretColor: "#fff" }}
      />
    </div>
  );
}

export default function CodeStudio() {
  const lang = useLang();
  const project = useStore(projectStore);
  const file = useStore(codeFileStore);
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState("");
  const gotoRef = useRef<((line: number) => void) | null>(null);

  const isCode = project.kind === "code";
  const tabs: string[] = isCode ? Object.keys(project.codeFiles ?? {}) : ["main.ux", "devices.ux", "custom.ux"];
  const active = tabs.includes(file) ? file : tabs[0];

  const files = useMemo(() => {
    try {
      return emitProject(project);
    } catch {
      return { "main.ux": "" } as Record<string, string>;
    }
  }, [project]);
  const custom = project.customCode ?? "";
  const customEditable = !isCode && !project.locked;
  const text = isCode ? (project.codeFiles?.[active] ?? files[active] ?? "") : active === "custom.ux" ? custom : (files[active] ?? "");
  const editable = !isCode && active === "custom.ux" && customEditable;

  function setCustom(v: string) {
    const id = currentIdStore.get();
    const all = projectsStore.get();
    const p = all[id];
    if (p && p.kind === "visual") projectsStore.set({ ...all, [id]: { ...p, customCode: v, updatedAt: Date.now() } });
  }

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

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard denied */ }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = active;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      <div className="grid h-full gap-3 p-3 lg:grid-cols-[248px_minmax(0,1fr)_264px]">
        <section className="dock min-h-0 overflow-y-auto rounded-2xl p-3">
          <p className="font-mono text-[11px] uppercase tracking-widest text-subtext0">{t(lang, "code.files")}</p>
          <ul className="mt-2 space-y-0.5">
            {tabs.map((f) => {
              const body = isCode ? (project.codeFiles?.[f] ?? "") : f === "custom.ux" ? custom : (files[f] ?? "");
              const n = body === "" ? 1 : body.split("\n").length;
              return (
                <li key={f}>
                  <button
                    onClick={() => codeFileStore.set(f)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 font-mono text-[12px] transition-colors ${
                      active === f ? "bg-white text-black" : "text-subtext0 hover:bg-surface0 hover:text-text"
                    }`}
                  >
                    <span className="truncate">{f}</span>
                    <span className={`ml-auto shrink-0 text-[10px] ${active === f ? "text-black/60" : "text-overlay0"}`}>{n} ln</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mb-2 mt-4 font-mono text-[11px] uppercase tracking-widest text-subtext0">{t(lang, "studio.symbols")}</p>
          {symbols.length === 0 ? (
            <p className="font-mono text-[11px] text-overlay0">—</p>
          ) : (
            <ul className="max-h-64 space-y-0.5 overflow-y-auto">
              {symbols.map((s, i) => (
                <li key={i}>
                  <button
                    onClick={() => gotoRef.current?.(s.line)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1 font-mono text-[11px] text-subtext0 transition-colors hover:bg-surface0 hover:text-text"
                  >
                    <span className="truncate text-text">{s.name}</span>
                    <span className="ml-auto shrink-0 text-overlay0">{s.kind}:{s.line}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="dock flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-surface0 p-2.5">
            <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${editable ? "bg-teal/15 text-teal" : "bg-white/10 text-subtext1"}`}>
              {editable ? t(lang, "studio.editable") : t(lang, "studio.readonly")}
            </span>
            <span className="font-mono text-[11px] text-subtext0">{active} · {lineCount} {t(lang, "studio.lines")}</span>
            <span className="ml-auto flex items-center gap-1">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t(lang, "studio.find")}
                className="w-36 rounded-md border border-surface1 bg-base px-2 py-1 font-mono text-[11px] outline-none placeholder:text-overlay0 focus:border-mauve"
              />
              {query && <span className="font-mono text-[10px] text-overlay0">{hits.length}</span>}
              <button onClick={() => void copy()} title={t(lang, "code.copy")} className="grid size-7 place-items-center rounded-md text-subtext0 hover:bg-surface0 hover:text-text">
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
              <button onClick={download} title={t(lang, "code.download")} className="grid size-7 place-items-center rounded-md text-subtext0 hover:bg-surface0 hover:text-text">
                <Download size={13} />
              </button>
            </span>
          </div>
          {query && hits.length > 0 && (
            <div className="flex gap-1 overflow-x-auto border-b border-surface0 px-2.5 py-1.5">
              {hits.slice(0, 40).map((ln) => (
                <button
                  key={ln}
                  onClick={() => gotoRef.current?.(ln)}
                  className="shrink-0 rounded-md bg-surface0 px-2 py-0.5 font-mono text-[10px] text-subtext0 hover:text-text"
                >
                  {ln}
                </button>
              ))}
              {hits.length > 40 && <span className="font-mono text-[10px] text-overlay0">+{hits.length - 40}</span>}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-auto">
            <CodeEditor value={text} onChange={setCustom} readOnly={!editable} gotoRef={gotoRef} />
          </div>
          <p className="border-t border-surface0 px-3 py-1.5 font-mono text-[10px] text-overlay0">
            {isCode ? t(lang, "code.hand_note") : active === "custom.ux" ? t(lang, "code.custom_note") : t(lang, "code.note")}
          </p>
        </section>
        <section className="dock h-fit rounded-2xl p-3 lg:sticky lg:top-3">
          <p className="font-mono text-[11px] uppercase tracking-widest text-subtext0">{t(lang, "studio.symbols")}</p>
          <p className="mt-2 font-mono text-[11px] leading-relaxed text-subtext0">
            {t(lang, "code.side_note")}
          </p>
          <div className="mt-3 space-y-1 font-mono text-[11px]">
            {[
              ["( … )", "#6b7280"],
              ["\"str\"", "#a6e3a1"],
              ["fn event", "#cba6f7"],
              ["u8 u16", "#94e2d5"],
              ["@ | ; &", "#f9e2af"],
              [".dev/port", "#89dceb"],
            ].map(([s, c]) => (
              <div key={s} className="flex items-center gap-2">
                <span className="rounded bg-surface0 px-1.5 py-0.5" style={{ color: c }}>{s}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
