import { glyphRows } from "../lib/font";

/* Live 8x8 1bpp preview of a dialogue label, drawn from the same
   glyph table the emitter bakes into the ROM — what the canvas shows
   is exactly what the label blits. `w` is the leaf's pixel width, so
   the preview wraps the way the sprite does. */
export default function LabelPreview({ text, w }: { text: string; w: number }) {
  const cols = Math.max(1, Math.floor(w / 8));
  const chars = [...text];
  const rows: number[][] = [];
  for (let i = 0; i < chars.length; i += cols) {
    const line = chars.slice(i, i + cols);
    rows.push(...line.map((ch) => glyphRows(ch.charCodeAt(0))));
  }
  return (
    <svg
      viewBox={`0 0 ${cols * 8} ${rows.length}`}
      preserveAspectRatio="xMinYMin meet"
      role="img"
      aria-label={text}
      className="mt-1.5 h-14 w-full rounded-md bg-base"
    >
      {rows.map((row, r) =>
        row.map((bits, c) =>
          Array.from({ length: 8 }, (_, b) =>
            bits & (1 << (7 - b)) ? (
              <rect key={`${r}-${c}-${b}`} x={c * 8 + b} y={r} width={1} height={1} className="fill-text" />
            ) : null,
          ),
        ),
      )}
    </svg>
  );
}
