import { useState } from "react";
import { useStore } from "@nanostores/react";
import { Plus } from "lucide-react";
import { t, useLang } from "../lib/i18n";
import {
  addBinding,
  addInput,
  currentScene,
  flattenLeaves,
  projectStore,
  sceneIdStore,
  setSceneFrameCode,
} from "../lib/store";
import KeyPicker from "./KeyPicker";

/* Right column of the events view: author a transition out of the
   current scene — click an object, or press a key, to go somewhere. */
export default function TransitionEditor() {
  const lang = useLang();
  const project = useStore(projectStore);
  const sceneId = useStore(sceneIdStore);
  const [kind, setKind] = useState<"click" | "key">("click");
  const [object, setObject] = useState("");
  const [input, setInput] = useState("");
  const [goto, setGoto] = useState("");

  const scene = currentScene(project, sceneId);
  const target = goto || project.scenes[0]?.id || "";
  const leaves = flattenLeaves(project, scene.id);

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
              value={object || leaves[0]?.path || ""}
              onChange={(e) => setObject(e.target.value)}
              className="select w-full"
            >
              {leaves.map((o) => (
                <option key={o.path} value={o.path}>
                  {o.path}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="block">
            <span className="mb-1 block font-mono text-[11px] text-subtext0">{t(lang, "events.key")}</span>
            <KeyPicker value={input} onChange={setInput} />
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
            if (kind === "click") addBinding("click", object || leaves[0]?.path || "", target);
            else addBinding("key", null, target, undefined, input || project.inputs[0]?.id || addInput(32));
          }}
          disabled={kind === "click" && leaves.length === 0}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-surface0 px-3 py-2 text-[13px] font-medium transition-colors hover:bg-surface1 disabled:opacity-50"
        >
          <Plus size={14} /> {t(lang, "insp.add_binding")}
        </button>
        <label className="block">
          <span className="mb-1 block font-mono text-[11px] text-subtext0">{t(lang, "events.code")}</span>
          <textarea
            value={scene.frameCode ?? ""}
            onChange={(e) => setSceneFrameCode(e.target.value)}
            spellCheck={false}
            rows={4}
            placeholder={t(lang, "events.code_ph")}
            className="w-full resize-y rounded-lg border border-surface1 bg-base p-2 font-mono text-[11px] leading-relaxed outline-none placeholder:text-overlay0 focus:border-mauve"
          />
        </label>
      </div>
    </div>
  );
}
