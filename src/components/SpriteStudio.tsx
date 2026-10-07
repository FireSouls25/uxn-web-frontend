import { useEffect, useMemo, useState } from "react";
import { useStore } from "@nanostores/react";
import { Pause, Play } from "lucide-react";
import SpriteEditor from "./SpriteEditor";
import SpriteLibrary from "./SpriteLibrary";
import SpriteTools from "./SpriteTools";
import { SpriteThumb } from "./SpritePicker";
import { spriteTiles } from "../lib/project";
import { t, useLang } from "../lib/i18n";
import { paintColorStore, paintToolStore, projectStore, spriteSelStore } from "../lib/store";

/* Full-page sprite studio (Aseprite spirit, Uxn limits).
   Limits stay hardware: 1-4 8px tiles, 4 palette indices (each any
   RGB via the System theme, 4-bit quantized), animation frames share
   the tile size. Three columns: gallery (all sprites, select + new +
   resize) / painter + animation playback / tools + palette. */
function AnimPreview({ animId }: { animId: string }) {
  const project = useStore(projectStore);
  const anim = project.anims.find((a) => a.id === animId);
  const [playing, setPlaying] = useState(true);
  const [tick, setTick] = useState(0);
  const frames = anim?.frames ?? [];
  const order = useMemo(() => {
    if (!anim || frames.length === 0) return [];
    if (anim.pingpong && anim.loop && frames.length > 2)
      return [...frames, ...frames.slice(1, -1).reverse()];
    return frames;
  }, [anim, frames]);
  useEffect(() => {
    if (!playing || order.length < 2) return;
    const ms = Math.max(1, anim?.rate ?? 6) * (1000 / 60);
    const id = window.setInterval(() => setTick((v) => v + 1), ms);
    return () => window.clearInterval(id);
  }, [playing, order.length, anim?.rate]);
  if (!anim || order.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <SpriteThumb id={order[tick % order.length]} dim={40} />
      <button
        onClick={() => setPlaying((v) => !v)}
        aria-label={playing ? "pause" : "play"}
        className="grid size-6 place-items-center rounded-md text-subtext0 transition-colors hover:bg-surface0 hover:text-text"
      >
        {playing ? <Pause size={12} /> : <Play size={12} />}
      </button>
    </span>
  );
}

export default function SpriteStudio() {
  const lang = useLang();
  const project = useStore(projectStore);
  const spriteId = useStore(spriteSelStore);
  const sprite = project.sprites.find((s) => s.id === spriteId) ?? project.sprites[0] ?? null;
  const [tw, th] = sprite ? spriteTiles(sprite) : [1, 1];
  const locked = !!project.locked;

  // Aseprite-style shortcuts: B brush, E eraser, 1-4 palette colors.
  useEffect(() => {
    if (locked) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) return;
      if (e.key === "b" || e.key === "B") paintToolStore.set("brush");
      else if (e.key === "e" || e.key === "E") paintToolStore.set("erase");
      else if (e.key >= "1" && e.key <= "4") {
        paintColorStore.set(Number(e.key) - 1);
        paintToolStore.set("brush");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [locked]);

  return (
    <div className="absolute inset-0 overflow-auto bg-base">
      <div className="grid min-h-full gap-3 p-3 lg:grid-cols-[264px_minmax(0,1fr)_292px]">
        <section className="dock rounded-2xl p-3">
          <SpriteLibrary />
        </section>
        <section className="dock min-w-0 rounded-2xl p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <p className="font-mono text-[11px] uppercase tracking-widest text-subtext0">
              {t(lang, "hdr.sprites")}
              {sprite && (
                <span className="text-text">
                  {" "}
                  · {sprite.id} · {tw}×{th}
                </span>
              )}
            </p>
            <span className="ml-auto hidden font-mono text-[10px] text-overlay0 xl:block">
              B {t(lang, "sprite.paint")} · E {t(lang, "sprite.erase")} · 1-4 {t(lang, "sprite.color")}
            </span>
          </div>
          <SpriteEditor />
          {project.anims.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 font-mono text-[11px] uppercase tracking-widest text-subtext0">
                {t(lang, "studio.preview")}
              </p>
              <div className="flex flex-wrap gap-2">
                {project.anims.map((a) => (
                  <span
                    key={a.id}
                    title={a.id}
                    className="inline-flex items-center gap-2 rounded-xl border border-surface0 bg-base px-2 py-1"
                  >
                    <span className="max-w-24 truncate font-mono text-[10px] text-subtext0">{a.id}</span>
                    <AnimPreview animId={a.id} />
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>
        <section className="dock h-fit rounded-2xl p-3 lg:sticky lg:top-3">
          <SpriteTools />
        </section>
      </div>
    </div>
  );
}
