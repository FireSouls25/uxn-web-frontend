import { useMemo, useState } from "react";
import { useStore } from "@nanostores/react";
import { Link2, Play } from "lucide-react";
import SongEditor from "./SongEditor";
import SoundEditor from "./SoundEditor";
import SoundMixer, { testTone } from "./SoundMixer";
import VoiceEditor from "./VoiceEditor";
import VoiceList from "./VoiceList";
import { flattenScene } from "../lib/project";
import { t, useLang } from "../lib/i18n";
import {
  addBlock,
  addEvent,
  canvasModeStore,
  currentScene,
  projectStore,
  sceneIdStore,
  selectionStore,
  songSelStore,
  soundSelStore,
  viewStore,
  voiceSelStore,
  type EventOwner,
} from "../lib/store";

/* Full-page sound studio. Uxn limits stay: 4 voices (index = Audio
   device), MIDI notes 0-107, one shared square wave. Two libraries
   share those voices: named sounds are one-shots that fire from play
   blocks, named songs are 4-voice loops the shared sequencer ticks
   every frame (Phase C). Columns: libraries + boot mix / editor /
   usage + attach (join either to an object event or scene enter). */
interface Usage {
  sceneId: string;
  path: string;
  label: string;
  eventId: string;
  block: number;
}

function usagesOf(
  project: ReturnType<typeof projectStore.get>,
  id: string,
  op: "play" | "song",
): Usage[] {
  const out: Usage[] = [];
  for (const s of project.scenes) {
    let leaves;
    try {
      leaves = flattenScene(project, s.id);
    } catch {
      continue;
    }
    for (const l of leaves) {
      if (l.path.includes("/")) continue;
      for (const e of l.events ?? []) {
        e.blocks.forEach((b, i) => {
          const named = op === "play" ? (b as { op: string }).op === "play" && (b as { sound?: string }).sound === id
            : (b as { op: string }).op === "song" && (b as { song?: string }).song === id;
          if (named) out.push({ sceneId: s.id, path: l.path, label: l.id, eventId: e.id, block: i });
        });
      }
    }
  }
  return out;
}

function AttachPanel({ id, op }: { id: string; op: "play" | "song" }) {
  const lang = useLang();
  const project = useStore(projectStore);
  const [scene, setScene] = useState(project.scenes[0]?.id ?? "");
  const [leaf, setLeaf] = useState("");
  const [trigger, setTrigger] = useState("create");
  const locked = !!project.locked;

  const sc = useMemo(() => {
    try {
      return currentScene(project, scene || project.scenes[0]?.id || "");
    } catch {
      return null;
    }
  }, [project, scene]);
  const leaves = useMemo(() => {
    if (!sc) return [];
    try {
      return flattenScene(project, sc.id).filter((l) => !l.path.includes("/"));
    } catch {
      return [];
    }
  }, [project, sc]);
  const leafId = leaf || leaves[0]?.id || "";
  const owner: EventOwner | null = useMemo(() => {
    const l = leaves.find((x) => x.id === leafId);
    if (!l) return null;
    return l.def ? { def: l.def } : { leaf: l.id };
  }, [leaves, leafId]);

  if (locked || !sc) return null;
  return (
    <div className="rounded-xl border border-surface0 p-2.5">
      <p className="mb-2 font-mono text-[11px] uppercase tracking-widest text-subtext0">
        {t(lang, "studio.attach")}
      </p>
      <div className="space-y-1.5">
        <select value={sc.id} onChange={(e) => { setScene(e.target.value); setLeaf(""); }} className="select w-full" aria-label="scene">
          {project.scenes.map((s) => (
            <option key={s.id} value={s.id}>{s.id}</option>
          ))}
        </select>
        <select value={leafId} onChange={(e) => setLeaf(e.target.value)} className="select w-full" aria-label="object">
          {leaves.map((l) => (
            <option key={l.id} value={l.id}>{l.id} · {l.kind}</option>
          ))}
        </select>
        <select value={trigger} onChange={(e) => setTrigger(e.target.value)} className="select w-full" aria-label="trigger">
          {["create", "step", "click", "key", "collide", "alarm", "destroy"].map((tr) => (
            <option key={tr} value={tr}>{tr}</option>
          ))}
        </select>
        <button
          disabled={!owner}
          onClick={() => {
            if (!owner) return;
            let ev = leaves.find((x) => x.id === leafId)?.events.find((e) => e.trigger === (trigger as "create"))?.id ?? null;
            if (!ev)
              ev = addEvent(
                owner,
                trigger as "create",
                trigger === "key"
                  ? { key: project.inputs[0]?.id }
                  : trigger === "collide"
                    ? { target: "any" }
                    : undefined,
              );
            if (ev) {
              addBlock(owner, ev, op === "song" ? { op: "song", song: id } : { op: "play", sound: id });
              sceneIdStore.set(sc.id);
              canvasModeStore.set("logic");
              viewStore.set("events");
            }
          }}
          className="seg-active inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
        >
          <Link2 size={13} /> {t(lang, "studio.attach")} · {id}
        </button>
        <p className="font-mono text-[10px] leading-relaxed text-overlay0">
          {t(lang, op === "song" ? "song.hint" : "sound.library_hint")}
        </p>
      </div>
    </div>
  );
}

export default function SoundStudio() {
  const lang = useLang();
  const project = useStore(projectStore);
  const soundSel = useStore(soundSelStore);
  const voice = useStore(voiceSelStore);
  const songSel = useStore(songSelStore);
  const sound = (project.sounds ?? []).find((s) => s.id === soundSel) ?? null;
  const song = (project.songs ?? []).find((s) => s.id === songSel) ?? null;
  const locked = !!project.locked;

  const usages = useMemo(
    () => (sound ? usagesOf(project, sound.id, "play") : song ? usagesOf(project, song.id, "song") : []),
    [project, sound, song],
  );

  function audition() {
    if (!sound) return;
    sound.voices.forEach((v, i) => {
      if (v.vol > 0) window.setTimeout(() => testTone(v.note), i * 140);
    });
  }

  function jump(u: Usage) {
    sceneIdStore.set(u.sceneId);
    selectionStore.set(u.path);
    canvasModeStore.set("logic");
    viewStore.set("events");
  }

  return (
    <div className="absolute inset-0 overflow-auto bg-base">
      <div className="grid min-h-full gap-3 p-3 lg:grid-cols-[264px_minmax(0,1fr)_300px]">
        <section className="dock rounded-2xl p-3">
          <VoiceList />
        </section>
        <section className="dock min-w-0 rounded-2xl p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <p className="font-mono text-[11px] uppercase tracking-widest text-subtext0">
              {song ? (
                <>{t(lang, "song.library")} · <span className="text-text">{song.id}</span></>
              ) : sound ? (
                <>{t(lang, "sound.library")} · <span className="text-text">{sound.id}</span></>
              ) : (
                <>{t(lang, "sound.voices")} · <span className="text-text">{t(lang, "sound.once")}</span></>
              )}
            </p>
            {sound && !locked && (
              <button
                onClick={audition}
                className="seg-active ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold"
              >
                <Play size={13} /> {t(lang, "studio.sequence")}
              </button>
            )}
          </div>
          {song ? <SongEditor id={song.id} /> : sound ? <SoundEditor id={sound.id} /> : (
            <div className="space-y-4">
              <SoundMixer />
              <div>
                <p className="mb-2 font-mono text-[11px] uppercase tracking-widest text-subtext0">
                  {t(lang, "sound.voice")} {voice}
                </p>
                <VoiceEditor />
              </div>
            </div>
          )}
        </section>
        <section className="dock h-fit space-y-3 rounded-2xl p-3 lg:sticky lg:top-3">
          <div>
            <p className="mb-2 font-mono text-[11px] uppercase tracking-widest text-subtext0">
              {t(lang, "studio.usage")} {sound || song ? `· ${usages.length}` : ""}
            </p>
            {!sound && !song ? (
              <p className="rounded-xl border border-dashed border-surface1 px-3 py-3 text-center text-[13px] text-subtext0">
                {t(lang, "studio.no_sound")}
              </p>
            ) : usages.length === 0 ? (
              <p className="rounded-xl border border-dashed border-surface1 px-3 py-3 text-center text-[13px] text-subtext0">
                {t(lang, "sound.library_empty")}
              </p>
            ) : (
              <ul className="max-h-64 space-y-1 overflow-y-auto">
                {usages.map((u, i) => (
                  <li key={i}>
                    <button
                      onClick={() => jump(u)}
                      title={t(lang, "studio.open_logic")}
                      className="flex w-full items-center gap-2 rounded-lg border border-surface0 px-2.5 py-1.5 text-left font-mono text-[11px] transition-colors hover:border-surface1"
                    >
                      <span className="truncate text-text">{u.sceneId}/{u.label}</span>
                      <span className="ml-auto shrink-0 text-overlay0">{u.eventId}#{u.block}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {(sound || song) && <AttachPanel id={(sound ?? song)!.id} op={song ? "song" : "play"} />}
        </section>
      </div>
    </div>
  );
}
