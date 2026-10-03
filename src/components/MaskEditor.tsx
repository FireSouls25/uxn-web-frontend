import { t, useLang } from "../lib/i18n";
import type { HitBox } from "../lib/project";

/* Hitbox editor: pixel offsets inside the sprite (the body for
   collision and clicks; the full sprite stays the canvas/drive
   bounds). Shared by the instance inspector and the object editor —
   one widget, same semantics: edit writes a full box, × clears back
   to whole-sprite. */
export default function MaskEditor({
  value,
  full,
  custom,
  onChange,
}: {
  /** Local box, if any. */
  value?: HitBox;
  /** Whole-sprite dims in pixels (shown when no box set). */
  full: [number, number];
  /** Whether a local box overrides a template default (dot). */
  custom: boolean;
  onChange: (mask: HitBox | undefined) => void;
}) {
  const lang = useLang();
  const shown: HitBox = value ?? { x: 0, y: 0, w: full[0], h: full[1] };

  function set(field: keyof HitBox, raw: number) {
    const n = Number.isNaN(raw) ? 0 : Math.round(raw);
    onChange({ ...shown, [field]: n });
  }

  return (
    <div>
      <span className="mb-1 flex items-center font-mono text-[11px] uppercase tracking-widest text-subtext0">
        {t(lang, "insp.mask")}
        {custom && <span className="ml-1 text-teal">●</span>}
        {value && (
          <button
            onClick={() => onChange(undefined)}
            title={t(lang, "insp.mask_full")}
            className="ml-auto font-mono text-[10px] text-subtext0 transition-colors hover:text-text"
          >
            {t(lang, "insp.full")}
          </button>
        )}
      </span>
      <div className="flex items-center gap-1">
        {(["x", "y", "w", "h"] as const).map((field) => (
          <label key={field} className="flex min-w-0 flex-1 items-center gap-1">
            <span className="font-mono text-[10px] text-overlay0">{field}</span>
            <input
              type="number"
              value={shown[field]}
              min={field === "w" || field === "h" ? 1 : 0}
              onChange={(e) => set(field, e.target.valueAsNumber)}
              aria-label={`${t(lang, "insp.mask")} ${field}`}
              className="min-w-0 w-full rounded-md border border-surface1 bg-base px-1.5 py-1 text-right font-mono text-[11px] outline-none focus:border-mauve"
            />
          </label>
        ))}
      </div>
    </div>
  );
}
