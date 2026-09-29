import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Bot, Loader2, Send, X } from "lucide-react";
import type { Agent } from "@mariozechner/pi-agent-core";
import { t, useLang, type Lang } from "../../lib/i18n";
import { createStudioAgent } from "../../lib/agent/pi";

interface Message {
  role: "user" | "agent" | "note" | "tool";
  text?: string;
  key?: string;
}

function render(m: Message, lang: Lang): string {
  if (m.key) return t(lang, m.key);
  return m.text ?? "";
}

/* Every failure is a status, never a backend string: the user reads
   their own language and learns nothing about which provider exists.
   The pi loop reports failures as a finished message with
   stopReason "error" and `turn:<status>`, so this reads that. */
function noteKeyForStatus(status: number): string {
  if (status === 0) return "agent.offline";
  if (status === 429) return "agent.busy";
  if (status === 401 || status === 403) return "agent.signin";
  if (status >= 500) return "agent.no_route";
  return "agent.failed";
}

function statusOf(errorMessage: unknown): number {
  const m = /^turn:(\d+)$/.exec(String(errorMessage ?? ""));
  return m ? Number(m[1]) : -1;
}

/* Agent chat with the model chosen by the backend: no provider
   picker, no API key field, nothing to configure. One Agent instance
   is kept alive so the conversation remembers itself, and the tools
   still run in this tab against the open project. */
export default function AgentChat() {
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([{ role: "note", key: "agent.welcome" }]);
  const agentRef = useRef<Agent | null>(null);

  function push(role: Message["role"], text?: string, key?: string) {
    setMessages((m) => [...m, { role, text, key }]);
  }

  /** Streamed text lands in the last bubble if it is still ours. */
  function streamInto(snapshot: string) {
    setMessages((m) => {
      const last = m[m.length - 1];
      if (last && last.role === "agent" && !last.key) {
        return [...m.slice(0, -1), { role: "agent", text: snapshot }];
      }
      return [...m, { role: "agent", text: snapshot }];
    });
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    push("user", text);
    setInput("");
    setBusy(true);
    try {
      const agent = (agentRef.current ??= createStudioAgent());
      let current = "";
      const off = agent.subscribe((event) => {
        const ev = event as unknown as Record<string, unknown>;
        if (ev["type"] === "message_update") {
          const inner = ev["assistantMessageEvent"] as Record<string, unknown> | undefined;
          if (inner?.["type"] === "text_delta" && typeof inner["delta"] === "string") {
            current += inner["delta"] as string;
            streamInto(current);
          }
        } else if (ev["type"] === "tool_execution_start") {
          push("tool", `⚙ ${ev["toolName"] ?? "tool"}`);
        } else if (ev["type"] === "message_end") {
          const message = ev["message"] as { role?: string; stopReason?: string; errorMessage?: string };
          if (message.role === "assistant" && message.stopReason === "error") {
            push("note", undefined, noteKeyForStatus(statusOf(message.errorMessage)));
          }
          current = "";
        }
      });
      try {
        await agent.prompt(text);
      } catch (err) {
        // prompt() resolves on error events; this only catches a truly
        // broken agent (aborted, or the transcript went bad).
        console.error("agent prompt failed", err);
        push("note", undefined, "agent.failed");
      } finally {
        off();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <motion.button
        onClick={() => setOpen((v) => !v)}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.94 }}
        aria-label={t(lang, "agent.open")}
        className="fixed bottom-5 right-5 z-50 grid size-12 place-items-center rounded-full bg-mauve text-crust shadow-lg"
      >
        {open ? <X size={20} /> : <Bot size={20} />}
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="pane fixed bottom-20 right-5 z-50 flex h-[460px] w-[340px] flex-col overflow-hidden rounded-2xl"
          >
            <div className="flex items-center gap-2 border-b border-surface0 px-3.5 py-2.5">
              <Bot size={15} className="text-mauve" />
              <span className="text-[13px] font-semibold">{t(lang, "agent.title")}</span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto px-3.5 py-3">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`max-w-[92%] rounded-lg px-3 py-2 text-[13px] leading-relaxed ${
                    m.role === "user"
                      ? "ml-auto bg-mauve/20 text-text"
                      : m.role === "agent"
                        ? "bg-surface0 text-text"
                        : m.role === "tool"
                          ? "bg-transparent font-mono text-[11px] text-teal"
                          : "mx-auto bg-transparent text-center font-mono text-[11px] text-subtext0"
                  }`}
                >
                  {render(m, lang)}
                </div>
              ))}
              {busy && (
                <div className="flex items-center gap-2 font-mono text-[11px] text-subtext0">
                  <Loader2 size={12} className="animate-spin" /> …
                </div>
              )}
            </div>
            <form onSubmit={send} className="flex gap-1.5 border-t border-surface0 p-2.5">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={t(lang, "agent.placeholder")}
                maxLength={2000}
                className="min-w-0 flex-1 rounded-lg border border-surface1 bg-base px-3 py-2 text-[13px] outline-none placeholder:text-overlay0 focus:border-mauve"
              />
              <button
                type="submit"
                disabled={busy}
                aria-label={t(lang, "agent.send")}
                className="grid size-9 shrink-0 place-items-center rounded-lg bg-mauve text-crust disabled:opacity-60"
              >
                <Send size={15} />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
