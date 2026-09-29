import { useState } from "react";
import { useStore } from "@nanostores/react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Brush,
  Eraser,
  Film,
  FlipHorizontal2,
  FlipVertical2,
  PaintBucket,
  Plus,
} from "lucide-react";
import { PALETTE } from "../lib/palette";
import { t, useLang } from "../lib/i18n";
import {
  addAnimation,
  addSprite,
  projectStore,
  setSpritePixels,
  spriteSelStore,
} from "../lib/store";

/* Full sprite view: gallery of every project sprite, animation
   builder over sprite ids, and a big 8×8 painter in the four real
   Uxn palette colors (2bpp, opaque — index 0 paints background). */
export default function SpriteEditor() {
  const lang = useLang();
  const project = useStore(projectStore);
  const spriteId = useStore(spriteSelStore);
  const [color, setColor] = useState(1);
  const [tool, setTool] = useState<"brush" | "erase">("brush");
  const [newName, setNewName] = useState("");

  const sprite = project.sprites.find((s) => s.id === spriteId) ?? project.sprites[0] ?? null;
  const pixels = sprite?.pixels ?? Array(64).fill(0);

  function paint(r: number, c: number) {
    if (!sprite) return;
    const next = [...pixels];
    next[r * 8 + c] = tool === "brush" ? color : 0;
    setSpritePixels(sprite.id, next);
  }

  function transform(fn: (px: number[]) => number[]) {
    if (!sprite) return;
    setSpritePixels(sprite.id, fn([...pixels]));
  }
  const flipH = (px: number[]) => px.map((_, i) => px[Math.floor(i / 8) * 8 + (7 - (i % 8))]);
  const flipV = (px: number[]) => px.map((_, i) => px[(7 - Math.floor(i / 8)) * 8 + (i % 8)]);
  const shift = (dx: number, dy: number) => (px: number[]) => {
    const out = Array(64).fill(0);
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) out[((r + dy + 8) % 8) * 8 + ((c + dx + 8) % 8)] = px[r * 8 + c];
    return out;
  };

  const iconBtn =
    "grid size-8 place-items-center rounded-md text-subtext0 transition-colors hover:bg-surface0 hover:text-text";

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      {/* Gallery + animations */}
      <div>
        <p className="font-mono text-[11px] uppercase tracking-widest text-subtext0">
          {t(lang, "sprite.gallery")} ({project.sprites.length})
        </p>
        <div className="mt-2 grid grid-cols-4 gap-1.5 lg:grid-cols-3">
          {project.sprites.map((s) => (
            <button
              key={s.id}
              onClick={() => spriteSelStore.set(s.id)}
              title={s.id}
              className={`rounded-lg border p-1.5 transition-colors ${
                s.id === sprite?.id ? "border-mauve/60 bg-mauve/10" : "border-surface0 hover:border-surface1"
              }`}
            >
              <span
                className="grid w-full gap-px"
                style={{ gridTemplateColumns: "repeat(8, 1fr)" }}
              >
                {s.pixels.map((v, i) => (
                  <span key={i} className="aspect-square" style={{ background: PALETTE[v & 3] }} />
                ))}
              </span>
              <span className="mt-1 block truncate font-mono text-[10px] text-subtext0">{s.id}</span>
            </button>
          ))}
        </div>
        <form
          className="mt-2 flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (newName.trim()) {
              addSprite(newName.trim());
              setNewName("");
            }
          }}
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t(lang, "sprite.new_ph")}
            maxLength={24}
            className="min-w-0 flex-1 rounded-md border border-surface1 bg-base px-2 py-1 text-xs outline-none placeholder:text-overlay0 focus:border-mauve"
          />
          <button
            type="submit"
            aria-label={t(lang, "sprite.new")}
            className="grid size-7 shrink-0 place-items-center rounded-md bg-surface0 transition-colors hover:bg-surface1"
          >
            <Plus size={14} />
          </button>
        </form>

        <p className="mt-4 font-mono text-[11px] uppercase tracking-widest text-subtext0">
          {t(lang, "sprite.anims")} ({project.anims.length})
        </p>
        <div className="mt-2 space-y-1.5">
          {project.anims.map((a) => (
            <div key={a.id} className="rounded-lg border border-surface0 px-2.5 py-1.5">
              <p className="flex items-center gap-1.5 font-mono text-[11px] text-text">
                <Film size={12} className="text-teal" /> {a.id}
                <span className="ml-auto text-subtext0">×{a.rate} {a.loop ? "∞" : "1"}</span>
              </p>
              <p className="mt-0.5 truncate font-mono text-[10px] text-subtext0">{a.frames.join(" → ")}</p>
            </div>
          ))}
        </div>
        <button
          onClick={() => sprite && addAnimation([sprite.id])}
          className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-surface0 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface1"
        >
          <Plus size={13} /> {t(lang, "sprite.new_anim")}
        </button>
      </div>

      {/* Painter */}
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-1">
          {[0, 1, 2, 3].map((i) => (
            <button
              key={i}
              onClick={() => {
                setColor(i);
                setTool("brush");
              }}
              title={`${t(lang, "sprite.color")} ${i}${i === 0 ? ` (${t(lang, "sprite.bg")})` : ""}`}
              className={`size-7 rounded-md border-2 transition-transform ${
                color === i && tool === "brush" ? "scale-110 border-mauve" : "border-transparent"
              }`}
              style={{ background: PALETTE[i] }}
            />
          ))}
          <span className="mx-1 h-5 w-px bg-surface1" />
          <button onClick={() => setTool("brush")} title={t(lang, "sprite.paint")} className={tool === "brush" ? `${iconBtn} bg-surface0 text-mauve` : iconBtn}>
            <Brush size={15} />
          </button>
          <button onClick={() => setTool("erase")} title={t(lang, "sprite.erase")} className={tool === "erase" ? `${iconBtn} bg-surface0 text-mauve` : iconBtn}>
            <Eraser size={15} />
          </button>
          <button onClick={() => sprite && setSpritePixels(sprite.id, Array(64).fill(color))} title={t(lang, "sprite.fill")} className={iconBtn}>
            <PaintBucket size={15} />
          </button>
          <button onClick={() => transform(flipH)} title="flip ↔" className={iconBtn}>
            <FlipHorizontal2 size={15} />
          </button>
          <button onClick={() => transform(flipV)} title="flip ↕" className={iconBtn}>
            <FlipVertical2 size={15} />
          </button>
          <button onClick={() => transform(shift(-1, 0))} title="←" className={iconBtn}>
            <ArrowLeft size={15} />
          </button>
          <button onClick={() => transform(shift(1, 0))} title="→" className={iconBtn}>
            <ArrowRight size={15} />
          </button>
          <button onClick={() => transform(shift(0, -1))} title="↑" className={iconBtn}>
            <ArrowUp size={15} />
          </button>
          <button onClick={() => transform(shift(0, 1))} title="↓" className={iconBtn}>
            <ArrowDown size={15} />
          </button>
        </div>
        {sprite ? (
          <div
            className="grid w-fit gap-px rounded-lg border border-surface0 bg-surface0 p-2"
            style={{ gridTemplateColumns: "repeat(8, min(34px, 7vw))" }}
          >
            {pixels.map((v, i) => {
              const r = Math.floor(i / 8);
              const c = i % 8;
              return (
                <button
                  key={i}
                  aria-label={`pixel ${r},${c}`}
                  onPointerDown={() => paint(r, c)}
                  onPointerEnter={(e) => {
                    if (e.buttons === 1) paint(r, c);
                  }}
                  className="aspect-square rounded-[3px]"
                  style={{ background: PALETTE[v & 3] }}
                />
              );
            })}
          </div>
        ) : null}
        <p className="mt-2 font-mono text-[11px] text-subtext0">{t(lang, "sprite.hint")}</p>
      </div>
    </div>
  );
}
