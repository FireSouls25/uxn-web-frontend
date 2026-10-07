import { useEffect, useMemo, useState } from "react";
import { useStore } from "@nanostores/react";
import { Box, Hash, Image, KeySquare, Map as MapIcon, Music } from "lucide-react";
import { t, useLang } from "../lib/i18n";
import {
  defSelStore,
  projectStore,
  sceneIdStore,
  selectionStore,
  soundSelStore,
  spriteSelStore,
  viewStore,
} from "../lib/store";

interface Hit {
  kind: "scene" | "def" | "sprite" | "sound" | "input";
  id: string;
  sub: string;
}

/* Go-to-everything (Ctrl/Cmd+K): scenes, templates, sprites, sounds,
   inputs. Enter jumps to the first match — the GameMaker Ctrl+T
   habit (K, because browsers own T). Ignored while typing. */
export default function CommandPalette() {
  const lang = useLang();
  const project = useStore(projectStore);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (!typing) {
          setQ("");
          setActive(0);
          setOpen((v) => !v);
        }
        return;
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const hits: Hit[] = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const match = (id: string): boolean => needle === "" || id.toLowerCase().includes(needle);
    const out: Hit[] = [];
    for (const s of project.scenes) if (match(s.id)) out.push({ kind: "scene", id: s.id, sub: `${s.nodes.length}` });
    for (const d of project.objectDefs ?? []) if (match(d.id)) out.push({ kind: "def", id: d.id, sub: d.kind });
    for (const s of project.sprites) if (match(s.id)) out.push({ kind: "sprite", id: s.id, sub: "" });
    for (const s of project.sounds ?? []) if (match(s.id)) out.push({ kind: "sound", id: s.id, sub: "" });
    for (const i of project.inputs ?? []) if (match(i.id)) out.push({ kind: "input", id: i.id, sub: `${i.key}` });
    return out.slice(0, 30);
  }, [project, q]);

  function jump(h: Hit) {
    if (h.kind === "scene") {
      sceneIdStore.set(h.id);
      selectionStore.set(null);
      defSelStore.set(null);
      viewStore.set("scene");
    } else if (h.kind === "def") {
      defSelStore.set(h.id);
      selectionStore.set(null);
      viewStore.set("scene");
    } else if (h.kind === "sprite") {
      spriteSelStore.set(h.id);
      viewStore.set("sprites");
    } else if (h.kind === "sound") {
      soundSelStore.set(h.id);
      viewStore.set("sound");
    } else {
      viewStore.set("events");
    }
    setOpen(false);
  }

  useEffect(() => {
    setActive(0);
  }, [q]);

  if (!open) return null;
  const icons = { scene: MapIcon, def: Box, sprite: Image, sound: Music, input: KeySquare } as const;
  return (
    <div
      className="bg-scrim fixed inset-0 z-[70] grid place-items-start justify-center p-4 pt-[12vh]"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-label={t(lang, "cmd.title")}
    >
      <div
        className="pane w-[420px] overflow-hidden rounded-2xl p-2"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(hits.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter" && hits[active]) {
            jump(hits[active]);
          }
        }}
      >
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t(lang, "cmd.placeholder")}
          maxLength={32}
          className="w-full rounded-lg border border-surface1 bg-base px-3 py-2 text-[13px] outline-none placeholder:text-overlay0 focus:border-mauve"
        />
        {hits.length === 0 ? (
          <p className="px-3 py-4 text-center text-[13px] text-subtext0">{t(lang, "cmd.empty")}</p>
        ) : (
          <ul className="mt-1 max-h-[40vh] overflow-y-auto">
            {hits.map((h, i) => {
              const Icon = icons[h.kind];
              return (
                <li key={`${h.kind}:${h.id}`}>
                  <button
                    onClick={() => jump(h)}
                    onMouseEnter={() => setActive(i)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left ${
                      i === active ? "bg-mauve/15 text-text" : "text-subtext0"
                    }`}
                  >
                    <Icon size={13} className={i === active ? "text-mauve" : ""} />
                    <span className="flex-1 truncate font-mono text-[12px]">{h.id}</span>
                    <span className="font-mono text-[10px] text-overlay0">
                      {t(lang, `cmd.${h.kind}`)}
                      {h.sub ? ` · ${h.sub}` : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
