import { useStore } from "@nanostores/react";
import CodePanel from "./CodePanel";
import EventsGraph from "./EventsGraph";
import SoundMixer from "./SoundMixer";
import SpriteEditor from "./SpriteEditor";
import StudioCanvas from "./StudioCanvas";
import { projectStore, viewStore } from "../lib/store";

/* Center column: renders the active studio view. Code projects always
   show the code view — visual editors have nothing to bind to. */
export default function StudioCenter() {
  const view = useStore(viewStore);
  const project = useStore(projectStore);
  const effective = project.kind === "code" ? "code" : view;

  return (
    <div className="pane rounded-xl p-3">
      {effective === "scene" && <StudioCanvas />}
      {effective === "sprites" && <SpriteEditor />}
      {effective === "events" && <EventsGraph />}
      {effective === "sound" && <SoundMixer />}
      {effective === "code" && <CodePanel />}
    </div>
  );
}
