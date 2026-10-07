import { useState } from "react";
import { useStore } from "@nanostores/react";
import { X } from "lucide-react";
import { themeColors } from "../lib/palette";
import { spriteTiles } from "../lib/project";
import { projectStore } from "../lib/store";
import { t, useLang } from "../lib/i18n";

/* One sprite thumbnail at any tile size. The grid columns follow the
   sprite width so 2×1 art reads as wide, not stretched. */
export function SpriteThumb({ id, dim = 64 }: { id: string; dim?: number }) {
  const project = useStore(projectStore);
  const pal = themeColors(project.theme);
  const s = project.sprites.find((x) => x.id === id);
  if (!s) return <span className="font-mono text-[10px] text-red">?</span>;
  const [w, h] = spriteTiles(s);
  return (
    <span
      className="grid w-full gap-px"
      style={{ gridTemplateColumns: `repeat(${w * 8}, 1fr)`, maxWidth: dim, margin: "0 auto" }}
    >
      {s.pixels.map((v, i) => (
        <span key={i} className="aspect-square" style={{ background: pal[v & 3] }} />
      ))}
    </span>
  );
}

/* Modal sprite gallery: search + grid + tile dims. Used wherever an
   object needs art — hierarchy creation, inspector sprite row, canvas
   place mode reads the same spriteSelStore. */
export default function SpritePicker({
  open,
  onPick,
  onClose,
}: {
  open: boolean;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const lang = useLang();
  const project = useStore(projectStore);
  const [q, setQ] = useState("");
  if (!open) return null;
  const list = project.sprites.filter((s) => s.id.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div
      className="bg-scrim fixed inset-0 z-[60] grid place-items-center p-4"
      onClick={onClose}
      role="dialog"
      aria-label={t(lang, "sprite.pick_title")}
    >
      <div
        className="pane max-h-[80vh] w-[380px] overflow-hidden rounded-2xl p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <p className="flex-1 font-mono text-[11px] uppercase tracking-widest text-subtext0">
            {t(lang, "sprite.pick_title")} ({list.length})
          </p>
          <button
            onClick={onClose}
            aria-label={t(lang, "sprite.pick_close")}
            className="grid size-6 place-items-center rounded-md text-subtext0 hover:bg-surface0 hover:text-text"
          >
            <X size={13} />
          </button>
        </div>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t(lang, "sprite.pick_search")}
          maxLength={24}
          className="mt-2 w-full rounded-md border border-surface1 bg-base px-2 py-1.5 text-xs outline-none placeholder:text-overlay0 focus:border-mauve"
        />
        {list.length === 0 ? (
          <p className="mt-2 rounded-lg border border-dashed border-surface1 px-3 py-4 text-center text-[13px] text-subtext0">
            {t(lang, "sprite.pick_empty")}
          </p>
        ) : (
          <div className="mt-2 grid max-h-[52vh] grid-cols-3 gap-1.5 overflow-y-auto">
            {list.map((s) => {
              const [w, h] = spriteTiles(s);
              return (
                <button
                  key={s.id}
                  onClick={() => {
                    onPick(s.id);
                    onClose();
                  }}
                  title={`${s.id} · ${w}×${h}`}
                  className="rounded-lg border border-surface0 p-1.5 transition-colors hover:border-mauve/60 hover:bg-mauve/10"
                >
                  <SpriteThumb id={s.id} />
                  <span className="mt-1 block truncate font-mono text-[10px] text-subtext0">
                    {s.id} · {w}×{h}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
