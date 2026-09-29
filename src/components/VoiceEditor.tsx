import { useStore } from "@nanostores/react";
import { Play } from "lucide-react";
import { t, useLang } from "../lib/i18n";
import { midiHz, noteName, testTone } from "./SoundMixer";
import { projectStore, setVoice, voiceSelStore } from "../lib/store";

/* Right column of the sound view: big sliders for the selected
   voice, its concert pitch, and a test tone. */
export default function VoiceEditor() {
  const lang = useLang();
  const project = useStore(projectStore);
  const voice = useStore(voiceSelStore);
  const v = project.sound?.voices[voice] ?? { note: 0, vol: 0 };

  function set(note: number, vol: number) {
    setVoice(
      voice,
      Math.min(107, Math.max(0, Math.round(note))),
      Math.min(255, Math.max(0, Math.round(vol))),
    );
  }

  const locked = !!project.locked;
  return (
    <div>
      <fieldset disabled={locked}>
      <p className="font-mono text-[11px] uppercase tracking-widest text-subtext0">
        {t(lang, "sound.voice")} {voice} · <span className="text-mauve">{noteName(v.note)}</span>
      </p>
      <p className="mt-1 font-mono text-[11px] text-subtext0">
        {midiHz(v.note).toFixed(1)} Hz · {t(lang, "sound.once")}
      </p>
      <label className="mt-3 block">
        <span className="mb-1 flex justify-between font-mono text-[11px] text-subtext0">
          <span>{t(lang, "sound.note")}</span>
          <span className="text-text">{v.note}</span>
        </span>
        <input
          type="range"
          min={0}
          max={107}
          value={v.note}
          onChange={(e) => set(Number(e.target.value), v.vol)}
          className="w-full accent-mauve"
        />
      </label>
      <label className="mt-2 block">
        <span className="mb-1 flex justify-between font-mono text-[11px] text-subtext0">
          <span>{t(lang, "sound.vol")}</span>
          <span className="text-text">{v.vol}</span>
        </span>
        <input
          type="range"
          min={0}
          max={255}
          value={v.vol}
          onChange={(e) => set(v.note, Number(e.target.value))}
          className="w-full accent-mauve"
        />
      </label>
      <button
        onClick={() => testTone(v.note)}
        className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-surface0 px-3 py-2 text-[13px] font-medium transition-colors hover:bg-surface1"
      >
        <Play size={14} /> {t(lang, "sound.test")}
      </button>
      {v.vol === 0 && (
        <p className="mt-2 font-mono text-[11px] text-yellow">{t(lang, "sound.silent")}</p>
      )}
      </fieldset>
    </div>
  );
}
