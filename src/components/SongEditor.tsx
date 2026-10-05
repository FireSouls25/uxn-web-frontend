import { useState } from "react";
import { useStore } from "@nanostores/react";
import { Play, Trash2 } from "lucide-react";
import { t, useLang } from "../lib/i18n";
import { noteName, testTone } from "./SoundMixer";
import {
  deleteSong,
  projectStore,
  renameSong,
  setSongNote,
  setSongVol,
} from "../lib/store";

/* Center column of the sound view when a song is selected: a 4x16
   step grid, one row per sequencer voice (voice index = Audio
   device). Click a cell to type a pitch, click it again on the same
   pitch to clear the step; len sets how many ticks it holds. The
   grid mirrors lib/song.ux Note exactly — 16 steps max because the
   live track buffers are 16 bytes per voice. */
const PITCHES = [48, 52, 55, 57, 60, 62, 64, 67, 69, 72, 74, 76];

export default function SongEditor({ id }: { id: string }) {
  const lang = useLang();
  const project = useStore(projectStore);
  const [rename, setRename] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voice, setVoice] = useState(0);

  const found = (project.songs ?? []).find((s) => s.id === id);
  if (!found) return null;
  const song = found;
  const locked = !!project.locked;
  const steps = Math.max(4, ...song.tracks.map((tr) => tr.notes.length));
  const track = song.tracks[voice] ?? { notes: [], vol: 0 };

  function audition() {
    // Walk the loop at 140ms per step, the same feel as the ROM tick.
    let t = 0;
    for (const tr of song.tracks) {
      tr.notes.forEach((n, i) => {
        if (n.pitch === 127 || n.pitch > 107) return;
        const at = i * 140;
        for (let k = 0; k < n.len && k < 8; k++) {
          window.setTimeout(() => testTone(n.pitch), at + k * 140);
        }
        t = Math.max(t, at + n.len * 140);
      });
    }
    void t;
  }

  return (
    <div>
      <fieldset disabled={locked} className="space-y-2">
        <div className="flex items-center gap-1.5">
          {rename === null ? (
            <button
              onClick={() => {
                setRename(song.id);
                setError(null);
              }}
              title={t(lang, "sound.rename")}
              className="flex-1 truncate text-left text-[13px] font-semibold hover:text-teal"
            >
              {song.id}
            </button>
          ) : (
            <input
              autoFocus
              value={rename}
              onChange={(e) => setRename(e.target.value)}
              onBlur={() => setRename(null)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const err = renameSong(song.id, rename);
                  setError(err);
                  if (!err) setRename(null);
                }
                if (e.key === "Escape") setRename(null);
              }}
              maxLength={24}
              className="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none"
            />
          )}
          <button
            onClick={audition}
            title={t(lang, "sound.test")}
            aria-label={t(lang, "studio.sequence")}
            className="grid size-6 shrink-0 place-items-center rounded-md text-subtext0 transition-colors hover:bg-surface0 hover:text-text"
          >
            <Play size={13} />
          </button>
          <button
            onClick={() => setError(deleteSong(id))}
            title={t(lang, "sound.delete")}
            aria-label={`${t(lang, "sound.delete")} ${song.id}`}
            className="grid size-6 shrink-0 place-items-center rounded-md text-subtext0 transition-colors hover:bg-surface0 hover:text-red"
          >
            <Trash2 size={13} />
          </button>
        </div>
        {error && <p className="mt-1 text-[12px] text-red">{error}</p>}
        <div className="mt-2 flex items-center gap-1.5">
          {[0, 1, 2, 3].map((i) => {
            const tr = song.tracks[i] ?? { notes: [], vol: 0 };
            const live = tr.notes.filter((n) => n.pitch !== 127 && n.pitch <= 107).length;
            return (
              <button
                key={i}
                onClick={() => setVoice(i)}
                title={`${t(lang, "sound.voice")} ${i}`}
                className={`flex flex-1 items-center gap-1 rounded-lg border px-1.5 py-1 font-mono text-[10px] transition-colors ${
                  voice === i ? "border-mauve text-mauve" : "border-surface0 text-subtext0 hover:border-surface1"
                }`}
              >
                {i}
                <span className="ml-auto text-overlay0">{live > 0 ? `${live}` : "—"}</span>
              </button>
            );
          })}
          <input
            type="number"
            aria-label={`${t(lang, "sound.vol")} ${voice}`}
            value={track.vol}
            min={0}
            max={255}
            onChange={(e) => setSongVol(id, voice, e.target.valueAsNumber || 0)}
            className="w-14 shrink-0 rounded-md border border-surface1 bg-base px-1.5 py-1 text-right font-mono text-[11px] outline-none focus:border-mauve"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0.5">
            <tbody>
              {Array.from({ length: steps }, (_, i) => (
                <tr key={i}>
                  <td className="w-6 pr-1 text-right font-mono text-[10px] text-overlay0">{i}</td>
                  {Array.from({ length: 16 }, (_, s) => {
                    const note = track.notes[s];
                    const pitch = note?.pitch;
                    const live = pitch !== undefined && pitch !== 127 && pitch <= 107;
                    return (
                      <td key={s} className="p-0">
                        <button
                          onClick={() => setError(setSongNote(id, voice, s, live ? null : defaultPitch(i)))}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setError(setSongNote(id, voice, s, null));
                          }}
                          title={
                            live && pitch !== undefined
                              ? `${noteName(pitch)} · ${note?.len ?? 1}t`
                              : `${t(lang, "song.empty_step")}`
                          }
                          aria-label={`${t(lang, "sound.voice")} ${voice} step ${s}`}
                          className={`h-6 w-full min-w-5 rounded-sm border transition-colors ${
                            live
                              ? "border-teal/50 bg-teal/30"
                              : "border-dashed border-surface0 hover:border-surface1"
                          }`}
                        >
                          <span className="font-mono text-[9px] text-text">
                            {live && pitch !== undefined ? noteName(pitch).replace(/[0-9-]/g, "") : ""}
                          </span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span className="font-mono text-[10px] text-overlay0">{t(lang, "song.pitch")}</span>
          {PITCHES.map((p) => (
            <button
              key={p}
              onClick={() => {
                const target = track.notes.findIndex((n) => n.pitch === p);
                const s = target >= 0 ? target : track.notes.length;
                if (s > 15) {
                  setError(t(lang, "song.full"));
                  return;
                }
                setError(setSongNote(id, voice, s, p, track.notes[s]?.len ?? 2));
              }}
              title={noteName(p)}
              className="rounded-md border border-surface0 px-1.5 py-0.5 font-mono text-[10px] text-subtext0 transition-colors hover:border-surface1 hover:text-text"
            >
              {noteName(p)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span className="font-mono text-[10px] text-overlay0">{t(lang, "song.len")}</span>
          {[1, 2, 3, 4, 6, 8].map((l) => (
            <button
              key={l}
              onClick={() => {
                const last = track.notes.length - 1;
                if (last < 0) {
                  setError(t(lang, "song.no_notes"));
                  return;
                }
                const p = track.notes[last].pitch;
                setError(setSongNote(id, voice, last, p === 127 ? null : p, l));
              }}
              className="rounded-md border border-surface0 px-1.5 py-0.5 font-mono text-[10px] text-subtext0 transition-colors hover:border-surface1 hover:text-text"
            >
              {l}t
            </button>
          ))}
          <button
            onClick={() => {
              const last = track.notes.length - 1;
              if (last < 0) return;
              setError(setSongNote(id, voice, last, track.notes[last].pitch, track.notes[last].len - 1));
            }}
            title={t(lang, "song.shorter")}
            className="rounded-md border border-surface0 px-1.5 py-0.5 font-mono text-[10px] text-subtext0 transition-colors hover:border-surface1 hover:text-text"
          >
            −
          </button>
        </div>
      </fieldset>
      <p className="mt-2 font-mono text-[10px] leading-relaxed text-overlay0">{t(lang, "song.hint")}</p>
    </div>
  );
}

/** C-major ladder by row: an empty grid types a bass line from the
    bottom row up, so filling four voices reads like an arpeggio. */
function defaultPitch(step: number): number {
  const LADDER = [48, 52, 55, 57, 60, 62, 64, 67, 69, 72, 74, 76];
  return LADDER[(step * 5 + 3) % LADDER.length];
}
