import { useState } from "react";
import { useStore } from "@nanostores/react";
import { Play, Trash2 } from "lucide-react";
import { t, useLang } from "../lib/i18n";
import { noteName, testTone } from "./SoundMixer";
import { deleteSound, projectStore, renameSound, setSoundVoice } from "../lib/store";

/* Right column when a named sound is selected: rename, four voice
   rows (index = Audio device), per-voice test tones, and delete
   (refused while a play block names it — validation would flag the
   dangling ref, so the editor refuses first with the reason). */
export default function SoundEditor({ id }: { id: string }) {
  const lang = useLang();
  const project = useStore(projectStore);
  const [rename, setRename] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sound = (project.sounds ?? []).find((s) => s.id === id);
  if (!sound) return null;
  const locked = !!project.locked;
  const voices = [0, 1, 2, 3].map((i) => sound.voices[i] ?? { note: 0, vol: 0 });

  function commitDelete() {
    const err = deleteSound(id);
    setError(err);
  }

  return (
    <div>
      <fieldset disabled={locked} className="space-y-2">
      <div className="flex items-center gap-1.5">
        {rename === null ? (
          <button
            onClick={() => {
              setRename(sound.id);
              setError(null);
            }}
            title={t(lang, "sound.rename")}
            className="flex-1 truncate text-left text-[13px] font-semibold hover:text-teal"
          >
            {sound.id}
          </button>
        ) : (
          <input
            autoFocus
            value={rename}
            onChange={(e) => setRename(e.target.value)}
            onBlur={() => setRename(null)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const err = renameSound(sound.id, rename);
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
          onClick={commitDelete}
          title={t(lang, "sound.delete")}
          aria-label={`${t(lang, "sound.delete")} ${sound.id}`}
          className="grid size-6 shrink-0 place-items-center rounded-md text-subtext0 transition-colors hover:bg-surface0 hover:text-red"
        >
          <Trash2 size={13} />
        </button>
      </div>
      {error && <p className="mt-1 text-[12px] text-red">{error}</p>}
      <div className="mt-2 space-y-1.5">
        {voices.map((v, i) => (
          <div key={i} className="flex items-center gap-1.5 rounded-lg border border-surface0 px-2.5 py-1.5">
            <span className="w-4 font-mono text-[11px] text-subtext0">{i}</span>
            <input
              type="number"
              aria-label={`${t(lang, "sound.note")} ${i}`}
              value={v.note}
              min={0}
              max={107}
              onChange={(e) => setSoundVoice(id, i, e.target.valueAsNumber || 0, v.vol)}
              className="w-14 rounded-md border border-surface1 bg-base px-1.5 py-1 text-right font-mono text-[11px] outline-none focus:border-mauve"
            />
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-overlay0">{noteName(v.note)}</span>
            <input
              type="number"
              aria-label={`${t(lang, "sound.vol")} ${i}`}
              value={v.vol}
              min={0}
              max={255}
              onChange={(e) => setSoundVoice(id, i, v.note, e.target.valueAsNumber || 0)}
              className="w-14 rounded-md border border-surface1 bg-base px-1.5 py-1 text-right font-mono text-[11px] outline-none focus:border-mauve"
            />
            <button
              onClick={() => testTone(v.note)}
              aria-label={`${t(lang, "sound.test")} ${i}`}
              className="grid size-6 shrink-0 place-items-center rounded-md text-subtext0 transition-colors hover:bg-surface0 hover:text-text"
            >
              <Play size={12} />
            </button>
          </div>
        ))}
      </div>
      </fieldset>
      <p className="mt-2 font-mono text-[10px] leading-relaxed text-overlay0">{t(lang, "sound.library_hint")}</p>
    </div>
  );
}
