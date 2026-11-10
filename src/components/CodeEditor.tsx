import { useMemo, useRef } from "react";

/* Highlighted ETAL editor (textarea over a colored <pre>).
   Coloring lives in the WEBPAGE, not the compiler, on purpose: the
   compiler owns the grammar (and its file:line:col diagnostics stay
   the arbiter), while color is presentation — theme, density and
   navigation choices that must never change emitted bytes. This
   highlighter is a regex/stack projection of ETAL/Uxntal, good enough
   to read; `POST /compile` failures still win over any color here. */

export type Tok = { text: string; kind: "plain" | "comment" | "string" | "directive" | "port" | "keyword" | "type" | "number" };

const KEYWORDS = new Set([
  "fn", "event", "device", "buffer", "data", "group", "struct", "macro",
  "import", "return", "if", "elif", "else", "while", "for", "match",
  "brk", "print", "assert", "meta", "is",
]);
const TYPES = new Set(["u8", "u16", "i8", "i16", "bool", "void", "mod"]);

const KIND_COLOR: Record<Tok["kind"], string> = {
  plain: "var(--ctp-text)",
  comment: "var(--ctp-overlay0)",
  string: "var(--ctp-green)",
  directive: "var(--ctp-yellow)",
  port: "var(--ctp-sky)",
  keyword: "var(--ctp-mauve)",
  type: "var(--ctp-teal)",
  number: "var(--ctp-peach)",
};

export function tokenize(src: string): Tok[][] {
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

export interface CodeSymbol {
  line: number;
  name: string;
  kind: string;
}

export function outline(src: string): CodeSymbol[] {
  const out: CodeSymbol[] = [];
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
const INDENT = "    ";

/** Imperative handle the Code page drives: jump to a line, insert at
    the caret (replacing the selection). */
export interface EditorApi {
  goto: (line: number) => void;
  insert: (text: string) => void;
}

function Lines({ lines }: { lines: Tok[][] }) {
  return (
    <>
      {lines.map((row, i) => (
        <div key={i}>
          {row.length === 0
            ? " "
            : row.map((s, k) => (
                <span key={k} style={{ color: KIND_COLOR[s.kind], fontStyle: s.kind === "comment" ? "italic" : undefined }}>
                  {s.text}
                </span>
              ))}
        </div>
      ))}
    </>
  );
}

export default function CodeEditor({
  value,
  onChange,
  readOnly,
  apiRef,
  errorLines,
  onSave,
}: {
  value: string;
  onChange?: (v: string) => void;
  readOnly: boolean;
  apiRef: React.MutableRefObject<EditorApi | null>;
  /** 1-based lines with problems: red gutter numbers + a line wash. */
  errorLines?: Set<number>;
  /** Ctrl/Cmd+S. */
  onSave?: () => void;
}) {
  const lines = useMemo(() => tokenize(value), [value]);
  const preRef = useRef<HTMLPreElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const gutRef = useRef<HTMLDivElement>(null);
  const washRef = useRef<HTMLDivElement>(null);

  const offsetOf = (line: number): number => {
    let off = 0;
    const raw = value.split("\n");
    for (let k = 0; k < line - 1 && k < raw.length; k++) off += raw[k].length + 1;
    return off;
  };

  /** Replace [a, b) with text, keep the caret after it. */
  const splice = (a: number, b: number, text: string, caret = a + text.length): void => {
    if (!onChange) return;
    onChange(value.slice(0, a) + text + value.slice(b));
    requestAnimationFrame(() => {
      const el = areaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  apiRef.current = {
    goto: (line: number) => {
      const y = Math.max(0, (line - 1) * LINE_H - 60);
      if (readOnly) {
        preRef.current?.parentElement?.parentElement?.scrollTo({ top: y });
        return;
      }
      const el = areaRef.current;
      if (!el) return;
      el.focus();
      el.scrollTop = y;
      const off = offsetOf(line);
      el.setSelectionRange(off, off + (value.split("\n")[line - 1]?.length ?? 0));
    },
    insert: (text: string) => {
      const el = areaRef.current;
      if (readOnly || !el) return;
      splice(el.selectionStart, el.selectionEnd, text);
    },
  };

  const sync = () => {
    const a = areaRef.current;
    if (!a) return;
    if (preRef.current) {
      preRef.current.scrollTop = a.scrollTop;
      preRef.current.scrollLeft = a.scrollLeft;
    }
    const ty = `translateY(${-a.scrollTop}px)`;
    if (gutRef.current) gutRef.current.style.transform = ty;
    if (washRef.current) washRef.current.style.transform = ty;
  };

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      onSave?.();
      return;
    }
    const a = el.selectionStart;
    const b = el.selectionEnd;
    if (e.key === "Tab") {
      e.preventDefault();
      const lineStart = value.lastIndexOf("\n", a - 1) + 1;
      if (a === b && !e.shiftKey) {
        splice(a, b, INDENT);
        return;
      }
      // Block (de)indent over every touched line.
      const end = b > a && value[b - 1] === "\n" ? b - 1 : b;
      const block = value.slice(lineStart, end);
      const next = block
        .split("\n")
        .map((l) => (e.shiftKey ? l.replace(/^ {1,4}/, "") : INDENT + l))
        .join("\n");
      onChange?.(value.slice(0, lineStart) + next + value.slice(end));
      requestAnimationFrame(() => {
        areaRef.current?.setSelectionRange(lineStart, lineStart + next.length);
      });
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Keep the line's indent; one level deeper after an opening brace.
      e.preventDefault();
      const lineStart = value.lastIndexOf("\n", a - 1) + 1;
      const cur = value.slice(lineStart, a);
      let indent = cur.match(/^\s*/)?.[0] ?? "";
      if (/\{\s*$/.test(cur)) indent += INDENT;
      splice(a, b, `\n${indent}`);
    }
  }

  const gutter = lines.map((_, i) => i + 1);
  const pad = "12px 12px 12px 56px";
  const gutterCls = (n: number) => `pr-2 ${errorLines?.has(n) ? "font-bold text-red" : ""}`;
  const wash = errorLines && errorLines.size > 0 && (
    <div ref={washRef} aria-hidden className="pointer-events-none absolute inset-x-0 top-3">
      {[...errorLines].map((n) => (
        <div key={n} className="absolute inset-x-0 bg-red/10" style={{ top: (n - 1) * LINE_H, height: LINE_H }} />
      ))}
    </div>
  );

  if (readOnly) {
    return (
      <div className="relative min-h-full">
        {wash}
        <div className="absolute bottom-0 left-0 top-0 w-11 select-none overflow-hidden pt-3 text-right font-mono text-[11px] leading-[18px] text-overlay0">
          {gutter.map((n) => (
            <div key={n} className={gutterCls(n)}>{n}</div>
          ))}
        </div>
        <pre ref={preRef} className="overflow-visible whitespace-pre font-mono text-[12px] leading-[18px]" style={{ padding: pad }}>
          <Lines lines={lines} />
        </pre>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-full overflow-hidden">
      {wash}
      <div className="absolute bottom-0 left-0 top-0 z-10 w-11 select-none overflow-hidden pt-3 text-right font-mono text-[11px] leading-[18px] text-overlay0">
        <div ref={gutRef}>
          {gutter.map((n) => (
            <div key={n} className={gutterCls(n)}>{n}</div>
          ))}
        </div>
      </div>
      <pre
        ref={preRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre font-mono text-[12px] leading-[18px]"
        style={{ padding: pad }}
      >
        <Lines lines={lines} />
      </pre>
      <textarea
        ref={areaRef}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        onScroll={sync}
        onKeyDown={onKeyDown}
        spellCheck={false}
        wrap="off"
        className="absolute inset-0 h-full w-full resize-none overflow-auto whitespace-pre bg-transparent font-mono text-[12px] leading-[18px] text-transparent outline-none"
        style={{ padding: pad, caretColor: "var(--ctp-text)" }}
      />
    </div>
  );
}
