#!/usr/bin/env node
/* Headless ROM runner for behaviour tests (uxn-dsl's uxn5 harness).
   Usage: node headless.cjs <uxn-dsl root> <rom> '<steps json>' [png dir]
   Steps: ["frames", n] | ["click", x, y] | ["press", x, y] |
   ["release", x, y] | ["mouse", x, y] | ["key", code] |
   ["tap", mask] | ["hold", mask] | ["unhold", mask] | ["snap", name]
   Prints JSON {snaps: {name: ["0123…" rows of palette indices]}}
   and, with a png dir, writes <name>.png (4x) for eyeballing. */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const [root, rom, stepsJson, pngDir] = process.argv.slice(2);
const out = fs.mkdtempSync(path.join(require("os").tmpdir(), "headless-"));
const H = require(path.join(root, "tests/pixels/harness.cjs"))(root, out);
const realLog = console.log;
console.log = () => {};
const emu = H.boot(rom);
const steps = JSON.parse(stepsJson);
const snaps = {};

function png(grid, palette, file) {
  const h = grid.length, w = grid[0].length, S = 4;
  const raw = [];
  for (let y = 0; y < h * S; y++) {
    raw.push(0);
    for (let x = 0; x < w * S; x++) raw.push(...palette[grid[Math.floor(y / S)][Math.floor(x / S)]]);
  }
  const chunk = (t, d) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(d.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(Buffer.concat([Buffer.from(t), d])) >>> 0 : crc32(Buffer.concat([Buffer.from(t), d])));
    return Buffer.concat([len, Buffer.from(t), d, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w * S, 0);
  ihdr.writeUInt32BE(h * S, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.from(raw))), chunk("IEND", Buffer.alloc(0))]));
}
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const mouse = (state) => {
  emu.uxn.dev[0x96] = state;
  emu.uxn.eval(emu.mvec);
};
for (const [op, a, b] of steps) {
  if (op === "frames") for (let i = 0; i < a; i++) emu.frame();
  else if (op === "mouse") emu.setMouse(a, b);
  else if (op === "click") emu.click(a, b);
  else if (op === "press") {
    emu.setMouse(a, b);
    mouse(1);
    emu.frame();
  } else if (op === "release") {
    emu.setMouse(a, b);
    mouse(0);
    emu.frame();
  } else if (op === "key") emu.tapKey(a);
  else if (op === "tap") emu.tapButton(a);
  else if (op === "hold") {
    emu.uxn.dev[0x82] |= a;
    emu.uxn.eval(emu.cvec);
  } else if (op === "unhold") {
    emu.uxn.dev[0x82] &= ~a;
    emu.uxn.eval(emu.cvec);
  } else if (op === "snap") {
    const grid = emu.grid();
    snaps[a] = grid.map((r) => r.join(""));
    if (pngDir) png(grid, emu.screen.palette, path.join(pngDir, `${a}.png`));
  }
}
console.log = realLog;
process.stdout.write(JSON.stringify({ snaps, stacks: emu.stacks() }));
