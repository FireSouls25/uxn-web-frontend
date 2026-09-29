import { useStore } from "@nanostores/react";
import { Play } from "lucide-react";
import { t, useLang } from "../lib/i18n";
import { projectStore, voiceSelStore } from "../lib/store";

/* 4-voice mixer inside Uxn limits: MIDI notes 0–107 over one shared
   square wave, played once on boot. Test tones use WebAudio. */
export function midiHz(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function noteName(note: number): string {
  return `${NAMES[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1}`;
}

export function testTone(note: number): void {
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  osc.type = "square";
  osc.frequency.value = midiHz(note);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.15, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.4);
}

/* Center lanes: compact per-voice summary, click to edit on the right. */
export default function SoundMixer() {
  const lang = useLang();
  const project = useStore(projectStore);
  const voice = useStore(voiceSelStore);
  const voices = [0, 1, 2, 3].map((i) => project.sound?.voices[i] ?? { note: 0, vol: 0 });

  const locked = !!project.locked;
  return (
    <div>
      <p className="mb-3 font-mono text-[11px] text-subtext0">{t(lang, "sound.hint")}</p>
      <fieldset disabled={locked}>
      <div className="space-y-2">
        {voices.map((v, i) => (
          <div
            key={i}
            onClick={() => voiceSelStore.set(i)}
            className={`flex w-full cursor-pointer flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
              voice === i ? "border-mauve/50 bg-mauve/5" : "border-surface0 bg-base hover:border-surface1"
            }`}
          >
            <span className="font-mono text-[11px] text-subtext0">
              {t(lang, "sound.voice")} {i}
            </span>
            <span className="font-mono text-xs text-text">{noteName(v.note)}</span>
            <span className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-surface0">
              <span
                className="block h-full rounded-full bg-green"
                style={{ width: `${Math.round((v.vol / 255) * 100)}%` }}
              />
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                testTone(v.note);
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-surface0 px-2.5 py-1 font-mono text-[11px] transition-colors hover:bg-surface1"
            >
              <Play size={12} /> {t(lang, "sound.test")}
            </button>
          </div>
        ))}
      </div>
      </fieldset>
    </div>
  );
}
