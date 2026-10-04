import { useStore } from "@nanostores/react";
import CodeStudio from "./CodeStudio";
import CommandPalette from "./CommandPalette";
import EngineCanvas from "./EngineCanvas";
import InspectorOverlay from "./InspectorOverlay";
import NodeDock from "./NodeDock";
import PlaytestOverlay from "./PlaytestOverlay";
import SoundStudio from "./SoundStudio";
import SpriteStudio from "./SpriteStudio";
import { projectStore, viewStore } from "../lib/store";

/* Canvas-first center: scene/logic fill the viewport with floating
   docks; sprites/sound/code are full pages in the same spirit (not
   modals). Code projects open the code studio directly. */
export default function StudioCenter() {
  const view = useStore(viewStore);
  const project = useStore(projectStore);

  if (project.kind === "code") {
    return (
      <div className="absolute inset-0">
        <CodeStudio />
        <PlaytestOverlay />
      </div>
    );
  }

  if (view === "sprites" || view === "sound" || view === "code") {
    return (
      <div className="absolute inset-0">
        <div className="pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2">
          <div className="pointer-events-auto">
            <CommandPalette />
          </div>
        </div>
        {view === "sprites" && <SpriteStudio />}
        {view === "sound" && <SoundStudio />}
        {view === "code" && <CodeStudio />}
        <PlaytestOverlay />
      </div>
    );
  }

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
      <PlaytestOverlay />
    </div>
  );
}
