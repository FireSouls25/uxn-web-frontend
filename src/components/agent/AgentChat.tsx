import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Bot, Send, X } from "lucide-react";
import { t, useLang } from "../../lib/i18n";
import { AGENT_ENDPOINT, AGENT_PROVIDERS } from "../../lib/agent/providers";
import { API_URL } from "../../lib/api";

interface Message {
  role: "user" | "agent" | "note";
  text: string;
}

/* Spawnable agent chat. Without a configured provider + backend
   endpoint it states that plainly — it never pretends a model
   answered. Once Pi SDK details land, this panel keeps its shape
   and only the send path changes. */
export default function AgentChat() {
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState(AGENT_PROVIDERS[0]?.id ?? "");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: "note", text: t(lang, "agent.welcome") },
  ]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    if (!provider) {
      setMessages((m) => [...m, { role: "note", text: t(lang, "agent.no_provider") }]);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}${AGENT_ENDPOINT}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, message: text }),
      });
      if (!res.ok) throw new Error(`agent: ${res.status}`);
      const data = (await res.json()) as { reply?: string };
      setMessages((m) => [...m, { role: "agent", text: data.reply ?? "…" }]);
    } catch {
      setMessages((m) => [...m, { role: "note", text: t(lang, "agent.offline") }]);
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
            className="pane fixed bottom-20 right-5 z-50 flex h-[420px] w-[330px] flex-col overflow-hidden rounded-2xl"
          >
            <div className="flex items-center gap-2 border-b border-surface0 px-3.5 py-2.5">
              <Bot size={15} className="text-mauve" />
              <span className="text-[13px] font-semibold">{t(lang, "agent.title")}</span>
              {AGENT_PROVIDERS.length > 0 ? (
                <select
                  aria-label={t(lang, "agent.provider")}
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  className="select select-sm ml-auto"
                >
                  {AGENT_PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="ml-auto font-mono text-[10px] text-yellow">
                  {t(lang, "agent.no_provider_short")}
                </span>
              )}
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto px-3.5 py-3">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`max-w-[90%] rounded-lg px-3 py-2 text-[13px] leading-relaxed ${
                    m.role === "user"
                      ? "ml-auto bg-mauve/20 text-text"
                      : m.role === "agent"
                        ? "bg-surface0 text-text"
                        : "mx-auto bg-transparent text-center font-mono text-[11px] text-subtext0"
                  }`}
                >
                  {m.text}
                </div>
              ))}
            </div>
            <form onSubmit={send} className="flex gap-1.5 border-t border-surface0 p-2.5">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={t(lang, "agent.placeholder")}
                maxLength={500}
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
