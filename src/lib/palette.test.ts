import { describe, expect, it } from "vitest";
import { monoToPixels, paletteColor, pixelsToPlanar } from "./palette";

describe("paletteColor", () => {
  it("matches the documented demo theme (grey-blue, pale, brown, black)", () => {
    // uxn2.c system_deo_colorize / uxn5 update_palette: color 0 is
    // the top nibble of each System short (r=0x6BB0 g=0x6C80 b=0x7C40).
    expect(paletteColor(0)).toBe("#666677");
    expect(paletteColor(1)).toBe("#bbcccc");
    expect(paletteColor(2)).toBe("#bb8844");
    expect(paletteColor(3)).toBe("#000000");
  });
});

describe("palette decode matches the VM", () => {
  it("reads color 0 from the top nibble (the chess theme the VM paints brown first)", () => {
    // The local chess ROM runs theme(0xB06B, 0x806C, 0x407C); a real
    // frame of its menu clears to #bb8844 (color 0) in uxn5.
    expect(paletteColor(0, 0xb06b, 0x806c, 0x407c)).toBe("#bb8844");
    expect(paletteColor(1, 0xb06b, 0x806c, 0x407c)).toBe("#000000");
    expect(paletteColor(2, 0xb06b, 0x806c, 0x407c)).toBe("#666677");
    expect(paletteColor(3, 0xb06b, 0x806c, 0x407c)).toBe("#bbcccc");
  });

  it("setPaletteIndex writes the nibble paletteColor reads", async () => {
    const { setPaletteIndex } = await import("./palette");
    let th = { r: 0, g: 0, b: 0 };
    th = setPaletteIndex(th, 0, "#123456");
    th = setPaletteIndex(th, 3, "#abcdef");
    expect(paletteColor(0, th.r, th.g, th.b)).toBe("#113355");
    expect(paletteColor(3, th.r, th.g, th.b)).toBe("#aaccee");
    expect(paletteColor(1, th.r, th.g, th.b)).toBe("#000000");
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
