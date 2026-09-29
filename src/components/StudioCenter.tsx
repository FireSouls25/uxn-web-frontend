import { useStore } from "@nanostores/react";
import CodePanel from "./CodePanel";
import EventsGraph from "./EventsGraph";
import SoundMixer from "./SoundMixer";
import SpriteEditor from "./SpriteEditor";
import StudioCanvas from "./StudioCanvas";
import { viewStore } from "../lib/store";

/* Center column: renders the active studio view. Scene keeps the
   canvas; the other four mount their own editors. */
export default function StudioCenter() {
  const view = useStore(viewStore);

  return (
    <div className="pane rounded-xl p-3">
      {view === "scene" && <StudioCanvas />}
      {view === "sprites" && <SpriteEditor />}
      {view === "events" && <EventsGraph />}
      {view === "sound" && <SoundMixer />}
      {view === "code" && <CodePanel />}
    </div>
  );
}
