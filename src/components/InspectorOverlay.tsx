import { useStore } from "@nanostores/react";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import InspectorPanel from "./InspectorPanel";
import LogicInspector from "./LogicInspector";
import ObjectEditor from "./ObjectEditor";
import RunCodeSection from "./RunCodeSection";
import { t, useLang } from "../lib/i18n";
import { canvasModeStore, defSelStore, overlayStore, projectStore, toggleOverlay } from "../lib/store";

/* Right canvas overlay. Scene mode: the slim inspector (template
   editor or instance inspector, both codeless) + the run-code
   connections. Blocks mode: the block picker instead — target
   object + event, grouped palette, sound attach and snippet
   connections. One panel, two jobs, switched by canvas mode. */
export default function InspectorOverlay() {
  const lang = useLang();
  const project = useStore(projectStore);
  const defSel = useStore(defSelStore);
  const over = useStore(overlayStore);
  const mode = useStore(canvasModeStore);
  const editingDef = !!defSel && (project.objectDefs ?? []).some((d) => d.id === defSel);

  if (!over.right) {
    return (
      <button
        onClick={() => toggleOverlay("right")}
        title={t(lang, "dock.show")}
        aria-label={t(lang, "dock.show")}
        className="dock absolute right-3 top-3 z-20 grid size-9 place-items-center rounded-xl text-subtext0 transition-colors hover:text-text"
      >
        <ChevronsLeft size={16} />
      </button>
    );
  }

  return (
    <div className="dock absolute bottom-3 right-3 top-3 z-20 flex w-72 flex-col rounded-2xl p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-widest text-subtext0">
          {mode === "logic" ? t(lang, "hdr.mode_logic") : t(lang, "insp.title")}
        </p>
        <button
          onClick={() => toggleOverlay("right")}
          title={t(lang, "dock.hide")}
          aria-label={t(lang, "dock.hide")}
          className="grid size-6 place-items-center rounded-md text-subtext0 transition-colors hover:bg-surface0 hover:text-text"
        >
          <ChevronsRight size={14} />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-0.5">
        {mode === "logic" ? (
          <LogicInspector />
        ) : (
          <>
            {editingDef && defSel ? <ObjectEditor id={defSel} hideCode /> : <InspectorPanel hideCode />}
            <RunCodeSection />
          </>
        )}
      </div>
    </div>
  );
}
