import { describe, expect, it } from "vitest";
import { monoToPixels, paletteColor, pixelsToPlanar } from "./palette";

describe("paletteColor", () => {
  it("matches the documented demo theme (grey-blue, pale, brown, black)", () => {
    // Derived from uxn2/src/uxn2.c system_deo_colorize with
    // r=0xB06B g=0x806C b=0x407C.
    expect(paletteColor(0)).toBe("#666677");
    expect(paletteColor(1)).toBe("#bbcccc");
    expect(paletteColor(2)).toBe("#bb8844");
    expect(paletteColor(3)).toBe("#000000");
  });
});

describe("pixelsToPlanar", () => {
  it("packs two bitplanes, ch1 first", () => {
    const pixels = Array(64).fill(0);
    pixels[0] = 3; // row 0, col 0 → both planes bit 7
    pixels[9] = 1; // row 1, col 1 → ch1 bit 6
    pixels[9 + 0] = pixels[9]; // keep simple
    const planar = pixelsToPlanar(pixels);
    expect(planar).toHaveLength(16);
    expect(planar[0]).toBe(0x80);
    expect(planar[8]).toBe(0x80);
    expect(planar[1]).toBe(0x40);
    expect(planar[9]).toBe(0x00);
  });
});

describe("monoToPixels", () => {
  it("expands 1bpp rows to 0/1 indices", () => {
    expect(monoToPixels([0xff, ...Array(7).fill(0)]).slice(0, 8)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect(monoToPixels(Array(8).fill(0))).toEqual(Array(64).fill(0));
  });
});
