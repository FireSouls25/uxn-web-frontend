/* Uxn 4-color palette, computed exactly like the emulator
   (`uxn2/src/uxn2.c:198-209 system_deo_colorize`): each System r/g/b
   port holds four 4-bit nibbles; color i takes nibble (i==0||i==2 ? 4:0)
   of byte (i<2 ? low : high); 4-bit channels expand by duplication
   (0xB → 0xBB). Sprite pixels are 2-bit indices into these four.
   With blit mode 129 (2bpp, blend 1) the mapping is identity, so
   index 0 paints palette 0 — opaque background, not transparency. */

// Demo theme, same constants the emitter writes (System.r/g/b).
export const THEME_R = 45163; // 0xB06B
export const THEME_G = 32876; // 0x806C
export const THEME_B = 16508; // 0x407C

function nibble(word: number, i: number): number {
  const low = word & 0xff;
  const high = (word >> 8) & 0xff;
  const byte = i < 2 ? low : high;
  const shift = i === 0 || i === 2 ? 4 : 0;
  return (byte >> shift) & 0xf;
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
