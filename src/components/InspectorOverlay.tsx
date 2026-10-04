import { useStore } from "@nanostores/react";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import InspectorPanel from "./InspectorPanel";
import ObjectEditor from "./ObjectEditor";
import { t, useLang } from "../lib/i18n";
import { defSelStore, overlayStore, projectStore, toggleOverlay } from "../lib/store";

/* Right canvas overlay: the slim inspector. Template selection shows
   its object editor (with used-by), otherwise the instance inspector
   with teal-dot overrides — both without code textareas (hideCode):
   logic lives in the logic graph, one "Open" jump away. */
export default function InspectorOverlay() {
  const lang = useLang();
  const project = useStore(projectStore);
  const defSel = useStore(defSelStore);
  const over = useStore(overlayStore);
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
          {t(lang, "insp.title")}
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
      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        {editingDef && defSel ? <ObjectEditor id={defSel} hideCode /> : <InspectorPanel hideCode />}
      </div>
    </div>
  );
}
