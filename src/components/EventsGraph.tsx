import { useStore } from "@nanostores/react";
import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { t, useLang } from "../lib/i18n";
import { sceneVar } from "../lib/scene-ui";
import { projectStore, sceneIdStore } from "../lib/store";

/* General view: every binding that switches scenes, grouped by
   source scene. Clicking a target jumps the studio there. */
export default function EventsGraph() {
  const lang = useLang();
  const project = useStore(projectStore);

  const edges = project.scenes.flatMap((s, si) => [
    ...s.clicks.map((c) => ({ from: s.id, fromColor: sceneVar(si), label: `${t(lang, "events.click")} ${c.object}`, to: c.goto, toColor: sceneVar(project.scenes.findIndex((x) => x.id === c.goto)) })),
    ...s.keys.map((k) => ({ from: s.id, fromColor: sceneVar(si), label: `${t(lang, "events.key")} ${k.key}`, to: k.goto, toColor: sceneVar(project.scenes.findIndex((x) => x.id === k.goto)) })),
  ]);

  return (
    <div>
      <p className="mb-3 font-mono text-[11px] text-subtext0">{t(lang, "events.hint")}</p>
      {edges.length === 0 && (
        <p className="rounded-lg border border-dashed border-surface1 px-3 py-4 text-center text-[13px] text-subtext0">
          {t(lang, "events.none")}
        </p>
      )}
      <div className="space-y-2">
        {edges.map((e, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, delay: Math.min(i * 0.05, 0.4) }}
            className="flex items-center gap-2 rounded-lg border border-surface0 bg-base px-3 py-2 font-mono text-xs"
          >
            <span className="size-2 shrink-0 rounded-full" style={{ background: e.fromColor }} />
            <span style={{ color: e.fromColor }}>{e.from}</span>
            <span className="text-subtext0">{e.label}</span>
            <ArrowRight size={13} className="text-overlay0" />
            <button
              onClick={() => sceneIdStore.set(e.to)}
              className="rounded-md bg-mauve/15 px-2 py-0.5 text-mauve transition-colors hover:bg-mauve/25"
            >
              <span className="size-2 mr-1 inline-block rounded-full" style={{ background: e.toColor }} />
              {e.to}
            </button>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
