import { useStore } from "@nanostores/react";
import { ListMusic, Music, Plus } from "lucide-react";
import { t, useLang } from "../lib/i18n";
import { noteName } from "./SoundMixer";
import { addSong, addSound, projectStore, songSelStore, soundSelStore, voiceSelStore } from "../lib/store";

/* Left column of the sound view: the boot mix (four voices, played
   once at startup) plus the named one-shot library that play blocks
   trigger after boot. */
export default function VoiceList() {
  const lang = useLang();
  const project = useStore(projectStore);
  const voice = useStore(voiceSelStore);
  const soundSel = useStore(soundSelStore);
  const songSel = useStore(songSelStore);
  const sounds = project.sounds ?? [];
  const songs = project.songs ?? [];
  const locked = !!project.locked;

  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-widest text-subtext0">
        {t(lang, "sound.voices")}
      </p>
      <ul className="mt-2 space-y-0.5">
        {[0, 1, 2, 3].map((i) => {
          const v = project.sound?.voices[i] ?? { note: 0, vol: 0 };
          const selected = voice === i && !soundSel && !songSel;
          return (
            <li key={i}>
              <button
                onClick={() => {
                  voiceSelStore.set(i);
                  soundSelStore.set(null);
                  songSelStore.set(null);
                }}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 font-mono text-xs transition-colors ${
                  selected ? "bg-mauve/15 text-mauve" : "text-subtext0 hover:bg-surface0 hover:text-text"
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
      <div className="mt-3 flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-widest text-subtext0">
          {t(lang, "sound.library")} ({sounds.length})
        </p>
        {!locked && (
          <button
            onClick={() => {
              addSound("sound");
              songSelStore.set(null);
            }}
            title={t(lang, "sound.new")}
            aria-label={t(lang, "sound.new")}
            className="grid size-6 place-items-center rounded-md text-subtext0 transition-colors hover:bg-surface0 hover:text-text"
          >
            <Plus size={13} />
          </button>
        )}
      </div>
      {sounds.length === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed border-surface1 px-3 py-3 text-center text-[13px] text-subtext0">
          {t(lang, "sound.library_empty")}
        </p>
      ) : (
        <ul className="mt-2 max-h-56 space-y-0.5 overflow-y-auto">
          {sounds.map((s) => {
            const live = s.voices.filter((v) => v.vol > 0).length;
            return (
              <li key={s.id}>
                <button
                  onClick={() => {
                    soundSelStore.set(s.id);
                    songSelStore.set(null);
                  }}
                  className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 font-mono text-xs transition-colors ${
                    soundSel === s.id && !songSel ? "bg-teal/15 text-teal" : "text-subtext0 hover:bg-surface0 hover:text-text"
                  }`}
                >
                  <Music size={12} className="shrink-0" />
                  <span className="truncate">{s.id}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-overlay0">
                    {live > 0 ? `${live}v` : "—"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-3 flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-widest text-subtext0">
          {t(lang, "song.library")} ({songs.length})
        </p>
        {!locked && (
          <button
            onClick={() => {
              addSong("song");
              soundSelStore.set(null);
            }}
            title={t(lang, "ev.new_song")}
            aria-label={t(lang, "ev.new_song")}
            className="grid size-6 place-items-center rounded-md text-subtext0 transition-colors hover:bg-surface0 hover:text-text"
          >
            <Plus size={13} />
          </button>
        )}
      </div>
      {songs.length === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed border-surface1 px-3 py-3 text-center text-[13px] text-subtext0">
          {t(lang, "song.library_empty")}
        </p>
      ) : (
        <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto">
          {songs.map((s) => {
            const live = s.tracks.filter((tr) => tr.notes.length > 0 && tr.vol > 0).length;
            return (
              <li key={s.id}>
                <button
                  onClick={() => {
                    songSelStore.set(s.id);
                    soundSelStore.set(null);
                  }}
                  className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 font-mono text-xs transition-colors ${
                    songSel === s.id ? "bg-mauve/15 text-mauve" : "text-subtext0 hover:bg-surface0 hover:text-text"
                  }`}
                >
                  <ListMusic size={12} className="shrink-0" />
                  <span className="truncate">{s.id}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-overlay0">
                    {live > 0 ? `${live}v` : "—"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
