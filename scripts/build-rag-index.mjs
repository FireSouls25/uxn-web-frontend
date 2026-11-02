// Build a tiny retrieval index from the agent corpus.
// Reads src/lib/agent/corpus/*.md, splits on ## headers (or paragraphs
// when no headers), writes src/lib/agent/corpus/index.json.
// Usage: npm run rag:build. Run after sync:rag when backend/rag changes.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "agent", "corpus");
const files = readdirSync(root).filter((f) => f.endsWith(".md"));

const chunks = [];
for (const file of files) {
  const raw = readFileSync(join(root, file), "utf-8");
  const parts = raw.split(/^## /m);
  const head = parts.shift() ?? "";
  if (head.trim()) {
    chunks.push({ id: `${file}#top`, source: file, title: file.replace(/\.md$/, ""), text: head.trim().slice(0, 1200) });
  }
  for (const part of parts) {
    const nl = part.indexOf("\n");
    const title = nl < 0 ? part.trim().slice(0, 80) : part.slice(0, nl).trim();
    const body = nl < 0 ? "" : part.slice(nl + 1).trim();
    const text = `## ${title}\n${body}`.trim().slice(0, 1200);
    if (text.length > 40) chunks.push({ id: `${file}#${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 48)}`, source: file, title, text });
  }
}

writeFileSync(join(root, "index.json"), JSON.stringify({ version: 1, count: chunks.length, chunks }, null, 2));
console.log(`rag index: ${chunks.length} chunks from ${files.length} files`);
