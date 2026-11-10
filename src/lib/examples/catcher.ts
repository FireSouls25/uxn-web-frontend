/* Star Catcher: a one-screen arcade game built from events only. It
   shows spawning on a timer (scene alarm + spawn pool), random values,
   per-instance template variables (each star falls at its own speed),
   held-button conditions, game variables for score and lives, and
   messages that tell the HUD to redraw. Locked: Duplicate to edit. */
import type { Block, Cond, ObjectEvent, Project, SceneNode, Sprite, Value } from "../project";

function art(id: string, rows: string[]): Sprite {
  const w = rows[0].length / 8;
  const h = rows.length / 8;
  const pixels: number[] = [];
  for (let ty = 0; ty < h; ty++)
    for (let tx = 0; tx < w; tx++)
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) pixels.push(Number(rows[ty * 8 + y][tx * 8 + x]));
  return { id, w, h, pixels };
}

const BASKET = [
  "1000000000000001",
  "1300000000000031",
  "1333333333333331",
  "1323232323232321",
  "1332323232323231",
  "0132323232323210",
  "0013333333333100",
  "0001111111111000",
];
const STAR = ["00022000", "00022000", "22222222", "02222220", "00222200", "02200220", "22000022", "00000000"];
const BOMB = ["00000110", "00001000", "00111100", "01133310", "01333310", "01333310", "00111100", "00000000"];
const MOON = [
  "0000111100000000",
  "0011110000000000",
  "0111100000000000",
  "1111000000000000",
  "1111000000000000",
  "1111100000000000",
  "0111111000000110",
  "0001111111111100",
];

const v = (name: string): Value => ({ k: "var", name });
const ev = (id: string, trigger: ObjectEvent["trigger"], blocks: Block[], extra: Partial<ObjectEvent> = {}): ObjectEvent => ({ id, trigger, blocks, ...extra });
const play = (sound: string): Block => ({ op: "play", sound });
const sound = (id: string, note: number, vol = 190) => ({ id, voices: [{ note, vol }, { note: 0, vol: 0 }, { note: 0, vol: 0 }, { note: 0, vol: 0 }] });
const text = (id: string, x: number, y: number, label: string): SceneNode => ({ id, x, y, label });
const lt = (a: Value, b: Value): Cond => ({ k: "cmp", a, op: "lt", b });
const gt = (a: Value, b: Value): Cond => ({ k: "cmp", a, op: "gt", b });

export function catcherProject(): Project {
  const hud: Block[] = [{ op: "send", message: "hud" }];
  const loseLife: Block[] = [
    { op: "set", name: "lives", mode: "sub", value: 1 },
    ...hud,
    { op: "if", cond: { k: "cmp", a: v("lives"), op: "eq", b: 0 }, then: [{ op: "goto", scene: "over" }] },
  ];
  return {
    id: "catcher",
    kind: "visual",
    locked: true,
    name: "Star Catcher",
    author: "uxn-forge",
    width: 160,
    height: 144,
    // c0 night blue, c1 pale, c2 star yellow, c3 pink.
    theme: { r: 0x1ffe, g: 0x2fd6, b: 0x5fa9 },
    start: "title",
    updatedAt: Date.now(),
    inputs: [{ id: "space", key: 32 }],
    sprites: [art("basket", BASKET), art("star", STAR), art("bomb", BOMB), art("moon", MOON)],
    anims: [],
    vars: [
      { id: "score", init: 0 },
      { id: "lives", init: 3 },
    ],
    sounds: [sound("ding", 84), sound("boom", 36, 230), sound("miss", 50), sound("start", 72)],
    objectDefs: [
      {
        id: "basket",
        sprite: "basket",
        kind: "player",
        blend: 5,
        events: [
          ev("steer", "step", [
            { op: "if", cond: { k: "all", of: [{ k: "held", button: "left" }, gt({ k: "prop", prop: "x" }, 2)] }, then: [{ op: "move", dx: -3, dy: 0 }] },
            { op: "if", cond: { k: "all", of: [{ k: "held", button: "right" }, lt({ k: "prop", prop: "x" }, 142)] }, then: [{ op: "move", dx: 3, dy: 0 }] },
          ]),
          ev("catch", "collide", [{ op: "destroy", target: "other" }, { op: "set", name: "score", mode: "add", value: 1 }, play("ding"), ...hud], { target: "def:star" }),
          ev("boom", "collide", [{ op: "destroy", target: "other" }, play("boom"), ...loseLife], { target: "def:bomb" }),
        ],
      },
      {
        id: "star",
        sprite: "star",
        kind: "static",
        blend: 5,
        // Each star picks its own speed when it appears.
        vars: [{ id: "speed", init: 1 }],
        events: [
          ev("pick", "create", [{ op: "set", name: "speed", scope: "self", mode: "set", value: { k: "math", op: "+", a: { k: "random", max: 2 }, b: 1 } }]),
          ev("fall", "step", [
            { op: "move", dx: 0, dy: { k: "my", name: "speed" } },
            { op: "if", cond: gt({ k: "prop", prop: "y" }, 140), then: [play("miss"), { op: "destroy" }, ...loseLife] },
          ]),
        ],
      },
      {
        id: "bomb",
        sprite: "bomb",
        kind: "static",
        blend: 5,
        events: [ev("fall", "step", [{ op: "move", dx: 0, dy: 2 }, { op: "if", cond: gt({ k: "prop", prop: "y" }, 140), then: [{ op: "destroy" }] }])],
      },
    ],
    scenes: [
      {
        id: "title",
        nodes: [
          { id: "moon", sprite: "moon", x: 120, y: 12, blend: 5 },
          text("name", 24, 40, "STAR CATCHER"),
          text("how1", 16, 72, "CATCH THE STARS"),
          text("how2", 16, 84, "DODGE THE BOMBS"),
          text("go", 24, 116, "SPACE: START"),
        ],
        events: [ev("start", "key", [play("start"), { op: "goto", scene: "play" }], { key: "space" })],
      },
      {
        id: "play",
        pool: 16,
        nodes: [
          { id: "moon", sprite: "moon", x: 120, y: 12, blend: 5 },
          { id: "player", def: "basket", x: 72, y: 128 },
          { id: "score", x: 4, y: 4, label: "SCORE 0", events: [ev("show", "create", [{ op: "text", text: "SCORE ", value: v("score") }]), ev("hud", "message", [{ op: "text", text: "SCORE ", value: v("score") }], { message: "hud" })] },
          { id: "lives", x: 4, y: 14, label: "LIVES 3", events: [ev("show", "create", [{ op: "text", text: "LIVES ", value: v("lives") }]), ev("hud", "message", [{ op: "text", text: "LIVES ", value: v("lives") }], { message: "hud" })] },
        ],
        events: [
          ev("reset", "create", [{ op: "set", name: "score", mode: "set", value: 0 }, { op: "set", name: "lives", mode: "set", value: 3 }, { op: "wait", ticks: 30 }]),
          // Every half second: one in five drops is a bomb.
          ev("drop", "alarm", [
            {
              op: "if",
              cond: { k: "cmp", a: { k: "random", max: 5 }, op: "eq", b: 0 },
              then: [{ op: "spawn", def: "bomb", x: { k: "math", op: "+", a: { k: "random", max: 144 }, b: 4 }, y: 24 }],
              else: [{ op: "spawn", def: "star", x: { k: "math", op: "+", a: { k: "random", max: 144 }, b: 4 }, y: 24 }],
            },
            { op: "wait", ticks: 30 },
          ]),
        ],
      },
      {
        id: "over",
        nodes: [
          text("over", 40, 40, "GAME OVER"),
          { id: "final", x: 40, y: 64, label: "SCORE 0", events: [ev("show", "create", [{ op: "text", text: "SCORE ", value: v("score") }])] },
          text("retry", 24, 100, "SPACE: AGAIN"),
        ],
        events: [ev("again", "key", [play("start"), { op: "goto", scene: "play" }], { key: "space" })],
      },
    ],
  };
}
