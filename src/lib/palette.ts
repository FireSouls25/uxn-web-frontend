/* Uxn 4-color palette, decoded exactly like both emulators: each
   System r/g/b short holds four 4-bit channels, color 0 in the top
   nibble (uxn2.c system_deo_colorize reads dev[0x8] — the HIGH byte,
   ports are big-endian — high nibble first; uxn5 screen.js shifts
   12, 8, 4, 0). 4-bit channels expand by duplication (0xB → 0xBB).
   Sprite pixels are 2-bit indices into these four. With blit mode
   129 (2bpp, blend 1) the mapping is identity, so index 0 paints
   palette 0 — opaque background, not transparency.
   (This used to read the low byte first, which rotated every editor
   color against the real game: c0 showed what the VM paints as c2.) */

// Demo theme, same constants the emitter writes (System.r/g/b):
// grey-blue #667, pale #BCC, brown #B84, black #000 — the colors the
// editor always showed for theme-less projects. (Before the decode
// fix these were 0xB06B/0x806C/0x407C, which the VM actually painted
// brown/black/grey/pale; re-encoded so game and editor agree on the
// look people designed against.)
export const THEME_R = 0x6bb0;
export const THEME_G = 0x6c80;
export const THEME_B = 0x7c40;

function nibble(word: number, i: number): number {
  return (word >> (12 - 4 * i)) & 0xf;
}

/** Palette index 0–3 → "#rrggbb". */
export function paletteColor(i: number, r = THEME_R, g = THEME_G, b = THEME_B): string {
  const ch = (word: number) => {
    const n = nibble(word, i);
    const v = (n << 4) | n;
    return v.toString(16).padStart(2, "0");
  };
  return `#${ch(r)}${ch(g)}${ch(b)}`;
}

export const PALETTE: [string, string, string, string] = [
  paletteColor(0),
  paletteColor(1),
  paletteColor(2),
  paletteColor(3),
];

export interface Theme {
  r: number;
  g: number;
  b: number;
}

/** Live palette for a project theme (defaults to demo theme). */
export function themeColors(theme?: Theme): [string, string, string, string] {
  const t = theme ?? { r: THEME_R, g: THEME_G, b: THEME_B };
  return [paletteColor(0, t.r, t.g, t.b), paletteColor(1, t.r, t.g, t.b), paletteColor(2, t.r, t.g, t.b), paletteColor(3, t.r, t.g, t.b)];
}

/** Set palette index 0–3 to an RGB hex (quantized to 4-bit nibbles). */
export function setPaletteIndex(theme: Theme | undefined, index: number, hex: string): Theme {
  const t = { r: THEME_R, g: THEME_G, b: THEME_B, ...(theme ?? {}) };
  const m = hex.match(/^#([0-9a-fA-F]{6})$/);
  if (!m) return t;
  const rgb = parseInt(m[1], 16);
  const nibbles = [(rgb >> 20) & 0xf, (rgb >> 12) & 0xf, (rgb >> 4) & 0xf];
  const shift = 12 - 4 * index;
  const put = (word: number, n: number) => (word & (~(0xf << shift) & 0xffff)) | ((n & 0xf) << shift);
  return { r: put(t.r, nibbles[0]), g: put(t.g, nibbles[1]), b: put(t.b, nibbles[2]) };
}

/** 64 color indices (0–3) → 16 planar bytes (ch1 ×8, ch2 ×8). */
export function pixelsToPlanar(pixels: number[]): number[] {
  const ch1: number[] = [];
  const ch2: number[] = [];
  for (let r = 0; r < 8; r++) {
    let b1 = 0;
    let b2 = 0;
    for (let c = 0; c < 8; c++) {
      const v = pixels[r * 8 + c] & 3;
      if (v & 1) b1 |= 1 << (7 - c);
      if (v & 2) b2 |= 1 << (7 - c);
    }
    ch1.push(b1);
    ch2.push(b2);
  }
  return [...ch1, ...ch2];
}

/** Legacy 8-byte 1bpp rows → 64 color indices (0/1). */
export function monoToPixels(rows: number[]): number[] {
  const out: number[] = [];
  for (let r = 0; r < 8; r++) {
    const byte = rows[r] ?? 0;
    for (let c = 0; c < 8; c++) out.push(byte & (1 << (7 - c)) ? 1 : 0);
  }
  return out;
}
