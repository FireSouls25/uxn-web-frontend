import { useStore } from "@nanostores/react";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import AssetBrowser from "./AssetBrowser";
import HierarchyPanel from "./HierarchyPanel";
import SceneNav from "./SceneNav";
import { t, useLang } from "../lib/i18n";
import { overlayStore, toggleOverlay } from "../lib/store";

/* Left canvas overlay: the node dock. Fuses the asset library
   (templates, drag onto canvas), the hierarchy tree and the scene
   jump list into one collapsible rail over the viewport. */
export default function NodeDock() {
  const lang = useLang();
  const over = useStore(overlayStore);

  if (!over.left) {
    return (
      <button
        onClick={() => toggleOverlay("left")}
        title={t(lang, "dock.show")}
        aria-label={t(lang, "dock.show")}
        className="dock absolute left-3 top-3 z-20 grid size-9 place-items-center rounded-xl text-subtext0 transition-colors hover:text-text"
      >
        <ChevronsRight size={16} />
      </button>
    );
  }

  return (
    <div className="dock absolute bottom-3 left-3 top-3 z-20 flex w-60 flex-col rounded-2xl p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-widest text-subtext0">
          {t(lang, "dock.nodes")}
        </p>
        <button
          onClick={() => toggleOverlay("left")}
          title={t(lang, "dock.hide")}
          aria-label={t(lang, "dock.hide")}
          className="grid size-6 place-items-center rounded-md text-subtext0 transition-colors hover:bg-surface0 hover:text-text"
        >
          <ChevronsLeft size={14} />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-0.5">
        <AssetBrowser />
        <hr className="border-surface0" />
        <HierarchyPanel />
        <hr className="border-surface0" />
        <SceneNav />
      </div>
    </div>
  );
}
