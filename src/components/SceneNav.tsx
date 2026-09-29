import { useStore } from "@nanostores/react";
import { t, useLang } from "../lib/i18n";
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
        {project.scenes.map((s) => {
          const edges = s.clicks.length + s.keys.length;
          return (
            <li key={s.id}>
              <button
                onClick={() => {
                  sceneIdStore.set(s.id);
                  selectionStore.set(null);
                }}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 font-mono text-xs transition-colors ${
                  s.id === sceneId ? "bg-mauve/15 text-mauve" : "text-subtext0 hover:bg-surface0 hover:text-text"
                }`}
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
