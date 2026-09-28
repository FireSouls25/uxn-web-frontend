import { motion } from "motion/react";
import { ArrowRight, Terminal } from "lucide-react";
import { t, useLang } from "../lib/i18n";

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.1 } },
};

const item = {
  hidden: { opacity: 0, y: 26 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as const },
  },
};

const STAT_KEYS = [
  ["hero.s1k", "hero.s1v"],
  ["hero.s2k", "hero.s2v"],
  ["hero.s3k", "hero.s3v"],
  ["hero.s4k", "hero.s4v"],
] as const;

export default function Hero() {
  const lang = useLang();
  const post = t(lang, "hero.title_post");

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="mx-auto max-w-6xl px-4 pb-14 pt-16 text-center md:pt-24"
    >
      <motion.div variants={item} className="mb-5 flex justify-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-surface1 bg-mantle px-3.5 py-1 font-mono text-[11px] uppercase tracking-widest text-subtext0">
          <span className="size-1.5 animate-pulse rounded-full bg-green" />
          {t(lang, "hero.badge")}
        </span>
      </motion.div>

      <motion.h1
        variants={item}
        className="mx-auto max-w-3xl text-4xl font-bold leading-[1.08] tracking-tight md:text-6xl"
      >
        {t(lang, "hero.title_pre")} <span className="text-mauve">{t(lang, "hero.title_accent")}</span>
        {post ? ` ${post}` : ""}
      </motion.h1>

      <motion.p
        variants={item}
        className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-subtext0"
      >
        {t(lang, "hero.sub")}
      </motion.p>

      <motion.div variants={item} className="mt-8 flex items-center justify-center gap-3">
        <motion.a
          href="/register"
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
          className="inline-flex items-center gap-2 rounded-lg bg-mauve px-5 py-2.5 text-sm font-semibold text-crust"
        >
          {t(lang, "hero.cta1")} <ArrowRight size={16} />
        </motion.a>
        <motion.a
          href="/studio"
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
          className="inline-flex items-center gap-2 rounded-lg border border-surface1 bg-mantle px-5 py-2.5 text-sm font-medium text-text"
        >
          <Terminal size={15} /> {t(lang, "hero.cta2")}
        </motion.a>
      </motion.div>

      <motion.dl
        variants={item}
        className="mx-auto mt-12 grid max-w-2xl grid-cols-2 gap-px overflow-hidden rounded-xl border border-surface0 bg-surface0 md:grid-cols-4"
      >
        {STAT_KEYS.map(([k, v]) => (
          <div key={k} className="bg-mantle px-4 py-4">
            <dt className="font-mono text-sm font-semibold text-text">{t(lang, k)}</dt>
            <dd className="mt-1 font-mono text-[11px] text-subtext0">{t(lang, v)}</dd>
          </div>
        ))}
      </motion.dl>
    </motion.div>
  );
}
