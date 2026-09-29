import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Bot, KeyRound, Loader2, Send, X } from "lucide-react";
import type { Agent } from "@mariozechner/pi-agent-core";
import { t, useLang } from "../../lib/i18n";
import {
  createStudioAgent,
  getApiKey,
  listModels,
  listProviders,
  setApiKey,
} from "../../lib/agent/pi";

interface Message {
  role: "user" | "agent" | "note" | "tool";
  text: string;
}

/* Live agent chat: pi-agent-core loop in the browser, tools executing
   against projectStore, streaming into this panel. Keys are BYOK
   (localStorage, per provider). Nothing is faked: no key or no
   network states say so plainly. */
export default function AgentChat() {
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const [providers] = useState<string[]>(() => {
    const discovered = listProviders();
    return discovered.length > 0 ? discovered : [];
  });
  const [provider, setProvider] = useState("");
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: "note", text: t(lang, "agent.welcome") },
  ]);
  const agentRef = useRef<Agent | null>(null);

  useEffect(() => {
    if (providers.length > 0 && !provider) setProvider(providers[0]);
  }, [providers, provider]);

  useEffect(() => {
    if (!provider) {
      setModels([]);
      return;
    }
    setModels(listModels(provider));
    setKey(getApiKey(provider) ?? "");
  }, [provider]);

  useEffect(() => {
    if (!model && models.length > 0) setModel(models[0].id);
  }, [models, model]);

  function push(role: Message["role"], text: string) {
    setMessages((m) => [...m, { role, text }]);
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    if (!provider || !model) {
      push("note", t(lang, "agent.no_provider"));
      return;
    }
    if (!getApiKey(provider)) {
      push("note", t(lang, "agent.no_key"));
      return;
    }
    push("user", text);
    setInput("");
    setBusy(true);
    try {
      const agent = createStudioAgent({ provider, model });
      agentRef.current = agent;
      let current = "";
      agent.subscribe((event) => {
        const e = event as unknown as Record<string, unknown>;
        if (e["type"] === "message_update") {
          const inner = e["assistantMessageEvent"] as Record<string, unknown> | undefined;
          if (inner?.["type"] === "text_delta" && typeof inner["delta"] === "string") {
            current += inner["delta"] as string;
            const snapshot = current;
            setMessages((m) => {
              const last = m[m.length - 1];
              if (last && last.role === "agent" && (last as { live?: boolean }).live) {
                return [...m.slice(0, -1), { role: "agent", text: snapshot } as Message];
              }
              return [...m, { role: "agent", text: snapshot } as Message];
            });
          }
        } else if (e["type"] === "tool_execution_start") {
          const name = typeof e["toolName"] === "string" ? (e["toolName"] as string) : "tool";
          push("tool", `⚙ ${name}`);
        } else if (e["type"] === "turn_end") {
          current = "";
        }
      });
      await agent.prompt(text);
      agentRef.current = null;
    } catch (err) {
      push("note", err instanceof Error ? err.message : t(lang, "agent.offline"));
      agentRef.current = null;
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
            <div className="flex items-center gap-1.5 border-b border-surface0 px-3 py-2">
              <Bot size={15} className="shrink-0 text-mauve" />
              <span className="text-[13px] font-semibold">{t(lang, "agent.title")}</span>
            </div>
            <div className="flex items-center gap-1.5 border-b border-surface0 px-3 py-2">
              <select
                aria-label={t(lang, "agent.provider")}
                value={provider}
                onChange={(e) => {
                  setProvider(e.target.value);
                  setModel("");
                }}
                className="select select-sm min-w-0 flex-1"
              >
                <option value="">{t(lang, "agent.provider")}…</option>
                {providers.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <select
                aria-label="Model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="select select-sm min-w-0 flex-1"
              >
                <option value="">model…</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.id}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1.5 border-b border-surface0 px-3 py-2">
              <KeyRound size={13} className="shrink-0 text-subtext0" />
              <input
                type="password"
                value={key}
                onChange={(e) => {
                  setKey(e.target.value);
                  setApiKey(provider, e.target.value);
                }}
                placeholder={t(lang, "agent.key_ph")}
                className="min-w-0 flex-1 bg-transparent font-mono text-[11px] outline-none placeholder:text-overlay0"
              />
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
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
                  {m.text}
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
