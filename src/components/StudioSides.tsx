import { useStore } from "@nanostores/react";
import ExportPanel from "./ExportPanel";
import FileList from "./FileList";
import HierarchyPanel from "./HierarchyPanel";
import InspectorPanel from "./InspectorPanel";
import SceneNav from "./SceneNav";
import SpriteLibrary from "./SpriteLibrary";
import SpriteTools from "./SpriteTools";
import TransitionEditor from "./TransitionEditor";
import VoiceEditor from "./VoiceEditor";
import VoiceList from "./VoiceList";
import { viewStore } from "../lib/store";

/* Left column follows the view: hierarchy for scenes, sprites for
   sprites, scene jumps for events, voices for sound, files for code. */
export function StudioLeft() {
  const view = useStore(viewStore);
  return (
    <div className="pane rounded-xl p-3">
      {view === "scene" && <HierarchyPanel />}
      {view === "sprites" && <SpriteLibrary />}
      {view === "events" && <SceneNav />}
      {view === "sound" && <VoiceList />}
      {view === "code" && <FileList />}
    </div>
  );
}

/* Right column follows the view: inspector for scenes, drawing tools
   for sprites, transition authoring for events, voice detail for
   sound. Export stays docked everywhere except the code view, where
   it is the panel — it acts on any view. */
export function StudioRight() {
  const view = useStore(viewStore);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {view !== "code" && (
        <div className="pane rounded-xl p-3">
          {view === "scene" && <InspectorPanel />}
          {view === "sprites" && <SpriteTools />}
          {view === "events" && <TransitionEditor />}
          {view === "sound" && <VoiceEditor />}
        </div>
      )}
      <div className="pane rounded-xl p-3">
        <ExportPanel />
      </div>
    </div>
  );
}
