import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { STRINGS } from "./i18n";

/* i18n rule: every UI key used in markup/islands exists in BOTH
   languages. New strings go in the dictionary, never inline. */
function sources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(tsx|astro)$/.test(e.name)) out.push(readFileSync(p, "utf-8"));
    }
  };
  walk(join(__dirname, "..", "components"));
  walk(join(__dirname, "..", "pages"));
  walk(join(__dirname, "..", "layouts"));
  return out;
}

describe("i18n coverage", () => {
  it("every used key is defined in en and es", () => {
    const texts = sources().join("\n");
    const used = new Set<string>();
    for (const m of texts.matchAll(/data-i18n="([^"]+)"/g)) used.add(m[1]);
    for (const m of texts.matchAll(/data-title-key="([^"]+)"/g)) used.add(m[1]);
    for (const m of texts.matchAll(/t\(lang,\s*"([^"]+)"\)/g)) used.add(m[1]);
    const missing = [...used].filter((k) => !(k in STRINGS.en) || !(k in STRINGS.es));
    expect(missing).toEqual([]);
  });

  it("en and es define the same keys", () => {
    const en = new Set(Object.keys(STRINGS.en));
    const es = new Set(Object.keys(STRINGS.es));
    expect([...en].filter((k) => !es.has(k))).toEqual([]);
    expect([...es].filter((k) => !en.has(k))).toEqual([]);
  });
});
