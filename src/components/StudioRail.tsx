import { useStore } from "@nanostores/react";
import { Braces, Gamepad2, Image, Share2, TerminalSquare } from "lucide-react";
import { t, useLang } from "../lib/i18n";
import { viewStore } from "../lib/store";

const VIEWS = [
  { id: "scene", icon: Image, label: "view.scene" },
  { id: "sprites", icon: Gamepad2, label: "view.sprites" },
  { id: "events", icon: Share2, label: "view.events" },
  { id: "sound", icon: Braces, label: "view.sound" },
  { id: "code", icon: TerminalSquare, label: "view.code" },
] as const;

/* Left rail switches the center pane between the five studio views. */
export default function StudioRail() {
  const lang = useLang();
  const view = useStore(viewStore);

  return (
    <div className="pane flex flex-col items-center gap-1 rounded-xl py-2">
      {VIEWS.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          onClick={() => viewStore.set(id)}
          title={t(lang, label)}
          aria-label={t(lang, label)}
          className={`grid size-9 place-items-center rounded-lg transition-colors ${
            view === id ? "bg-surface0 text-mauve" : "text-subtext0 hover:bg-surface0 hover:text-text"
          }`}
        >
          <Icon size={17} />
        </button>
      ))}
    </div>
  );
}
