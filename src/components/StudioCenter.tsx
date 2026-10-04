import { useStore } from "@nanostores/react";
import { X } from "lucide-react";
import CodePanel from "./CodePanel";
import CommandPalette from "./CommandPalette";
import EngineCanvas from "./EngineCanvas";
import InspectorOverlay from "./InspectorOverlay";
import NodeDock from "./NodeDock";
import PlaytestOverlay from "./PlaytestOverlay";
import SoundMixer from "./SoundMixer";
import SpriteEditor from "./SpriteEditor";
import { t, useLang } from "../lib/i18n";
import { projectStore, viewStore } from "../lib/store";

/* Canvas-first center: the engine viewport always fills the frame
   (scene or logic mode), with the node dock and inspector floating
   over it. viewStore now only opens the sprite/sound/code dialogs —
   modal panels over the canvas that close back to it. Code projects
   still show the code view, which has no visual model. */
export default function StudioCenter() {
  const lang = useLang();
  const view = useStore(viewStore);
  const project = useStore(projectStore);

  if (project.kind === "code") {
    return (
      <div className="pane rounded-xl p-3">
        <CodePanel />
      </div>
    );
  }

  const dialog = view === "sprites" || view === "sound" || view === "code" ? view : null;

  return (
    <div className="absolute inset-0">
      <div className="pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2">
        <div className="pointer-events-auto">
          <CommandPalette />
        </div>
      </div>
      <div className="absolute inset-0">
        <EngineCanvas />
        <NodeDock />
        <InspectorOverlay />
      </div>
      {dialog && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-3 sm:p-6">
          <div className="pane max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-xl p-4">
            <div className="mb-3 flex items-center justify-end">
              <button
                onClick={() => viewStore.set("scene")}
                title={t(lang, "hdr.close")}
                aria-label={t(lang, "hdr.close")}
                className="grid size-8 place-items-center rounded-lg text-subtext0 transition-colors hover:bg-surface0 hover:text-text"
              >
                <X size={15} />
              </button>
            </div>
            {dialog === "sprites" && <SpriteEditor />}
            {dialog === "sound" && <SoundMixer />}
            {dialog === "code" && <CodePanel />}
          </div>
        </div>
      )}
      <PlaytestOverlay />
    </div>
  );
}
