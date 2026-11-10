/* Pixel-art helpers for the examples: draw on a small canvas of
   palette indices (0–3) with shapes, outlines and dithering, then cut
   it into engine sprites. Everything is plain data at build time, so
   the generated art is ordinary studio sprites the user can repaint. */
import { FONT8X8 } from "../font";
import type { Sprite } from "../project";

/** Rows of palette digits (8·w wide, 8·h tall) → tile-major pixels. */
export function art(id: string, rows: string[], cell?: { w: number; h: number }): Sprite {
  const w = rows[0].length / 8;
  const h = rows.length / 8;
  const pixels: number[] = [];
  for (let ty = 0; ty < h; ty++)
    for (let tx = 0; tx < w; tx++)
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) pixels.push(Number(rows[ty * 8 + y][tx * 8 + x]));
  return { id, w, h, pixels, ...(cell ? { cell } : {}) };
}

export class Canvas {
  readonly px: number[][];
  constructor(
    readonly w: number,
    readonly h: number,
    fill = 0,
  ) {
    this.px = Array.from({ length: h }, () => new Array<number>(w).fill(fill));
  }
  static from(rows: string[]): Canvas {
    const c = new Canvas(rows[0].length, rows.length);
    rows.forEach((r, y) => [...r].forEach((ch, x) => c.set(x, y, Number(ch))));
    return c;
  }
  get(x: number, y: number): number {
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.px[y][x] : 0;
  }
  set(x: number, y: number, c: number): this {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[Math.floor(y)][Math.floor(x)] = c;
    return this;
  }
  rect(x: number, y: number, w: number, h: number, c: number): this {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
    return this;
  }
  /** Filled ellipse centered on (cx, cy) (pixel centers at +0.5). */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: number): this {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, c);
      }
    return this;
  }
  disc(cx: number, cy: number, r: number, c: number): this {
    return this.ellipse(cx, cy, r, r, c);
  }
  line(x0: number, y0: number, x1: number, y1: number, c: number): this {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) this.set(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), c);
    return this;
  }
  /** Recolor pixels of color `from` where `where(x, y)` holds. */
  paint(from: number, to: number, where: (x: number, y: number) => boolean): this {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.px[y][x] === from && where(x, y)) this.px[y][x] = to;
    return this;
  }
  /** Checkerboard shading: recolor every other `from` pixel in a region. */
  dither(from: number, to: number, where: (x: number, y: number) => boolean = () => true): this {
    return this.paint(from, to, (x, y) => (x + y) % 2 === 0 && where(x, y));
  }
  /** Trace an outline of color `c` around every non-zero shape (on the
      empty pixels next to it, 4-neighbour). */
  outline(c: number): this {
    const hit: Array<[number, number]> = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (this.px[y][x] === 0 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const v = this.get(x + dx, y + dy); return v !== 0 && v !== c; }))
          hit.push([x, y]);
    for (const [x, y] of hit) this.px[y][x] = c;
    return this;
  }
  /** Draw `rows` (digit strings, "0" transparent) at (x, y). */
  stamp(x: number, y: number, rows: string[]): this {
    rows.forEach((r, j) => [...r].forEach((ch, i) => ch !== "0" && this.set(x + i, y + j, Number(ch))));
    return this;
  }
  flipX(): Canvas {
    const c = new Canvas(this.w, this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) c.px[y][x] = this.px[y][this.w - 1 - x];
    return c;
  }
  rows(): string[] {
    return this.px.map((r) => r.join(""));
  }
  crop(x: number, y: number, w: number, h: number): string[] {
    return this.px.slice(y, y + h).map((r) => r.slice(x, x + w).join(""));
  }
  sprite(id: string, cell?: { w: number; h: number }): Sprite {
    return art(id, this.rows(), cell);
  }
}

/** Cut rows into sprites of `width` px named `${id}_0`, `_1`, … */
export function slices(id: string, rows: string[], width = 32): Sprite[] {
  const out: Sprite[] = [];
  for (let x = 0, i = 0; x < rows[0].length; x += width, i++) out.push(art(`${id}_${i}`, rows.map((r) => r.slice(x, x + width))));
  return out;
}

/** Headline type: the 8×8 font at 2× in `ink` with a `shadow` offset
    by 2px, two letters per 32×24 sprite. */
export function bigText(id: string, text: string, ink = 1, shadow = 3): Sprite[] {
  const padded = text.length % 2 ? `${text} ` : text;
  const c = new Canvas(padded.length * 16, 24);
  for (const [color, off] of [[shadow, 2], [ink, 0]] as const) {
    [...padded].forEach((ch, i) => {
      const g = (ch.charCodeAt(0) - 32) * 8;
      for (let gy = 0; gy < 8; gy++)
        for (let gx = 0; gx < 8; gx++)
          if (FONT8X8[g + gy] & (0x80 >> gx)) c.rect(i * 16 + gx * 2 + off, 2 + gy * 2 + off, 2, 2, color);
    });
  }
  return slices(id, c.rows());
}

/** A tile sheet of up to 16 8×8 cells, laid out 4 per row. */
export function tileSheet(id: string, cells: string[][]): Sprite {
  const rows: string[] = [];
  const blank = Array(8).fill("00000000");
  const bands = Math.ceil(cells.length / 4);
  for (let band = 0; band < bands; band++)
    for (let y = 0; y < 8; y++)
      rows.push([0, 1, 2, 3].map((i) => (cells[band * 4 + i] ?? blank)[y]).join(""));
  return art(id, rows, { w: 1, h: 1 });
}
