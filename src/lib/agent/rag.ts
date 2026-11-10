/* In-page RAG: keyword retrieval over the bundled corpus index.
   No network, no embeddings download: scores chunks by token overlap
   against the query (title hits weigh double). The static SYSTEM_PROMPT
   in pi.ts stays the default; AgentChat prepends top-k chunks per user
   turn so the model sees relevant rules without the full dump. */
import index from "./corpus/index.json";
import { projectContext } from "./tools";

export interface RagChunk {
  id: string;
  source: string;
  title: string;
  text: string;
}

const CHUNKS = (index as { chunks: RagChunk[] }).chunks;

const STOP = new Set(
  "a,an,the,and,or,to,of,in,on,for,with,how,what,why,when,do,does,is,are,it,its,i,my,me,please,add,make,get,show".split(","),
);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/** Top-k chunks for a query, highest score first. Empty query → []. */
export function retrieveContext(query: string, k = 3): RagChunk[] {
  const qs = new Set(tokens(query));
  if (qs.size === 0) return [];
  const scored = CHUNKS.map((c) => {
    const titleToks = tokens(c.title);
    const bodyToks = new Set(tokens(c.text));
    let score = 0;
    for (const q of qs) {
      if (bodyToks.has(q)) score += 1;
      if (titleToks.includes(q)) score += 2;
      // prefix match: "anim" hits "animation"/"anims"
      if (score === 0) {
        for (const b of bodyToks) {
          if (b.startsWith(q) || q.startsWith(b)) {
            score += 0.5;
            break;
          }
        }
      }
    }
    return { c, score };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, k));
  return scored.map((s) => s.c);
}

/** Format chunks as a context block to prepend to the user message. */
export function formatContext(chunks: RagChunk[]): string {
  if (chunks.length === 0) return "";
  return `Relevant rules:\n${chunks.map((c) => `- [${c.source} › ${c.title}] ${c.text.slice(0, 500)}`).join("\n")}`;
}

/** The user turn the model sees: the CURRENT project (it changes
    between turns, by the user and by tools), the corpus sections most
    related to the request (emphasis; the full corpus is in the system
    prompt), then the request itself. */
export function buildPrompt(text: string, context: string = projectContext()): string {
  const rules = formatContext(retrieveContext(text, 2));
  return `Current project:\n${context}\n\n${rules ? `${rules}\n\n` : ""}User request: ${text}`;
}
