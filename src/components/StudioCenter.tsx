import { useStore } from "@nanostores/react";
import CodeStudio from "./CodeStudio";
import CommandPalette from "./CommandPalette";
import EngineCanvas from "./EngineCanvas";
import InspectorOverlay from "./InspectorOverlay";
import NodeDock from "./NodeDock";
import PlaytestOverlay from "./PlaytestOverlay";
import SoundStudio from "./SoundStudio";
import SpriteStudio from "./SpriteStudio";
import { Play, TerminalSquare } from "lucide-react";
import { t, useLang } from "../lib/i18n";
import { codeFileStore, projectStore, requestPlaytest, setLoopMode, viewStore } from "../lib/store";

/* Script loop: the canvas still edits assets (sprites placed here are
   just layout), but nothing on it runs — say so where people look. */
function ScriptLoopBanner() {
  const lang = useLang();
  const project = useStore(projectStore);
  if (project.loop !== "script") return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-4">
      <div role="status" className="dock pointer-events-auto flex max-w-xl flex-wrap items-center gap-2 rounded-2xl px-3 py-2">
        <TerminalSquare size={15} className="shrink-0 text-teal" />
        <p className="min-w-0 flex-1 text-[12px] leading-snug text-subtext0">
          <span className="font-semibold text-text">{t(lang, "loop.banner_title")}</span> {t(lang, "loop.banner_body")}
        </p>
        <button
          onClick={requestPlaytest}
          className="seg-active inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-mono text-[11px]"
        >
          <Play size={11} /> {t(lang, "exp.playtest")}
        </button>
        <button
          onClick={() => {
            codeFileStore.set("custom.ux");
            viewStore.set("code");
          }}
          className="rounded-lg px-2.5 py-1 font-mono text-[11px] text-subtext0 hover:bg-surface0 hover:text-text"
        >
          {t(lang, "loop.open_code")}
        </button>
        {!project.locked && (
          <button
            onClick={() => setLoopMode("engine")}
            className="rounded-lg px-2.5 py-1 font-mono text-[11px] text-subtext0 hover:bg-surface0 hover:text-text"
          >
            {t(lang, "loop.use_engine")}
          </button>
        )}
      </div>
    </div>
  );
}

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
        <ScriptLoopBanner />
      </div>
      <PlaytestOverlay />
    </div>
  );
}
