import { useState } from "react";
import { useStore } from "@nanostores/react";
import { Plus } from "lucide-react";
import { t, useLang } from "../lib/i18n";
import { addBinding, currentScene, projectStore, sceneIdStore } from "../lib/store";

/* Right column of the events view: author a transition out of the
   current scene — click an object, or press a key, to go somewhere. */
export default function TransitionEditor() {
  const lang = useLang();
  const project = useStore(projectStore);
  const sceneId = useStore(sceneIdStore);
  const [kind, setKind] = useState<"click" | "key">("click");
  const [object, setObject] = useState("");
  const [key, setKey] = useState(32);
  const [goto, setGoto] = useState("");

  const scene = currentScene(project, sceneId);
  const target = goto || project.scenes[0]?.id || "";

  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-widest text-subtext0">
        {t(lang, "events.new")} · <span className="text-mauve">{scene.id}</span>
      </p>
      <div className="mt-2 space-y-2">
        <label className="block">
          <span className="mb-1 block font-mono text-[11px] text-subtext0">{t(lang, "insp.event")}</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as "click" | "key")} className="select w-full">
            <option value="click">{t(lang, "events.click")}</option>
            <option value="key">{t(lang, "events.key")}</option>
          </select>
        </label>
        {kind === "click" ? (
          <label className="block">
            <span className="mb-1 block font-mono text-[11px] text-subtext0">{t(lang, "events.object")}</span>
            <select
              value={object || scene.objects[0]?.id || ""}
              onChange={(e) => setObject(e.target.value)}
              className="select w-full"
            >
              {scene.objects.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.id}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="block">
            <span className="mb-1 block font-mono text-[11px] text-subtext0">{t(lang, "events.key")}</span>
            <input
              type="number"
              value={key}
              min={0}
              max={255}
              onChange={(e) => setKey(Math.min(255, Math.max(0, Math.round(e.target.valueAsNumber || 0))))}
              className="w-full rounded-lg border border-surface1 bg-base px-2.5 py-1.5 font-mono text-xs outline-none focus:border-mauve"
            />
          </label>
        )}
        <label className="block">
          <span className="mb-1 block font-mono text-[11px] text-subtext0">{t(lang, "insp.goto")}</span>
          <select value={target} onChange={(e) => setGoto(e.target.value)} className="select w-full">
            {project.scenes.map((s) => (
              <option key={s.id} value={s.id}>
                → {s.id}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => {
            if (kind === "click") addBinding("click", object || scene.objects[0]?.id || "", target);
            else addBinding("key", null, target, key);
          }}
          disabled={kind === "click" && scene.objects.length === 0}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-surface0 px-3 py-2 text-[13px] font-medium transition-colors hover:bg-surface1 disabled:opacity-50"
        >
          <Plus size={14} /> {t(lang, "insp.add_binding")}
        </button>
      </div>
    </div>
  );
}
