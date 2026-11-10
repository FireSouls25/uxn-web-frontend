import { useEffect, useRef } from "react";
import { FlipHorizontal2, FlipVertical2 } from "lucide-react";
import { t, useLang } from "../lib/i18n";
import { cellCount, cellTiles, blendColor, leafPaint, type DrawLook, type Sprite } from "../lib/project";

type Look = DrawLook & { cell?: number };

/* How a node is drawn — Varvara's sprite byte as engine controls:
   which cell of a sheet, mirror X/Y, and the blend (palette remap +
   transparency). The thumbnails paint through leafPaint, the same
   code the scene canvas uses, so what you pick is what the VM draws. */
export default function LookEditor({
  sprite,
  look,
  pal,
  bg,
  disabled,
  onChange,
}: {
  sprite: Sprite | undefined;
  look: Look;
  pal: [string, string, string, string];
  bg: string;
  disabled?: boolean;
  onChange: (patch: Partial<Look>) => void;
}) {
  const lang = useLang();
  if (!sprite) return null;
  const cells = cellCount(sprite);
  const blend = look.blend ?? 1;
  const head = "mb-1 block font-mono text-[11px] uppercase tracking-widest text-subtext0";
  return (
    <div className="space-y-3 rounded-lg border border-surface0 px-3 py-2">
      {cells > 1 && (
        <div>
          <span className={head}>
            {t(lang, "look.cell")} · {(look.cell ?? 0) + 1}/{cells}
          </span>
          <div className="grid grid-cols-6 gap-1">
            {Array.from({ length: cells }, (_, i) => (
              <button
                key={i}
                type="button"
                disabled={disabled}
                aria-pressed={(look.cell ?? 0) === i}
                title={`${t(lang, "look.cell")} ${i}`}
                onClick={() => onChange({ cell: i || undefined })}
                className={`rounded border p-0.5 transition-colors disabled:cursor-not-allowed ${
                  (look.cell ?? 0) === i ? "border-mauve" : "border-surface0 hover:border-mauve/40"
                }`}
              >
                <LookThumb sprite={sprite} look={{ ...look, cell: i }} pal={pal} bg={bg} />
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className={`${head} mb-0 flex-1`}>{t(lang, "look.flip")}</span>
        {(["flipX", "flipY"] as const).map((k) => {
          const Icon = k === "flipX" ? FlipHorizontal2 : FlipVertical2;
          return (
            <button
              key={k}
              type="button"
              disabled={disabled}
              aria-pressed={!!look[k]}
              title={t(lang, k === "flipX" ? "look.flip_x" : "look.flip_y")}
              onClick={() => onChange({ [k]: look[k] ? undefined : true })}
              className={`grid size-7 place-items-center rounded-md transition-colors disabled:cursor-not-allowed ${
                look[k] ? "seg-active" : "text-subtext0 hover:bg-surface0 hover:text-text"
              }`}
            >
              <Icon size={14} />
            </button>
          );
        })}
      </div>
      <div>
        <span className={head} title={t(lang, "look.colors_hint")}>
          {t(lang, "look.colors")} · {blend}
        </span>
        <div className="grid grid-cols-4 gap-1">
          {Array.from({ length: 16 }, (_, b) => (
            <button
              key={b}
              type="button"
              disabled={disabled}
              aria-pressed={blend === b}
              title={`${t(lang, "look.blend")} ${b}${b % 5 === 0 ? ` · ${t(lang, "look.transparent")}` : ""}`}
              onClick={() => onChange({ blend: b === 1 ? undefined : b })}
              className={`flex overflow-hidden rounded border transition-colors disabled:cursor-not-allowed ${
                blend === b ? "border-mauve" : "border-surface0 hover:border-mauve/40"
              }`}
            >
              {[0, 1, 2, 3].map((px) => {
                const c = blendColor(px, b);
                return (
                  <span
                    key={px}
                    className="h-4 flex-1"
                    style={
                      c === null
                        ? { backgroundImage: "repeating-linear-gradient(45deg, #8884 0 2px, transparent 2px 4px)" }
                        : { background: pal[c] }
                    }
                  />
                );
              })}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[10px] leading-snug text-overlay0">{t(lang, "look.colors_hint")}</p>
      </div>
    </div>
  );
}

/** One cell painted through leafPaint over the scene background. */
export function LookThumb({ sprite, look, pal, bg }: { sprite: Sprite; look: Look; pal: [string, string, string, string]; bg: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [tw, th] = cellTiles(sprite);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, tw * 8, th * 8);
    for (const [x, y, c] of leafPaint(sprite, look)) {
      ctx.fillStyle = pal[c];
      ctx.fillRect(x, y, 1, 1);
    }
  }, [sprite, look, pal, bg, tw, th]);
  return <canvas ref={ref} width={tw * 8} height={th * 8} className="block w-full [image-rendering:pixelated]" />;
}
