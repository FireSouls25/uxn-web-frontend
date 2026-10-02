import { useStore } from "@nanostores/react";
import AssetBrowser from "./AssetBrowser";
import ExportPanel from "./ExportPanel";
import FileList from "./FileList";
import HierarchyPanel from "./HierarchyPanel";
import InspectorPanel from "./InspectorPanel";
import ObjectEditor from "./ObjectEditor";
import SceneNav from "./SceneNav";
import SpriteLibrary from "./SpriteLibrary";
import SpriteTools from "./SpriteTools";
import TransitionEditor from "./TransitionEditor";
import VoiceEditor from "./VoiceEditor";
import VoiceList from "./VoiceList";
import { t, useLang } from "../lib/i18n";
import { defSelStore, projectStore, viewStore } from "../lib/store";

/* Hand-written ETAL has no visual model: sides say so plainly. */
function CodeNote() {
  const lang = useLang();
  return (
    <p className="rounded-lg border border-dashed border-surface1 px-3 py-4 text-center text-[13px] text-subtext0">
      {t(lang, "code.side_note")}
    </p>
  );
}

/* Locked examples browse read-only: no authoring affordances. */
function LockedNote() {
  const lang = useLang();
  return (
    <p className="rounded-lg border border-dashed border-yellow/30 bg-yellow/5 px-3 py-4 text-center text-[13px] text-yellow">
      {t(lang, "locked.note")}
    </p>
  );
}

/* Left column follows the view: hierarchy for scenes, sprites for
   sprites, scene jumps for events, voices for sound, files for code. */
export function StudioLeft() {
  const view = useStore(viewStore);
  const project = useStore(projectStore);
  if (project.kind === "code") {
    return (
      <div className="pane rounded-xl p-3">
        <CodeNote />
      </div>
    );
  }
  if (view === "scene") {
    return (
      <div className="flex min-w-0 flex-col gap-3">
        <div className="pane rounded-xl p-3">
          <AssetBrowser />
        </div>
        <div className="pane rounded-xl p-3">
          <HierarchyPanel />
        </div>
      </div>
    );
  }
  return (
    <div className="pane rounded-xl p-3">
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
  const project = useStore(projectStore);
  const defSel = useStore(defSelStore);
  if (project.kind === "code") {
    return (
      <div className="flex min-w-0 flex-col gap-3">
        <div className="pane rounded-xl p-3">
          <CodeNote />
        </div>
        <div className="pane rounded-xl p-3">
          <ExportPanel />
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {view !== "code" && (
        <div className="pane rounded-xl p-3">
          {view === "scene" &&
            (defSel && (project.objectDefs ?? []).some((d) => d.id === defSel) ? (
              <ObjectEditor id={defSel} />
            ) : (
              <InspectorPanel />
            ))}
          {view === "sprites" && <SpriteTools />}
          {view === "events" && (project.locked ? <LockedNote /> : <TransitionEditor />)}
          {view === "sound" && <VoiceEditor />}
        </div>
      )}
      <div className="pane rounded-xl p-3">
        <ExportPanel />
      </div>
    </div>
  );
}
