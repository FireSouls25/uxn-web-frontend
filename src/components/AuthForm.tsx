import { useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertCircle, ArrowRight, Loader2 } from "lucide-react";
import { t, useLang } from "../lib/i18n";
import { apiLogin, apiMe, apiRegister } from "../lib/auth";
import { setSession } from "../lib/session";

interface Props {
  mode: "login" | "register";
}

function validEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export default function AuthForm({ mode }: Props) {
  const lang = useLang();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (mode === "register" && name.trim().length < 2) {
      return setError(t(lang, "auth.e_name"));
    }
    if (!validEmail(email)) return setError(t(lang, "auth.e_email"));
    if (password.length < 8) return setError(t(lang, "auth.e_pass"));
    setError(null);
    setBusy(true);
    try {
      const pair =
        mode === "register"
          ? await apiRegister(name.trim(), email.trim(), password)
          : await apiLogin(email.trim(), password);
      const me = await apiMe(pair.access_token);
      setSession({
        name: me.name,
        email: me.email,
        access: pair.access_token,
        refresh: pair.refresh_token,
      });
      window.location.href = "/studio";
    } catch (e) {
      // Backend details already arrive localized; only the network
      // failure needs a local string.
      setError(e instanceof TypeError ? t(lang, "auth.e_net") : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const input =
    "w-full rounded-lg border border-surface1 bg-base px-3.5 py-2.5 text-sm text-text placeholder:text-overlay0 outline-none transition-all focus:border-mauve focus:ring-2 focus:ring-mauve/25";

  return (
    <motion.form
      onSubmit={submit}
      noValidate
      initial={{ opacity: 0, y: 22 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="pane w-full max-w-sm rounded-2xl p-7"
    >
      <h1 className="text-xl font-bold tracking-tight">
        {t(lang, mode === "login" ? "auth.login_t" : "auth.reg_t")}
      </h1>
      <p className="mt-1.5 text-[13px] text-subtext0">
        {mode === "login" ? (
          <>{t(lang, "auth.login_s")} <a href="/register" className="text-mauve hover:underline">{t(lang, "auth.login_q")}</a></>
        ) : (
          <>{t(lang, "auth.reg_s")} <a href="/login" className="text-mauve hover:underline">{t(lang, "auth.reg_q")}</a></>
        )}
      </p>

      <div className="mt-6 flex flex-col gap-3.5">
        {mode === "register" && (
          <label className="block">
            <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-widest text-subtext0">
              {t(lang, "auth.name")}
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t(lang, "auth.name_ph")}
              autoComplete="username"
              className={input}
            />
          </label>
        )}
        <label className="block">
          <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-widest text-subtext0">
            {t(lang, "auth.email")}
          </span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            type="email"
            autoComplete="email"
            className={input}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-widest text-subtext0">
            {t(lang, "auth.pass")}
          </span>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            className={input}
          />
        </label>
      </div>

      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden text-[13px] text-red"
          >
            <span className="flex items-center gap-1.5 pt-3">
              <AlertCircle size={14} /> {error}
            </span>
          </motion.p>
        )}
      </AnimatePresence>

      <motion.button
        type="submit"
        disabled={busy}
        whileHover={busy ? undefined : { scale: 1.02 }}
        whileTap={busy ? undefined : { scale: 0.98 }}
        className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-mauve px-4 py-2.5 text-sm font-semibold text-crust disabled:opacity-70"
      >
        {busy ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <>
            {t(lang, mode === "login" ? "auth.go_login" : "auth.go_signup")} <ArrowRight size={15} />
          </>
        )}
      </motion.button>

      <p className="mt-4 text-center font-mono text-[11px] text-overlay0">
        {t(lang, "auth.foot")}
      </p>
      <p className="mt-2 rounded-lg bg-yellow/10 px-3 py-2 text-center text-[13px] text-yellow">
        {t(lang, "auth.save_note")}
      </p>
    </motion.form>
  );
}
