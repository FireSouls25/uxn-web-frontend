import { useStore } from "@nanostores/react";
import { t, useLang } from "../lib/i18n";
import { noteName } from "./SoundMixer";
import { projectStore, voiceSelStore } from "../lib/store";

/* Left column of the sound view: the four voices. */
export default function VoiceList() {
  const lang = useLang();
  const project = useStore(projectStore);
  const voice = useStore(voiceSelStore);

  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-widest text-subtext0">
        {t(lang, "sound.voices")}
      </p>
      <ul className="mt-2 space-y-0.5">
        {[0, 1, 2, 3].map((i) => {
          const v = project.sound?.voices[i] ?? { note: 0, vol: 0 };
          return (
            <li key={i}>
              <button
                onClick={() => voiceSelStore.set(i)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 font-mono text-xs transition-colors ${
                  voice === i ? "bg-mauve/15 text-mauve" : "text-subtext0 hover:bg-surface0 hover:text-text"
                }`}
              >
                <span>
                  {t(lang, "sound.voice")} {i}
                </span>
                <span className="ml-auto text-[10px] text-overlay0">
                  {v.vol > 0 ? noteName(v.note) : "—"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
