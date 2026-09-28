import { useStore } from "@nanostores/react";
import { t, useLang } from "../lib/i18n";
import { currentScene, projectStore, sceneIdStore, selectionStore, setObjectPos } from "../lib/store";

/* Inspector bound to the store selection: numeric X/Y with canvas
   clamping, so canvas drags and typed values can never disagree. */
export default function InspectorPanel() {
  const lang = useLang();
  const project = useStore(projectStore);
  const sceneId = useStore(sceneIdStore);
  const selection = useStore(selectionStore);

  const scene = currentScene(project, sceneId);
  const obj = scene.objects.find((o) => o.id === selection) ?? null;

  function commit(field: "x" | "y", raw: number) {
    if (!obj || Number.isNaN(raw)) return;
    const next = { x: obj.x, y: obj.y, [field]: Math.round(raw) };
    setObjectPos(obj.id, next.x, next.y);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-widest text-subtext0">
          {t(lang, "insp.title")}
        </p>
        {obj && (
          <span className="rounded-full bg-mauve/15 px-2 py-0.5 font-mono text-[10px] text-mauve">
            {obj.id}
          </span>
        )}
      </div>
      {!obj ? (
        <p className="mt-3 rounded-lg border border-dashed border-surface1 px-3 py-4 text-center text-[13px] text-subtext0">
          {t(lang, "insp.none")}
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          {(["x", "y"] as const).map((field) => (
            <div
              key={field}
              className="flex items-center justify-between rounded-lg border border-surface0 px-3 py-2"
            >
              <span className="font-mono text-[11px] text-subtext0">
                {t(lang, field === "x" ? "insp.x" : "insp.y")}
              </span>
              <input
                type="number"
                value={field === "x" ? obj.x : obj.y}
                min={0}
                max={field === "x" ? project.width - 8 : project.height - 8}
                onChange={(e) => commit(field, e.target.valueAsNumber)}
                className="w-20 rounded-md border border-surface1 bg-base px-2 py-1 text-right font-mono text-xs outline-none focus:border-mauve"
              />
            </div>
          ))}
          <p className="font-mono text-[11px] text-subtext0">
            tile · {(obj.tile ?? []).length || 8} rows · {scene.id}
          </p>
        </div>
      )}
    </div>
  );
}
