import { useStore } from "@nanostores/react";
import { t, useLang } from "../lib/i18n";
import { sceneVar } from "../lib/scene-ui";
import { projectStore, sceneIdStore, selectionStore } from "../lib/store";

/* Left column of the events view: scene jump list. */
export default function SceneNav() {
  const lang = useLang();
  const project = useStore(projectStore);
  const sceneId = useStore(sceneIdStore);

  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-widest text-subtext0">
        {t(lang, "nav.scenes")}
      </p>
      <ul className="mt-2 space-y-0.5">
        {project.scenes.map((s, si) => {
          const edges = s.clicks.length + s.keys.length;
          const active = s.id === sceneId;
          return (
            <li key={s.id}>
              <button
                onClick={() => {
                  sceneIdStore.set(s.id);
                  selectionStore.set(null);
                }}
                className="flex w-full items-center gap-2 rounded-md border-l-2 px-2 py-1.5 font-mono text-xs transition-all hover:bg-surface0"
                style={{
                  borderLeftColor: sceneVar(si),
                  ...(active ? { background: "var(--ctp-surface0)", color: sceneVar(si) } : { color: "var(--ctp-subtext0)" }),
                }}
              >
                <span className="truncate">{s.id}</span>
                <span className="ml-auto text-[10px] text-overlay0">→{edges}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
