/* Engine loop, v2: objects, events, actions → ETAL.

   The runtime is data-driven so it scales with templates, not
   instances: every object template (an ObjectDef, or an inline scene
   object, which is its own anonymous template) gets its handlers
   emitted ONCE as parameterless fns over the `self` slot register,
   and scenes fill their slots from a byte table. ETAL facts that
   shaped it (uxn-dsl docs/language/limitations.md):
   - every fn local/param is a permanent zero-page byte (256 total), so
     handlers take no params and scratch lives in globals/buffers;
   - no recursion: message sends are checked for cycles;
   - no implicit narrowing and no u16→pointer: values are u16, text is
     indexed data (string ids), never addresses read through pointers;
   - unused data/globals warn, and warning-free assembly is a tested
     property, so every buffer is emitted only with a feature using it.

   Slot flags: bit0 alive, bit1 solid, bit2 movable, bit3 visible,
   bit4 player, bit5 keyboard-driven, bit6 custom hitbox. */

import { glyphRows } from "./font";
import { THEME_B, THEME_G, THEME_R } from "./palette";
import {
  BUTTONS,
  DEVICES_ENGINE,
  MAX_OBJECTS,
  MAX_SONG_STEPS,
  SONG_REST,
  SQ32,
  audioBlock,
  cellTileOffset,
  cellCount,
  cellTiles,
  flattenScene,
  lookMode,
  projectDefs,
  spriteTiles,
  spriteToPlanar,
  type Block,
  type Cond,
  type EventTrigger,
  type FlatLeaf,
  type GameVar,
  type HookName,
  type HitBox,
  type ObjectDef,
  type ObjectEvent,
  type ObjectKind,
  type Project,
  type Scene,
  type SongDef,
  type Value,
  type ValueExpr,
  worldSize,
} from "./project";

/* ------------------------------------------------------------------
   Templates: who owns behaviour.
   ------------------------------------------------------------------ */

export interface Template {
  /** 1-based runtime index (odef). */
  k: number;
  /** def id, or `<scene>:<node>` for an inline object. */
  key: string;
  /** Display name for messages and the editor. */
  name: string;
  def?: ObjectDef;
  sprite: string;
  kind: ObjectKind;
  solid: boolean;
  controls: boolean;
  anim?: string;
  mask?: HitBox;
  cell: number;
  mode: number;
  label?: string;
  vars: GameVar[];
  events: ObjectEvent[];
  movement?: "platformer" | "walker";
  speed: number;
  jump: number;
  hud: boolean;
}

/** Every template in deterministic order: defs (sorted), then inline
    objects in scene/node order. */
export function templatesOf(p: Project): Template[] {
  const out: Template[] = [];
  for (const d of [...projectDefs(p)].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    out.push({
      k: 0,
      key: d.id,
      name: d.id,
      def: d,
      sprite: d.sprite ?? "",
      kind: d.kind,
      solid: !!d.solid || d.kind === "movable",
      controls: !!d.controls,
      anim: d.anim,
      mask: d.mask,
      cell: d.cell ?? 0,
      mode: defaultMode(d.sprite ?? "", d),
      label: d.label,
      vars: d.vars ?? [],
      events: d.events ?? [],
      movement: d.movement,
      speed: d.speed ?? (d.movement === "walker" ? 1 : 2),
      jump: d.jump ?? 5,
      hud: !!d.hud,
    });
  }
  for (const s of p.scenes) {
    for (const n of s.nodes) {
      if (n.scene || n.def) continue;
      out.push({
        k: 0,
        key: `${s.id}:${n.id}`,
        name: `${s.id}/${n.id}`,
        sprite: n.sprite ?? "",
        kind: n.kind ?? "static",
        solid: !!n.solid || n.kind === "movable",
        controls: !!n.controls,
        anim: n.anim,
        mask: n.mask,
        cell: n.cell ?? 0,
        mode: defaultMode(n.sprite ?? "", n),
        label: n.label,
        vars: [],
        events: n.events ?? [],
        speed: 1,
        jump: 5,
        hud: !!n.hud,
      });
    }
  }
  out.forEach((t, i) => (t.k = i + 1));
  return out;
}

/** Draw byte for an object: text-only objects default to blend 5
    (ink color 1, transparent paper); sprites to blend 1 (opaque). */
function defaultMode(sprite: string, look: { flipX?: boolean; flipY?: boolean; blend?: number }): number {
  return lookMode({ ...look, blend: look.blend ?? (sprite ? 1 : 5) });
}

/** The template a flattened leaf runs. */
export function templateOfLeaf(tpls: Template[], leaf: FlatLeaf): Template | undefined {
  return leaf.def ? tpls.find((t) => t.def?.id === leaf.def) : tpls.find((t) => t.key === `${leaf.home}:${leaf.id}`);
}

/* ------------------------------------------------------------------
   Walking behaviour.
   ------------------------------------------------------------------ */

/** Every block, depth first (if/else and repeat bodies included). */
export function eachBlock(events: ObjectEvent[] | Block[]): Block[] {
  const out: Block[] = [];
  const walk = (blocks: Block[]): void => {
    for (const b of blocks ?? []) {
      out.push(b);
      if (b.op === "if") {
        walk(b.then ?? []);
        if (b.else) walk(b.else);
      } else if (b.op === "repeat") walk(b.body ?? []);
    }
  };
  const list = events as Array<ObjectEvent | Block>;
  for (const e of list ?? []) {
    if (e && "trigger" in e) walk((e as ObjectEvent).blocks ?? []);
    else walk([e as Block]);
  }
  return out;
}

/** Every value inside a block (fields, conditions, nested values). */
export function blockValues(b: Block): Value[] {
  const out: Value[] = [];
  const v = (x: Value | undefined): void => {
    if (x === undefined) return;
    out.push(x);
    if (typeof x === "object") {
      if (x.k === "random") v(x.max);
      else if (x.k === "math") {
        v(x.a);
        v(x.b);
      } else if (x.k === "call") x.args.forEach(v);
    }
  };
  const c = (x: Cond | undefined): void => {
    if (!x) return;
    if (x.k === "cmp") {
      v(x.a);
      v(x.b);
    } else if (x.k === "all" || x.k === "any") x.of.forEach(c);
    else if (x.k === "not") c(x.c);
  };
  switch (b.op) {
    case "move":
      v(b.dx);
      v(b.dy);
      break;
    case "set_pos":
    case "glide":
    case "spawn":
      v(b.x);
      v(b.y);
      break;
    case "sprite":
      v(b.cell);
      break;
    case "cell":
      v(b.cell);
      break;
    case "text":
      v(b.value);
      break;
    case "wait":
      v(b.ticks);
      break;
    case "set":
      v(b.value);
      break;
    case "if":
      c(b.cond);
      break;
    case "repeat":
      v(b.times);
      break;
    case "call":
      b.args.forEach(v);
      break;
    case "jump":
      v(b.power);
      break;
  }
  return out;
}

export function blockConds(b: Block): Cond[] {
  if (b.op !== "if" || !b.cond) return [];
  const out: Cond[] = [];
  const c = (x: Cond): void => {
    out.push(x);
    if (x.k === "all" || x.k === "any") x.of.forEach(c);
    else if (x.k === "not") c(x.c);
  };
  c(b.cond);
  return out;
}

/** All behaviour in the project: templates' events and scenes'. */
export function allEvents(p: Project): ObjectEvent[] {
  return [...templatesOf(p).flatMap((t) => t.events), ...p.scenes.flatMap((s) => s.events ?? [])];
}

/** Songs some song action starts, sorted. */
export function referencedSongs(p: Project): SongDef[] {
  const ids = new Set<string>();
  for (const b of eachBlock(allEvents(p))) if (b.op === "song") ids.add(b.song);
  return [...ids]
    .map((id) => (p.songs ?? []).find((x) => x.id === id))
    .filter((x): x is SongDef => !!x)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

export function songVoices(p: Project): number[] {
  const out = new Set<number>();
  for (const s of referencedSongs(p)) {
    s.tracks.forEach((tr, vi) => {
      if (tr.notes.length > 0 && tr.vol > 0) out.add(vi);
    });
  }
  return [...out].sort((a, b) => a - b);
}

/** Audio voices the build touches: boot jingle, sounds played, songs. */
export function usedVoices(p: Project): number[] {
  const out = new Set<number>();
  (p.sound?.voices ?? []).forEach((v, i) => {
    if (i < 4 && v.vol > 0) out.add(i);
  });
  const snds = new Map((p.sounds ?? []).map((s) => [s.id, s]));
  for (const b of eachBlock(allEvents(p))) {
    if (b.op !== "play") continue;
    snds.get(b.sound)?.voices.forEach((v, i) => {
      if (i < 4 && v.vol > 0) out.add(i);
    });
  }
  for (const v of songVoices(p)) out.add(v);
  return [...out].sort((a, b) => a - b);
}

/** Script functions blocks can call: top-level `name :: fn(...)` in
    custom.ux and every script, with parameter types and result. */
export interface ScriptFn {
  name: string;
  params: Array<{ name: string; type: string }>;
  ret?: string;
  file: string;
}

export function scriptFunctions(p: Project): ScriptFn[] {
  const out: ScriptFn[] = [];
  const sources = [{ file: "custom.ux", code: p.customCode ?? "" }, ...(p.scripts ?? []).map((s) => ({ file: s.path, code: s.code }))];
  for (const { file, code } of sources) {
    for (const m of code.matchAll(/^([A-Za-z_]\w*)\s*::\s*fn\s*\(([^)]*)\)\s*(?:->\s*([A-Za-z0-9_&]+))?/gm)) {
      const params = m[2]
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => {
          const [name, type] = x.split(":").map((y) => y.trim());
          return { name, type: type ?? "u16" };
        });
      out.push({ name: m[1], params, ret: m[3], file });
    }
  }
  return out;
}

/* ------------------------------------------------------------------
   Validation of behaviour.
   ------------------------------------------------------------------ */

const IDENT = /^[A-Za-z][A-Za-z0-9_]*$/;
const MAX_NEST = 6;
const TRIGGERS: EventTrigger[] = ["create", "step", "destroy", "key", "click", "release", "collide", "alarm", "message"];
const SCENE_TRIGGERS: EventTrigger[] = ["create", "step", "key", "click", "release", "alarm", "message"];
/** Actions that act on "this object" — meaningless in scene events. */
const OBJECT_ONLY = new Set(["move", "set_pos", "glide", "sprite", "cell", "look", "show", "hide", "text", "jump"]);

export function validTarget(t: string, defIds: Set<string>): boolean {
  return t === "any" || t === "solid" || t === "player" || t === "movable" || (t.startsWith("def:") && defIds.has(t.slice(4)));
}

export function validateBehaviour(p: Project): string[] {
  const errs: string[] = [];
  const tpls = templatesOf(p);
  const defIds = new Set(projectDefs(p).map((d) => d.id));
  const sceneIds = new Set(p.scenes.map((s) => s.id));
  const inputIds = new Set((p.inputs ?? []).map((i) => i.id));
  const soundIds = new Set((p.sounds ?? []).map((s) => s.id));
  const songIds = new Set((p.songs ?? []).map((s) => s.id));
  const spriteIds = new Set(p.sprites.map((s) => s.id));
  const varIds = new Set((p.vars ?? []).map((v) => v.id));
  const allMy = new Set(tpls.flatMap((t) => t.vars.map((v) => v.id)));
  const fns = new Map(scriptFunctions(p).map((f) => [f.name, f]));

  for (const t of tpls) {
    const ids = new Set<string>();
    for (const v of t.vars) {
      if (!IDENT.test(v.id)) errs.push(`object '${t.name}': bad variable name '${v.id}'`);
      if (ids.has(v.id)) errs.push(`object '${t.name}': duplicate variable '${v.id}'`);
      ids.add(v.id);
      if (!Number.isInteger(v.init) || v.init < 0 || v.init > 65535) errs.push(`object '${t.name}': variable '${v.id}' start must be 0–65535`);
    }
  }

  const checkValue = (v: Value | undefined, at: string, ctx: Ctx, signed = false): void => {
    if (v === undefined) {
      errs.push(`${at}: missing value`);
      return;
    }
    if (typeof v === "number") {
      if (!Number.isInteger(v) || v > 65535 || v < (signed ? -65535 : 0)) errs.push(`${at}: number must be ${signed ? "-65535" : "0"}–65535`);
      return;
    }
    switch (v.k) {
      case "var":
        if (!varIds.has(v.name)) errs.push(`${at}: unknown variable '${v.name}'`);
        break;
      case "my": {
        if ((v.of ?? "self") === "other" && !ctx.other) errs.push(`${at}: 'other' only exists in collision events`);
        if (ctx.scene && (v.of ?? "self") === "self") errs.push(`${at}: scene events have no 'my' variables`);
        const own = ctx.tpl?.vars.some((x) => x.id === v.name);
        if ((v.of ?? "self") === "self" ? !own && !ctx.scene : !allMy.has(v.name)) errs.push(`${at}: no object variable '${v.name}'`);
        break;
      }
      case "prop":
        if (!["x", "y", "cell", "w", "h"].includes(v.prop)) errs.push(`${at}: bad property '${v.prop}'`);
        if ((v.of ?? "self") === "other" && !ctx.other) errs.push(`${at}: 'other' only exists in collision events`);
        if (ctx.scene && (v.of ?? "self") === "self") errs.push(`${at}: scene events have no own position`);
        break;
      case "mouse":
        if (v.axis !== "x" && v.axis !== "y") errs.push(`${at}: mouse axis must be x or y`);
        break;
      case "random":
        checkValue(v.max, `${at} random`, ctx);
        break;
      case "math":
        if (!["+", "-", "*", "/", "%"].includes(v.op)) errs.push(`${at}: bad operator '${v.op}'`);
        checkValue(v.a, at, ctx);
        checkValue(v.b, at, ctx);
        break;
      case "call": {
        const f = fns.get(v.fn);
        if (!f) errs.push(`${at}: no script function '${v.fn}'`);
        else {
          if (!f.ret) errs.push(`${at}: '${v.fn}' returns nothing — add '-> u16'`);
          checkCall(f, v.args, at, ctx);
        }
        break;
      }
      default:
        errs.push(`${at}: bad value`);
    }
  };
  const checkCall = (f: ScriptFn, args: Value[], at: string, ctx: Ctx): void => {
    if (args.length !== f.params.length) errs.push(`${at}: '${f.name}' takes ${f.params.length} argument(s), got ${args.length}`);
    f.params.forEach((pp, i) => {
      if (pp.type !== "u16") errs.push(`${at}: '${f.name}' parameter '${pp.name}' is ${pp.type} — blocks pass u16 numbers, declare it u16`);
      checkValue(args[i], `${at} arg ${i + 1}`, ctx);
    });
  };
  const checkCond = (c: Cond | undefined, at: string, ctx: Ctx): void => {
    if (!c) {
      errs.push(`${at}: missing condition`);
      return;
    }
    switch (c.k) {
      case "cmp":
        if (!["eq", "neq", "lt", "lte", "gt", "gte"].includes(c.op)) errs.push(`${at}: bad comparison '${c.op}'`);
        checkValue(c.a, at, ctx);
        checkValue(c.b, at, ctx);
        break;
      case "held":
        if (!(c.button in BUTTONS)) errs.push(`${at}: bad button '${c.button}'`);
        break;
      case "touching":
        if (ctx.scene) errs.push(`${at}: scenes can't touch things`);
        if (!validTarget(c.target, defIds)) errs.push(`${at}: bad touch target '${c.target}'`);
        break;
      case "mouse_over":
        if (ctx.scene) errs.push(`${at}: 'mouse over' needs an object`);
        break;
      case "mouse_down":
        break;
      case "all":
      case "any":
        if (!Array.isArray(c.of) || c.of.length === 0) errs.push(`${at}: empty condition group`);
        else c.of.forEach((x) => checkCond(x, at, ctx));
        break;
      case "not":
        checkCond(c.c, at, ctx);
        break;
      default:
        errs.push(`${at}: bad condition`);
    }
  };
  const checkBlocks = (blocks: Block[], at: string, ctx: Ctx, depth: number): void => {
    if (!Array.isArray(blocks)) {
      errs.push(`${at}: actions must be a list`);
      return;
    }
    if (depth > MAX_NEST) errs.push(`${at}: nested deeper than ${MAX_NEST}`);
    blocks.forEach((b, i) => {
      const a = `${at} #${i + 1} ${b?.op ?? "?"}`;
      if (!b || typeof b !== "object") {
        errs.push(`${a}: bad action`);
        return;
      }
      if (ctx.scene && OBJECT_ONLY.has(b.op)) errs.push(`${a}: scene events can't ${b.op} — put this on an object`);
      switch (b.op) {
        case "move":
          checkValue(b.dx, a, ctx, true);
          checkValue(b.dy, a, ctx, true);
          break;
        case "set_pos":
          checkValue(b.x, a, ctx);
          checkValue(b.y, a, ctx);
          break;
        case "glide":
          checkValue(b.x, a, ctx);
          checkValue(b.y, a, ctx);
          if (!Number.isInteger(b.frames) || b.frames < 1 || b.frames > 255) errs.push(`${a}: frames must be 1–255`);
          break;
        case "sprite":
          if (!spriteIds.has(b.sprite)) errs.push(`${a}: unknown sprite '${b.sprite}'`);
          if (b.cell !== undefined) checkValue(b.cell, a, ctx);
          break;
        case "cell":
          checkValue(b.cell, a, ctx);
          break;
        case "look":
          if (b.blend !== undefined && (!Number.isInteger(b.blend) || b.blend < 0 || b.blend > 15)) errs.push(`${a}: colors must be 0–15`);
          break;
        case "show":
        case "hide":
        case "back":
        case "song_stop":
          break;
        case "text":
          if (typeof b.text !== "string" || b.text.length > 24 || /[^\x20-\x7e]/.test(b.text)) errs.push(`${a}: text must be 0–24 printable ASCII chars`);
          if (b.value !== undefined) checkValue(b.value, a, ctx);
          break;
        case "play":
          if (!soundIds.has(b.sound)) errs.push(`${a}: unknown sound '${b.sound}'`);
          break;
        case "song":
          if (!songIds.has(b.song)) errs.push(`${a}: unknown song '${b.song}'`);
          break;
        case "goto":
        case "overlay":
          if (!sceneIds.has(b.scene)) errs.push(`${a}: unknown scene '${b.scene}'`);
          break;
        case "wait":
          checkValue(b.ticks, a, ctx);
          if (b.slot !== undefined && (!Number.isInteger(b.slot) || b.slot < 0 || b.slot > 3)) errs.push(`${a}: timer must be 0–3`);
          break;
        case "destroy": {
          const t = b.target ?? "self";
          if (t === "self" && ctx.scene) errs.push(`${a}: a scene can't destroy itself`);
          else if (t === "other" && !ctx.other) errs.push(`${a}: 'other' only exists in collision events`);
          else if (t !== "self" && t !== "other" && !(t.startsWith("def:") && defIds.has(t.slice(4)))) errs.push(`${a}: bad destroy target '${t}'`);
          break;
        }
        case "spawn":
          if (!defIds.has(b.def)) errs.push(`${a}: unknown object template '${b.def}'`);
          checkValue(b.x, a, ctx);
          checkValue(b.y, a, ctx);
          break;
        case "send":
          if (!IDENT.test(b.message ?? "")) errs.push(`${a}: bad message name '${b.message}'`);
          break;
        case "set": {
          const scope = b.scope ?? "global";
          if (scope === "global") {
            if (!varIds.has(b.name)) errs.push(`${a}: unknown variable '${b.name}'`);
          } else checkValue({ k: "my", name: b.name, of: scope }, a, ctx);
          if (!["set", "add", "sub"].includes(b.mode)) errs.push(`${a}: mode must be set|add|sub`);
          checkValue(b.value, a, ctx);
          break;
        }
        case "if":
          checkCond(b.cond, a, ctx);
          checkBlocks(b.then ?? [], `${a} then`, ctx, depth + 1);
          if (b.else) checkBlocks(b.else, `${a} else`, ctx, depth + 1);
          break;
        case "repeat":
          checkValue(b.times, a, ctx);
          if (b.index !== undefined && !varIds.has(b.index)) errs.push(`${a}: counter variable '${b.index}' doesn't exist`);
          checkBlocks(b.body ?? [], `${a} body`, ctx, depth + 1);
          break;
        case "call": {
          const f = fns.get(b.fn);
          if (!f) errs.push(`${a}: no script function '${b.fn}'`);
          else checkCall(f, b.args ?? [], a, ctx);
          break;
        }
        case "jump":
          checkValue(b.power, a, ctx);
          if (ctx.tpl && !ctx.tpl.movement) errs.push(`${a}: jump needs a template with platformer or walker movement`);
          break;
        case "code":
          if (typeof b.code !== "string" || !b.code.trim()) errs.push(`${a}: empty code`);
          else if (b.code.length > 8192) errs.push(`${a}: code exceeds 8KB`);
          break;
        default:
          errs.push(`${a}: unknown action`);
      }
    });
  };
  const checkEvents = (events: ObjectEvent[], at: string, ctx0: Omit<Ctx, "other">): void => {
    const ids = new Set<string>();
    for (const e of events) {
      const ea = `${at} ${e.trigger}`;
      if (ids.has(e.id)) errs.push(`${at}: duplicate event id '${e.id}'`);
      ids.add(e.id);
      if (!(ctx0.scene ? SCENE_TRIGGERS : TRIGGERS).includes(e.trigger)) {
        errs.push(`${at}: '${e.trigger}' isn't a ${ctx0.scene ? "scene" : "object"} event`);
        continue;
      }
      if (e.trigger === "key") {
        if (e.button !== undefined) {
          if (!(e.button in BUTTONS)) errs.push(`${ea}: bad button '${e.button}'`);
        } else if (!e.key || !inputIds.has(e.key)) errs.push(`${ea}: unknown key '${e.key ?? ""}'`);
      }
      if (e.trigger === "collide" && !validTarget(e.target ?? "", defIds)) errs.push(`${ea}: bad target '${e.target ?? ""}'`);
      if (e.trigger === "alarm" && e.alarm !== undefined && (!Number.isInteger(e.alarm) || e.alarm < 0 || e.alarm > 3))
        errs.push(`${ea}: timer must be 0–3`);
      if (e.trigger === "message" && !IDENT.test(e.message ?? "")) errs.push(`${ea}: bad message name '${e.message ?? ""}'`);
      checkBlocks(e.blocks, ea, { ...ctx0, other: e.trigger === "collide" }, 0);
    }
  };
  for (const t of tpls) checkEvents(t.events, `object '${t.name}'`, { tpl: t });
  for (const s of p.scenes) checkEvents(s.events ?? [], `scene '${s.id}'`, { scene: s });

  // Message cycles would recurse (static locals: no reentrancy).
  const sends = new Map<string, Set<string>>();
  for (const e of allEvents(p)) {
    if (e.trigger !== "message" || !e.message) continue;
    const set = sends.get(e.message) ?? new Set<string>();
    for (const b of eachBlock([e])) if (b.op === "send") set.add(b.message);
    sends.set(e.message, set);
  }
  const visiting = new Set<string>();
  const done = new Set<string>();
  const dfs = (m: string, trail: string[]): void => {
    if (done.has(m)) return;
    if (visiting.has(m)) {
      errs.push(`message loop: ${[...trail, m].join(" → ")} — a message can't (indirectly) send itself`);
      return;
    }
    visiting.add(m);
    for (const n of sends.get(m) ?? []) dfs(n, [...trail, m]);
    visiting.delete(m);
    done.add(m);
  };
  for (const m of sends.keys()) dfs(m, []);

  // Movement, tile layers and cameras.
  for (const d of projectDefs(p)) {
    if (d.movement !== undefined && d.movement !== "platformer" && d.movement !== "walker") errs.push(`object '${d.id}': movement must be platformer or walker`);
    if (d.speed !== undefined && (!Number.isInteger(d.speed) || d.speed < 1 || d.speed > 4)) errs.push(`object '${d.id}': speed must be 1–4`);
    if (d.jump !== undefined && (!Number.isInteger(d.jump) || d.jump < 1 || d.jump > 8)) errs.push(`object '${d.id}': jump must be 1–8`);
    if (d.movement && d.controls) errs.push(`object '${d.id}': pick arrow-key driving or ${d.movement} movement, not both`);
  }
  if (p.scenes.filter((s) => s.tilemap).length > 0) {
    let total = 0;
    for (const s of p.scenes) {
      const tm = s.tilemap;
      if (!tm) continue;
      const at = `scene '${s.id}' tiles`;
      const spr = p.sprites.find((x) => x.id === tm.sprite);
      if (!spr) {
        errs.push(`${at}: unknown sprite '${tm.sprite}'`);
        continue;
      }
      const [cw, ch] = cellTiles(spr);
      if (cw !== 1 || ch !== 1) errs.push(`${at}: '${tm.sprite}' must be a sheet of 8×8 cells (set its cells to 1×1 tiles)`);
      if (!Number.isInteger(tm.cols) || !Number.isInteger(tm.rows) || tm.cols < 1 || tm.rows < 1 || tm.cols > 512 || tm.rows > 256) errs.push(`${at}: size must be 1–512 × 1–256 tiles`);
      if (!Array.isArray(tm.tiles) || tm.tiles.length !== tm.cols * tm.rows) errs.push(`${at}: needs ${tm.cols * tm.rows} tiles (cols × rows), has ${tm.tiles?.length ?? 0}`);
      const n = cellCount(spr);
      if ((tm.tiles ?? []).some((v) => !Number.isInteger(v) || v < 0 || v > n)) errs.push(`${at}: tile values must be 0 (empty) to ${n}`);
      if ((tm.solid ?? []).some((v) => !Number.isInteger(v) || v < 0 || v >= n)) errs.push(`${at}: solid cells must be 0–${n - 1}`);
      if (tm.blend !== undefined && (!Number.isInteger(tm.blend) || tm.blend < 0 || tm.blend > 15)) errs.push(`${at}: blend must be 0–15`);
      total += tm.cols * tm.rows;
    }
    if (total > 16384) errs.push(`tile layers hold ${total} tiles in total (max 16384)`);
  }
  for (const s of p.scenes) {
    const f = s.camera?.follow;
    if (f !== undefined && f !== "" && !defIds.has(f)) errs.push(`scene '${s.id}' camera: follows unknown template '${f}'`);
  }
  return errs;
}

interface Ctx {
  tpl?: Template;
  scene?: Scene;
  other?: boolean;
}

/* ------------------------------------------------------------------
   Lowering: values, conditions, actions.
   ------------------------------------------------------------------ */

const CMP: Record<string, string> = { eq: "==", neq: "!=", lt: "<", lte: "<=", gt: ">", gte: ">=" };

/** What lowering needs to know about the project. */
interface LowerEnv {
  p: Project;
  spriteIndex: Map<string, number>;
  tplByDef: Map<string, Template>;
  strId: (s: string) => number;
  sceneIndex: Map<string, number>;
  /** Text width per string id (chars). */
  strLen: Map<number, number>;
}

function who(of: "self" | "other" | undefined): string {
  return (of ?? "self") === "other" ? "other" : "self";
}

export function lowerValue(v: Value, env?: LowerEnv): string {
  if (typeof v === "number") return String(v);
  switch (v.k) {
    case "var":
      return `var_${v.name}[0]`;
    case "my":
      return `iv_${v.name}[${who(v.of)}]`;
    case "prop": {
      const s = who(v.of);
      return v.prop === "x" ? `ox[${s}]` : v.prop === "y" ? `oy[${s}]` : v.prop === "cell" ? `ocell[${s}]` : v.prop === "w" ? `ow[${s}]` : `oh[${s}]`;
    }
    case "mouse":
      return v.axis === "x" ? "Mouse.x" : "Mouse.y";
    case "random":
      return `e_rnd(${lowerValue(v.max, env)})`;
    case "math":
      return `(${lowerValue(v.a, env)} ${v.op} ${lowerValue(v.b, env)})`;
    case "call":
      return `${v.fn}(${v.args.map((a) => lowerValue(a, env)).join(", ")})`;
  }
  return "0";
}

const TARGET_CODE = (t: string, env?: LowerEnv): [number, number] => {
  if (t === "solid") return [1, 0];
  if (t === "player") return [2, 0];
  if (t === "movable") return [3, 0];
  if (t.startsWith("def:")) return [4, env?.tplByDef.get(t.slice(4))?.k ?? 0];
  return [0, 0];
};

export function lowerCond(c: Cond, env?: LowerEnv): string {
  switch (c.k) {
    case "cmp":
      return `(${lowerValue(c.a, env)} ${CMP[c.op] ?? "=="} ${lowerValue(c.b, env)})`;
    case "held":
      return `(Controller.button & ${BUTTONS[c.button]} != 0)`;
    case "touching": {
      const [tk, td] = TARGET_CODE(c.target, env);
      return `(e_touching(${tk}, ${td}) != 0)`;
    }
    case "mouse_over":
      return `(e_hit() != 0)`;
    case "mouse_down":
      return `(Mouse.state & 1 != 0)`;
    case "all":
      return `(${c.of.map((x) => lowerCond(x, env)).join(" && ")})`;
    case "any":
      return `(${c.of.map((x) => lowerCond(x, env)).join(" || ")})`;
    case "not":
      return `(${lowerCond(c.c, env)} == false)`;
  }
  return "(1 == 1)";
}

/** Statements for an action list. `scene` = scene-event context
    (timers go to scene timers). `depth` names repeat counters. */
export function lowerBlocks(blocks: Block[], env: LowerEnv | undefined, scene = false, depth = 0): string[] {
  const out: string[] = [];
  const ind = (ss: string[]): string[] => ss.map((l) => `    ${l}`);
  const V = (v: Value): string => lowerValue(v, env);
  for (const b of blocks) {
    switch (b.op) {
      case "move": {
        for (const [axis, d] of [["ox", b.dx], ["oy", b.dy]] as const) {
          if (typeof d === "number") {
            if (d > 0) out.push(`${axis}[self] = ${axis}[self] + ${d};`);
            else if (d < 0) out.push(`${axis}[self] = ${axis}[self] - ${-d};`);
          } else out.push(`${axis}[self] = ${axis}[self] + ${V(d)};`);
        }
        break;
      }
      case "set_pos":
        out.push(`ox[self] = ${V(b.x)};`, `oy[self] = ${V(b.y)};`);
        break;
      case "glide":
        out.push(`ogx[self] = ${V(b.x)};`, `ogy[self] = ${V(b.y)};`, `ogn[self] = ${b.frames};`);
        break;
      case "sprite":
        out.push(`osp[self] = ${env?.spriteIndex.get(b.sprite) ?? 0};`, `ocell[self] = ${b.cell === undefined ? "0" : V(b.cell)};`, `e_spr_set();`);
        break;
      case "cell":
        out.push(`ocell[self] = ${V(b.cell)};`, `e_spr_set();`);
        break;
      case "look": {
        let keep = 0xff;
        let set = 0;
        if (b.blend !== undefined) {
          keep &= ~0x0f;
          set |= b.blend & 15;
        }
        if (b.flipX !== undefined) {
          keep &= ~0x10;
          if (b.flipX) set |= 0x10;
        }
        if (b.flipY !== undefined) {
          keep &= ~0x20;
          if (b.flipY) set |= 0x20;
        }
        out.push(`om[self] = (om[self] & ${keep & 0xff}) | ${set};`);
        break;
      }
      case "show":
        out.push(`oflags[self] = oflags[self] | 8;`);
        break;
      case "hide":
        out.push(`oflags[self] = oflags[self] & 247;`);
        break;
      case "text": {
        const id = env ? env.strId(b.text) : 0;
        const len = b.text.length;
        out.push(`otx[self] = ${id};`);
        if (b.value !== undefined) out.push(`onv[self] = ${V(b.value)};`, `onf[self] = 1;`, `e_text_dims(${len + 5});`);
        else out.push(`onf[self] = 0;`, `e_text_dims(${len});`);
        break;
      }
      case "play": {
        const snd = (env?.p.sounds ?? []).find((s) => s.id === b.sound);
        if (!snd) out.push(`( unknown sound '${b.sound}' )`);
        else
          snd.voices.forEach((v, vi) => {
            if (vi >= 4 || v.vol <= 0) return;
            out.push(`Audio${vi}.addr = &sq32;`, `Audio${vi}.length = 32;`, `Audio${vi}.volume = ${v.vol};`, `Audio${vi}.adsr = 4369;`, `Audio${vi}.pitch = ${128 + v.note};`);
          });
        break;
      }
      case "song":
        out.push(`e_song_${b.song}_start();`, `e_sg[16] = 1;`);
        break;
      case "song_stop":
        out.push(`e_sg[16] = 0;`);
        break;
      case "goto":
        out.push(`e_sy[0] = SC_${b.scene.toUpperCase()};`, `e_sy[1] = 0;`);
        break;
      case "overlay":
        out.push(`e_sy[0] = SC_${b.scene.toUpperCase()};`, `e_sy[1] = 1;`);
        break;
      case "back":
        out.push(`e_sy[1] = 2;`);
        break;
      case "wait": {
        const slot = b.slot ?? 0;
        out.push(scene ? `e_st[${slot}] = ${V(b.ticks)};` : `oa${slot}[self] = ${V(b.ticks)};`);
        break;
      }
      case "destroy": {
        const t = b.target ?? "self";
        if (t === "self") out.push(`e_kill_slot(self);`);
        else if (t === "other") out.push(`e_kill_slot(other);`);
        else out.push(`e_kill_def(${env?.tplByDef.get(t.slice(4))?.k ?? 0});`);
        break;
      }
      case "spawn":
        out.push(`e_sp[0] = ${V(b.x)};`, `e_sp[1] = ${V(b.y)};`, `e_spawn(${env?.tplByDef.get(b.def)?.k ?? 0});`);
        break;
      case "send":
        out.push(`e_msg_${b.message}();`);
        break;
      case "set": {
        const scope = b.scope ?? "global";
        const cell = scope === "global" ? `var_${b.name}[0]` : `iv_${b.name}[${scope}]`;
        const v = V(b.value);
        out.push(b.mode === "add" ? `${cell} = ${cell} + ${v};` : b.mode === "sub" ? `${cell} = ${cell} - ${v};` : `${cell} = ${v};`);
        break;
      }
      case "if":
        out.push(`if ${lowerCond(b.cond, env)} {`, ...ind(lowerBlocks(b.then ?? [], env, scene, depth)));
        if (b.else && b.else.length > 0) out.push(`} else {`, ...ind(lowerBlocks(b.else, env, scene, depth)));
        out.push(`}`);
        break;
      case "repeat": {
        const r = `r${depth}`;
        out.push(`for ${r} in 0..${V(b.times)} {`);
        if (b.index) out.push(`    var_${b.index}[0] = ${r};`);
        out.push(...ind(lowerBlocks(b.body ?? [], env, scene, depth + 1)), `}`);
        break;
      }
      case "call":
        out.push(`${b.fn}(${(b.args ?? []).map(V).join(", ")});`);
        break;
      case "jump":
        // Vertical speed is stored +8 (0..16): power p sets it to -p.
        out.push(`e_tq[0] = ${V(b.power)};`, `if e_tq[0] > 8 { e_tq[0] = 8; }`, `ovy[self] = 8 - e_tq[0];`, `ognd[self] = 0;`);
        break;
      case "code":
        out.push(USER_CODE_BEGIN, ...String(b.code).split("\n"), USER_CODE_END);
        break;
    }
  }
  return out;
}

/** Generated code for one event, for the editor's "show code". */
export function previewEvent(p: Project, ev: ObjectEvent, scene = false): string[] {
  const env = makeEnv(p);
  return lowerBlocks(ev.blocks, env, scene);
}

/* ------------------------------------------------------------------
   Text: string table + glyphs.
   ------------------------------------------------------------------ */

function collectStrings(p: Project, tpls: Template[]): string[] {
  const set = new Set<string>();
  for (const t of tpls) if (t.label) set.add(t.label);
  for (const s of p.scenes) {
    try {
      for (const l of flattenScene(p, s.id)) if (l.label) set.add(l.label);
    } catch {
      /* validation reports */
    }
  }
  for (const b of eachBlock(allEvents(p))) if (b.op === "text") set.add(b.text);
  return [...set].sort();
}

function makeEnv(p: Project): LowerEnv {
  const tpls = templatesOf(p);
  const strings = collectStrings(p, tpls);
  const ids = new Map(strings.map((s, i) => [s, i + 1]));
  return {
    p,
    spriteIndex: new Map(p.sprites.map((s, i) => [s.id, i])),
    tplByDef: new Map(tpls.filter((t) => t.def).map((t) => [t.def!.id, t])),
    strId: (s) => ids.get(s) ?? 0,
    sceneIndex: new Map([...p.scenes].sort((a, b) => (a.id < b.id ? -1 : 1)).map((s, i) => [s.id, i])),
    strLen: new Map(strings.map((s, i) => [i + 1, s.length])),
  };
}

/* ------------------------------------------------------------------
   The emitter.
   ------------------------------------------------------------------ */

const HANDLER_TRIGGERS = ["create", "destroy", "alarm", "message"] as const;

export function emitEngineProject(
  p: Project,
  custom: string,
  topImports: string[],
  scriptImports: string[],
  hooks: Set<HookName>,
  moduleFiles: Record<string, string>,
): Record<string, string> {
  const tpls = templatesOf(p);
  const env = makeEnv(p);
  const scenes = [...p.scenes].sort((a, b) => (a.id < b.id ? -1 : 1));
  const flat = new Map(p.scenes.map((s) => [s.id, flattenScene(p, s.id)] as const));
  const events = allEvents(p);
  const blocks = eachBlock(events);
  const has = (op: string): boolean => blocks.some((b) => b.op === op);
  const trig = (t: EventTrigger): boolean => events.some((e) => e.trigger === t && e.blocks.length > 0);
  const values = blocks.flatMap(blockValues);
  const conds = blocks.flatMap(blockConds);
  const usesCode = (re: RegExp): boolean =>
    re.test([custom, ...(p.scripts ?? []).map((s) => s.code), ...blocks.filter((b) => b.op === "code").map((b) => (b as { code: string }).code)].join("\n"));

  // Feature flags (each gates its buffers AND the code reading them).
  const strings = collectStrings(p, tpls);
  const F = {
    text: strings.length > 0,
    number: blocks.some((b) => b.op === "text" && b.value !== undefined),
    timers: [0, 1, 2, 3].map(
      (n) =>
        events.some((e) => e.trigger === "alarm" && (e.alarm ?? 0) === n && e.blocks.length > 0) ||
        blocks.some((b) => b.op === "wait" && (b.slot ?? 0) === n),
    ),
    sceneTimers: [0, 1, 2, 3].map((n) =>
      p.scenes.some(
        (s) =>
          (s.events ?? []).some((e) => e.trigger === "alarm" && (e.alarm ?? 0) === n && e.blocks.length > 0) ||
          eachBlock(s.events ?? []).some((b) => b.op === "wait" && (b.slot ?? 0) === n),
      ),
    ),
    glide: has("glide"),
    anim: tpls.some((t) => t.anim) || [...flat.values()].some((ls) => ls.some((l) => l.anim)),
    spawn: has("spawn"),
    collide: trig("collide"),
    touching: conds.some((c) => c.k === "touching"),
    mouseOver: conds.some((c) => c.k === "mouse_over"),
    click: trig("click"),
    drive: tpls.some((t) => t.controls) || [...flat.values()].some((ls) => ls.some((l) => l.controls)),
    other: trig("collide"),
    overlay: has("overlay") || has("back"),
    song: has("song") || has("song_stop"),
    random: values.some((v) => typeof v === "object" && v.k === "random") || usesCode(/\brnd\(/),
    kill: has("destroy"),
    tiles: p.scenes.some((s) => s.tilemap),
    camera: p.scenes.some((s) => s.camera?.follow),
    phys: tpls.some((t) => t.movement),
    msgs: [...new Set(blocks.filter((b) => b.op === "send").map((b) => (b as { message: string }).message))].sort(),
  };
  const objTimers = F.timers.map((t, n) => t && (tpls.some((x) => x.events.some((e) => e.trigger === "alarm" && (e.alarm ?? 0) === n)) || objectWaits(tpls, n)));
  const needHit = F.click || F.collide || F.touching || F.mouseOver || F.drive || F.phys;
  const view = F.tiles || F.camera;
  const masks = tpls.some((t) => t.mask) || [...flat.values()].some((ls) => ls.some((l) => l.mask));
  const ivarNames = [...new Set(tpls.flatMap((t) => t.vars.map((v) => v.id)))].sort();
  const poolOf = (s: Scene): number => s.pool ?? (F.spawn ? 16 : 0);
  for (const s of p.scenes) {
    const n = (flat.get(s.id) ?? []).length + poolOf(s);
    if (n > MAX_OBJECTS) throw new Error(`scene '${s.id}': ${n} objects with spawn slots (max ${MAX_OBJECTS})`);
  }
  const spriteIdx = env.spriteIndex;
  const spriteById = new Map(p.sprites.map((s) => [s.id, s] as const));
  // Sprites the build needs: placed, templated, animated or swapped in.
  const usedSprites = new Set<string>();
  for (const t of tpls) if (t.sprite) usedSprites.add(t.sprite);
  for (const ls of flat.values()) for (const l of ls) if (l.sprite) usedSprites.add(l.sprite);
  for (const a of p.anims) if (tpls.some((t) => t.anim === a.id) || [...flat.values()].some((ls) => ls.some((l) => l.anim === a.id))) a.frames.forEach((f) => usedSprites.add(f));
  for (const b of blocks) if (b.op === "sprite") usedSprites.add(b.sprite);
  for (const s of p.scenes) if (s.tilemap) usedSprites.add(s.tilemap.sprite);
  const animIdx = new Map(p.anims.map((a, i) => [a.id, i + 1]));

  // Per-slot buffers: [name, type] — the backup list for overlays.
  const slotBufs: Array<[string, "u8" | "u16"]> = [
    ["ox", "u16"], ["oy", "u16"], ["ot", "u16"], ["om", "u8"], ["ow", "u16"], ["oh", "u16"],
    ["otw", "u8"], ["oth", "u8"], ["osw", "u8"], ["oflags", "u8"], ["odef", "u8"], ["osp", "u8"], ["ocell", "u16"],
  ];
  if (needHit) slotBufs.push(["omx", "u16"], ["omy", "u16"], ["omw", "u16"], ["omh", "u16"]);
  if (F.text) slotBufs.push(["otx", "u8"]);
  if (F.number) slotBufs.push(["onv", "u16"], ["onf", "u8"]);
  objTimers.forEach((on, n) => {
    if (on) slotBufs.push([`oa${n}`, "u16"]);
  });
  if (F.glide) slotBufs.push(["ogx", "u16"], ["ogy", "u16"], ["ogn", "u8"]);
  if (F.anim) slotBufs.push(["oan", "u8"], ["oaf", "u8"], ["oak", "u8"], ["oad", "u8"]);
  if (F.phys) slotBufs.push(["omv", "u8"], ["ospd", "u8"], ["ojmp", "u8"], ["ovy", "u16"], ["ognd", "u8"], ["ogt", "u8"], ["odir", "u8"]);
  for (const v of ivarNames) slotBufs.push([`iv_${v}`, "u16"]);

  const o: string[] = [];
  const push = (...ls: string[]): void => {
    o.push(...ls);
  };
  push(`( generated by uxn-forge from project '${p.name}' — engine loop, do not edit. )`, `import "devices.ux"`);
  for (const line of topImports) push(line);
  push(``, `meta { title: "${p.name}", author: "${p.author}" }`, ``);
  scenes.forEach((s, i) => push(`SC_${s.id.toUpperCase()} :: ${i};`));
  push(``);

  /* ---- data ---- */
  for (const s of [...p.sprites].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (usedSprites.has(s.id)) push(`data spr_${s.id} = [${spriteToPlanar(s).join(", ")}];`);
  }
  if (usedVoices(p).length > 0) push(`data sq32 = [${SQ32.join(", ")}];`);
  const songList = referencedSongs(p);
  for (const s of songList) {
    s.tracks.forEach((tr, v) => {
      if (tr.notes.length === 0 || tr.vol <= 0) return;
      const pitch = Array.from({ length: MAX_SONG_STEPS }, (_, i) => tr.notes[i]?.pitch ?? SONG_REST);
      const len = Array.from({ length: MAX_SONG_STEPS }, (_, i) => tr.notes[i]?.len ?? 1);
      push(`data e_sg_${s.id}_v${v}p = [${pitch.join(", ")}];`, `data e_sg_${s.id}_v${v}l = [${len.join(", ")}];`);
    });
  }
  // Text: glyph table (only chars used, digits when numbers show) and
  // a string table of glyph indices, each string length-prefixed.
  if (F.text) {
    const chars = new Set<string>();
    for (const s of strings) for (const ch of s) chars.add(ch);
    if (F.number) for (const ch of "0123456789") chars.add(ch);
    const glyphList = [...chars].sort();
    const gi = new Map(glyphList.map((c, i) => [c, i]));
    push(`data e_glyphs = [${glyphList.flatMap((c) => glyphRows(c.charCodeAt(0))).join(", ")}];`);
    const bytes: number[] = [0];
    const offs: number[] = [0];
    for (const s of strings) {
      offs.push(bytes.length);
      bytes.push(s.length, ...[...s].map((c) => gi.get(c) ?? 0));
    }
    push(`data e_strs = [${bytes.join(", ")}];`);
    push(`buffer e_nb[5]: u16;`);
    push(`data e_stro = [${offs.flatMap((x) => [x >> 8, x & 255]).join(", ")}];`);
    if (F.number) push(`e_DIGIT0 :: ${gi.get("0") ?? 0};`);
  }
  // Scene rows: k, sprite, x hi, x lo, y hi, y lo, cell, mode, flags,
  // text id, anim — one per placed object, hierarchy order.
  const ROW = 11;
  const allRows: number[] = [];
  const rowStart = new Map<string, number>();
  for (const s of scenes) {
    rowStart.set(s.id, allRows.length);
    const rows: number[] = [];
    for (const l of flat.get(s.id) ?? []) {
      const t = templateOfLeaf(tpls, l);
      const sp = l.sprite ? (spriteIdx.get(l.sprite) ?? 255) : 255;
      const flags = 1 | 8 | (l.solid || l.kind === "movable" ? 2 : 0) | (l.kind === "movable" ? 4 : 0) | (l.kind === "player" ? 16 : 0) | (l.controls ? 32 : 0) | (l.mask ? 64 : 0) | (l.hud ? 128 : 0);
      rows.push(t?.k ?? 0, sp, l.x >> 8, l.x & 255, l.y >> 8, l.y & 255, l.cell ?? 0, defaultMode(l.sprite, l), flags, l.label ? env.strId(l.label) : 0, l.anim ? (animIdx.get(l.anim) ?? 0) : 0);
    }
    allRows.push(...rows);
  }
  if (allRows.length > 0) push(`data e_rows = [${allRows.join(", ")}];`);
  // Tile layers: every scene's grid in one blob (1 byte per cell,
  // 0 empty, n = sheet cell n-1) plus each sheet's solid flags.
  const tmAt = new Map<string, { map: number; sol: number }>();
  if (F.tiles) {
    const map: number[] = [];
    const sol: number[] = [];
    for (const s of scenes) {
      const tm = s.tilemap;
      if (!tm) continue;
      const spr = p.sprites.find((x) => x.id === tm.sprite);
      tmAt.set(s.id, { map: map.length, sol: sol.length });
      map.push(...tm.tiles);
      const n = spr ? cellCount(spr) : 1;
      for (let c = 0; c < n; c++) sol.push(tm.solid.includes(c) ? 1 : 0);
    }
    push(`data e_tmap = [${map.join(", ")}];`, `data e_tsol = [${sol.join(", ")}];`);
  }
  push(``);

  /* ---- state ---- */
  for (const [name, type] of slotBufs) push(`buffer ${name}[${MAX_OBJECTS}]: ${type};`);
  const vars = [...(p.vars ?? [])].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const v of vars) push(`buffer var_${v.id}[1]: u16;`);
  if (F.song) {
    for (const v of songVoices(p)) {
      push(`buffer sglp${v}[${MAX_SONG_STEPS}]: u8;`, `buffer sgll${v}[${MAX_SONG_STEPS}]: u8;`);
    }
    push(`buffer e_sg[17]: u8;`);
  }
  if (F.sceneTimers.some(Boolean)) push(`buffer e_st[4]: u16;`);
  // Zero page holds only what user code may touch; the engine's own
  // state lives in RAM (e_in: input latches, e_sy: scene switch,
  // layer, overlay depth, spawn range, save-stack pointer).
  push(`ocount: u8 = 0;`, `scene: u8 = 0;`, `self: u16 = 0;`, `buffer e_in[8]: u8;`, `buffer e_sy[8]: u8;`, `@E_IX@`);
  if (F.other) push(`other: u16 = 0;`);
  if (F.spawn) push(`buffer e_sp[3]: u16;`);
  if (F.random) push(`buffer e_seedb[1]: u16;`);
  // View: 0 cam x, 1 cam y, 2 world w, 3 world h, 4/5 a slot's screen
  // x/y while drawing, 6 template the camera follows (0 = none).
  if (view) push(`buffer e_cam[7]: u16;`);
  // Tile layer: 0 map offset, 1 cols (0 = no layer), 2 rows, 3 sheet
  // address, 4 solid-table offset, 5 draw byte; e_tv: draw scratch.
  if (F.tiles) push(`buffer e_tm[6]: u16;`, `buffer e_tv[5]: u16;`);
  // Movement scratch: 0/1 probe x/y, 2-4 tile lookup, 5/6 sample
  // counts, 7 direction, 8 jump power.
  if (F.phys) push(`buffer e_tq[9]: u16;`);
  // Overlay backups: two flat blocks (u16 and u8 slot buffers), two
  // depths each — every buffer is an assembler label, and the label
  // dictionary is as finite as the zero page.
  const b16 = slotBufs.filter(([, t]) => t === "u16").map(([n]) => n);
  const b8 = slotBufs.filter(([, t]) => t === "u8").map(([n]) => n);
  const K16 = b16.length * MAX_OBJECTS;
  const K8 = b8.length * MAX_OBJECTS + 4;
  if (F.overlay) push(`buffer e_bk16[${2 * K16}]: u16;`, `buffer e_bk8[${2 * K8}]: u8;`);
  if (F.overlay && view) push(`buffer e_bkv[26]: u16;`);
  // Self/other save stack for nested dispatch (messages, spawn, kill).
  const needStack = F.msgs.length > 0 || events.some((e) => e.trigger === "message") || F.spawn || F.kill;
  if (needStack) push(`buffer e_sstk[96]: u16;`);
  push(``);

  // Scripts + custom.ux after engine state (they may read it), before
  // engine fns (which may call them).
  if (scriptImports.length > 0) push(`( --- scripts --- )`, ...scriptImports, ``);
  if (custom) push(`( --- custom.ux --- )`, USER_CODE_BEGIN, ...custom.split("\n"), USER_CODE_END, ``);

  /* ---- helpers ---- */
  if (needStack) push(`e_push_self :: fn() {`, `    e_sstk[e_sy[6]] = self;`, F.other ? `    e_sstk[e_sy[6] + 1] = other;` : `    e_sstk[e_sy[6] + 1] = 0;`, `    e_sy[6] = e_sy[6] + 2;`, `}`, ``);
  if (needStack) push(`e_pop_self :: fn() {`, `    e_sy[6] = e_sy[6] - 2;`, `    self = e_sstk[e_sy[6]];`, ...(F.other ? [`    other = e_sstk[e_sy[6] + 1];`] : []), `}`, ``);
  // Public helper for code: change scene at the end of this frame.
  if (usesCode(/\bscene_go\(/)) push(`scene_go :: fn(id: u8) {`, `    e_sy[0] = id;`, `    e_sy[1] = 0;`, `}`, ``);
  if (F.random) {
    push(`e_rnd :: fn(max: u16) -> u16 {`, `    e_seedb[0] = e_seedb[0] * 25173 + 13849 + e_in[1] + Mouse.x;`, `    if max == 0 { return 0; }`, `    return (e_seedb[0] >> 3) % max;`, `}`, ``);
  }

  // Sprite/cell → tile address, tile dims, sheet stride, pixel dims.
  push(`e_spr_set :: fn() {`);
  push(`    match osp[self] {`);
  for (const s of p.sprites) {
    if (!usedSprites.has(s.id)) continue;
    const [W] = spriteTiles(s);
    const [cw, ch] = cellTiles(s);
    const perRow = Math.max(1, Math.floor(W / cw));
    const cellExpr = s.cell ? ` + ((ocell[self] / ${perRow}) * ${ch * W} + (ocell[self] % ${perRow}) * ${cw}) * 16` : "";
    push(`        ${spriteIdx.get(s.id)} => {`);
    push(`            ot[self] = &spr_${s.id}${cellExpr};`);
    push(`            otw[self] = ${cw}; oth[self] = ${ch}; osw[self] = ${W};`);
    push(`            ow[self] = ${cw * 8}; oh[self] = ${ch * 8};`);
    push(`        }`);
  }
  push(`        _ => { ot[self] = 0; }`, `    }`);
  if (needHit) push(`    if oflags[self] & 64 == 0 { omx[self] = 0; omy[self] = 0; omw[self] = ow[self]; omh[self] = oh[self]; }`);
  push(`}`, ``);
  if (F.text) {
    // Text-only objects measure as their text (clicks, collisions).
    push(`e_text_dims :: fn(n: u8) {`, `    if ot[self] == 0 {`, `        ow[self] = n * 8; oh[self] = 8;`);
    if (needHit) push(`        if oflags[self] & 64 == 0 { omx[self] = 0; omy[self] = 0; omw[self] = ow[self]; omh[self] = 8; }`);
    push(`    }`, `}`, ``);
    push(`e_str_len :: fn(s: u8) -> u8 {`, `    return e_strs[e_stro[s * 2] * 256 + e_stro[s * 2 + 1]];`, `}`, ``);
  }
  if (needHit) {
    // The mouse inside this object's hitbox (self).
    push(`e_hit :: fn() -> u8 {`);
    push(`    if Mouse.x >= ox[self] + omx[self] && Mouse.x < ox[self] + omx[self] + omw[self] && Mouse.y >= oy[self] + omy[self] && Mouse.y < oy[self] + omy[self] + omh[self] { return 1; }`);
    push(`    return 0;`, `}`, ``);
    if (F.click) push(`e_clicked :: fn() -> u8 {`, `    if e_in[6] & 1 == 0 { return 0; }`, `    return e_hit();`, `}`, ``);
    push(`e_ovl :: fn(a: u16, b: u16) -> u8 {`);
    push(`    if ox[a] + omx[a] < ox[b] + omx[b] + omw[b] && ox[b] + omx[b] < ox[a] + omx[a] + omw[a] && oy[a] + omy[a] < oy[b] + omy[b] + omh[b] && oy[b] + omy[b] < oy[a] + omy[a] + omh[a] { return 1; }`);
    push(`    return 0;`, `}`, ``);
    push(`e_tmatch :: fn(j: u16, tk: u8, td: u8) -> u8 {`);
    push(`    if j == self { return 0; }`, `    if oflags[j] & 1 == 0 { return 0; }`);
    push(`    if tk == 1 { if oflags[j] & 2 == 0 { return 0; } }`);
    push(`    if tk == 2 { if oflags[j] & 16 == 0 { return 0; } }`);
    push(`    if tk == 3 { if oflags[j] & 4 == 0 { return 0; } }`);
    push(`    if tk == 4 { if odef[j] != td { return 0; } }`);
    push(`    return 1;`, `}`, ``);
    if (F.touching) {
      push(`e_touching :: fn(tk: u8, td: u8) -> u8 {`);
      push(`    for j in 0..ocount {`, `        if e_tmatch(j, tk, td) != 0 { if e_ovl(self, j) != 0 { return 1; } }`, `    }`);
      push(`    return 0;`, `}`, ``);
    }
  }

  /* ---- handlers ---- */
  // Object handlers: create/destroy/alarm/message as dispatchable fns,
  // key/click/release/step folded into one per-template frame fn,
  // collisions as one per-template fn (they loop over targets).
  const hname = (t: Template, e: ObjectEvent, i: number): string => `e_h${t.k}_${e.trigger}_${i}`;
  const evs = (t: Template, trig: EventTrigger): ObjectEvent[] => t.events.filter((e) => e.trigger === trig && e.blocks.length > 0);
  const lower = (bs: Block[], scene = false): string[] => lowerBlocks(bs, env, scene).map((l) => `    ${l}`);
  const keyTest = (e: ObjectEvent): string =>
    e.button ? `e_in[3] & ${BUTTONS[e.button]} != 0` : `e_in[1] == ${(p.inputs ?? []).find((i) => i.id === e.key)?.key ?? 0}`;

  for (const t of tpls) {
    t.events.forEach((e, i) => {
      if (e.blocks.length === 0) return;
      if ((HANDLER_TRIGGERS as readonly string[]).includes(e.trigger)) push(`${hname(t, e, i)} :: fn() {`, ...lower(e.blocks), `}`, ``);
    });
    const frameEvs = t.events.filter((e) => ["key", "click", "release", "step"].includes(e.trigger) && e.blocks.length > 0);
    if (frameEvs.length > 0) {
      push(`e_tf${t.k} :: fn() {`);
      for (const e of t.events) {
        if (e.blocks.length === 0) continue;
        if (e.trigger === "key") push(`    if ${keyTest(e)} {`, ...lower(e.blocks).map((l) => `    ${l}`), `    }`);
        else if (e.trigger === "click") push(`    if e_clicked() != 0 {`, ...lower(e.blocks).map((l) => `    ${l}`), `    }`);
        else if (e.trigger === "release") push(`    if e_in[7] & 1 != 0 {`, ...lower(e.blocks).map((l) => `    ${l}`), `    }`);
      }
      for (const e of evs(t, "step")) push(...lower(e.blocks));
      push(`}`, ``);
    }
    const colls = evs(t, "collide");
    if (colls.length > 0) {
      push(`e_tc${t.k} :: fn() {`);
      colls.forEach((e, ci) => {
        const [tk, td] = TARGET_CODE(e.target ?? "any", env);
        push(`    for j${ci} in 0..ocount {`, `        if e_tmatch(j${ci}, ${tk}, ${td}) != 0 {`, `            if e_ovl(self, j${ci}) != 0 {`, `                other = j${ci};`);
        push(...lower(e.blocks).map((l) => `            ${l}`), `            }`, `        }`, `    }`);
      });
      push(`}`, ``);
    }
  }
  // Dispatchers: match the slot's template, call its handler.
  const dispatch = (name: string, pick: (t: Template) => string | null): boolean => {
    const arms = tpls.map((t) => [t.k, pick(t)] as const).filter((x) => x[1]);
    if (arms.length === 0) return false;
    push(`${name} :: fn() {`, `    match odef[self] {`);
    for (const [k, call] of arms) push(`        ${k} => { ${call} }`);
    push(`        _ => { }`, `    }`, `}`, ``);
    return true;
  };
  const firstOf = (t: Template, trig: EventTrigger, pred: (e: ObjectEvent) => boolean = () => true): string | null => {
    const calls = t.events.map((e, i) => [e, i] as const).filter(([e]) => e.trigger === trig && e.blocks.length > 0 && pred(e)).map(([e, i]) => `${hname(t, e, i)}();`);
    return calls.length > 0 ? calls.join(" ") : null;
  };
  const hasCreate = dispatch("e_d_create", (t) => firstOf(t, "create"));
  const hasDestroy = dispatch("e_d_destroy", (t) => firstOf(t, "destroy"));
  const hasFrame = dispatch("e_d_frame", (t) => (t.events.some((e) => ["key", "click", "release", "step"].includes(e.trigger) && e.blocks.length > 0) ? `e_tf${t.k}();` : null));
  const hasColl = dispatch("e_d_coll", (t) => (evs(t, "collide").length > 0 ? `e_tc${t.k}();` : null));
  const alarmD = [0, 1, 2, 3].map((n) => objTimers[n] && dispatch(`e_d_alarm${n}`, (t) => firstOf(t, "alarm", (e) => (e.alarm ?? 0) === n)));
  const allMsgs = [...new Set([...F.msgs, ...events.filter((e) => e.trigger === "message" && e.message).map((e) => e.message as string)])].sort();
  const msgD = new Map(allMsgs.map((m) => [m, dispatch(`e_d_msg_${m}`, (t) => firstOf(t, "message", (e) => e.message === m))]));

  // Scene handlers.
  const sname = (s: Scene, e: ObjectEvent, i: number): string => `e_s_${s.id}_${e.trigger}_${i}`;
  for (const s of scenes) {
    (s.events ?? []).forEach((e, i) => {
      if (e.blocks.length === 0) return;
      if (e.trigger === "create" || e.trigger === "alarm" || e.trigger === "message") push(`${sname(s, e, i)} :: fn() {`, ...lower(e.blocks, true), `}`, ``);
    });
    const sf = (s.events ?? []).filter((e) => ["key", "click", "release", "step"].includes(e.trigger) && e.blocks.length > 0);
    const st = (s.events ?? []).filter((e) => e.trigger === "alarm" && e.blocks.length > 0);
    if (sf.length + st.length > 0) {
      push(`e_sf_${s.id} :: fn() {`);
      for (const e of s.events ?? []) {
        if (e.blocks.length === 0) continue;
        if (e.trigger === "key") push(`    if ${keyTest(e)} {`, ...lower(e.blocks, true).map((l) => `    ${l}`), `    }`);
        else if (e.trigger === "click") push(`    if e_in[6] & 1 != 0 {`, ...lower(e.blocks, true).map((l) => `    ${l}`), `    }`);
        else if (e.trigger === "release") push(`    if e_in[7] & 1 != 0 {`, ...lower(e.blocks, true).map((l) => `    ${l}`), `    }`);
      }
      for (const e of (s.events ?? []).filter((x) => x.trigger === "step" && x.blocks.length > 0)) push(...lower(e.blocks, true));
      for (const n of [0, 1, 2, 3]) {
        if (!F.sceneTimers[n]) continue;
        const calls = (s.events ?? []).map((e, i) => [e, i] as const).filter(([e]) => e.trigger === "alarm" && (e.alarm ?? 0) === n && e.blocks.length > 0);
        push(`    if e_st[${n}] != 0 {`, `        e_st[${n}] = e_st[${n}] - 1;`);
        if (calls.length > 0) push(`        if e_st[${n}] == 0 { ${calls.map(([e, i]) => `${sname(s, e, i)}();`).join(" ")} }`);
        push(`    }`);
      }
      push(`}`, ``);
    }
  }

  // Messages: the current scene's handler, then every live object's.
  const objMsgs = allMsgs.filter((m) => msgD.get(m));
  if (objMsgs.length > 0) {
    // One loop for every message. A handler may send another message
    // (nested broadcast): the loop's position and message id ride the
    // save stack across each handler call — static locals would
    // otherwise be clobbered by the inner loop.
    push(`e_broadcast :: fn(m: u16) {`, `    j: u16 = 0;`, `    while j < ocount {`, `        if oflags[j] & 1 != 0 {`);
    push(`            e_sstk[e_sy[6]] = j; e_sstk[e_sy[6] + 1] = m; e_sy[6] = e_sy[6] + 2;`, `            self = j;`, `            match m {`);
    objMsgs.forEach((m, mi) => push(`                ${mi} => { e_d_msg_${m}(); }`));
    push(`                _ => { }`, `            }`, `            e_sy[6] = e_sy[6] - 2; j = e_sstk[e_sy[6]]; m = e_sstk[e_sy[6] + 1];`, `        }`, `        j = j + 1;`, `    }`, `}`, ``);
  }
  for (const m of allMsgs) {
    push(`e_msg_${m} :: fn() {`, `    e_push_self();`);
    const sceneArms = scenes
      .map((s, si) => [si, (s.events ?? []).map((e, i) => [e, i] as const).filter(([e]) => e.trigger === "message" && e.message === m && e.blocks.length > 0)] as const)
      .filter(([, l]) => l.length > 0);
    if (sceneArms.length > 0) {
      push(`    match scene {`);
      for (const [si, l] of sceneArms) push(`        ${si} => { ${l.map(([e, i]) => `${sname(scenes[si], e, i)}();`).join(" ")} }`);
      push(`        _ => { }`, `    }`);
    }
    if (msgD.get(m)) push(`    e_broadcast(${objMsgs.indexOf(m)});`);
    push(`    e_pop_self();`, `}`, ``);
  }

  // Destroy: run the destroy event, then the slot goes dead.
  if (F.kill) {
    push(`e_kill_slot :: fn(i: u16) {`, `    if oflags[i] & 1 == 0 { return; }`, `    e_push_self();`, `    self = i;`);
    if (hasDestroy) push(`    e_d_destroy();`);
    push(`    oflags[i] = 0;`, `    e_pop_self();`, `}`, ``);
    push(`e_kill_def :: fn(k: u8) {`, `    for i in 0..ocount {`, `        if odef[i] == k { e_kill_slot(i); }`, `    }`, `}`, ``);
  }

  // Template defaults: everything a slot starts with beyond its row.
  push(`e_tpl_init :: fn() {`);
  if (F.number) push(`    onf[self] = 0;`);
  objTimers.forEach((on, n) => {
    if (on) push(`    oa${n}[self] = 0;`);
  });
  if (F.glide) push(`    ogn[self] = 0;`);
  if (F.anim) push(`    oaf[self] = 0; oak[self] = 0; oad[self] = 0;`);
  if (F.phys) push(`    omv[self] = 0;`);
  const initArms = tpls.filter((t) => t.mask || t.vars.length > 0 || (F.phys && t.movement));
  if (initArms.length > 0) {
    push(`    match odef[self] {`);
    for (const t of initArms) {
      const ls: string[] = [];
      if (t.mask && needHit) ls.push(`omx[self] = ${t.mask.x}; omy[self] = ${t.mask.y}; omw[self] = ${t.mask.w}; omh[self] = ${t.mask.h};`);
      for (const v of t.vars) ls.push(`iv_${v.id}[self] = ${v.init};`);
      if (F.phys && t.movement)
        ls.push(`omv[self] = ${t.movement === "platformer" ? 1 : 2}; ospd[self] = ${t.speed}; ojmp[self] = ${t.jump}; ovy[self] = 8; ognd[self] = 0; ogt[self] = 0; odir[self] = 1;`);
      push(`        ${t.k} => { ${ls.join(" ")} }`);
    }
    push(`        _ => { }`, `    }`);
  }
  push(`}`, ``);
  if (F.spawn) {
    // A template's own look/flags for spawned instances.
    // Only templates something spawns need their defaults at runtime.
    const spawned = new Set(blocks.filter((b) => b.op === "spawn").map((b) => (b as { def: string }).def));
    push(`e_tpl_defaults :: fn() {`, `    match odef[self] {`);
    for (const t of tpls.filter((x) => x.def && spawned.has(x.def.id))) {
      const flags = 1 | 8 | (t.solid ? 2 : 0) | (t.kind === "movable" ? 4 : 0) | (t.kind === "player" ? 16 : 0) | (t.controls ? 32 : 0) | (t.mask ? 64 : 0) | (t.hud ? 128 : 0);
      const bits = [
        `osp[self] = ${t.sprite ? (spriteIdx.get(t.sprite) ?? 255) : 255};`,
        `ocell[self] = ${t.cell};`,
        `om[self] = ${t.mode};`,
        `oflags[self] = ${flags};`,
        ...(F.text ? [`otx[self] = ${t.label ? env.strId(t.label) : 0};`] : []),
        ...(F.anim ? [`oan[self] = ${t.anim ? (animIdx.get(t.anim) ?? 0) : 0};`] : []),
      ];
      push(`        ${t.k} => { ${bits.join(" ")} }`);
    }
    push(`        _ => { }`, `    }`, `}`, ``);
    push(`e_spawn :: fn(k: u8) {`, `    e_push_self();`, `    e_sp[2] = 255;`);
    push(`    for i in e_sy[4]..e_sy[5] {`, `        if e_sp[2] == 255 { if oflags[i] & 1 == 0 { e_sp[2] = i; } }`, `    }`);
    push(`    if e_sp[2] != 255 {`, `        self = e_sp[2];`, `        odef[self] = k;`, `        ox[self] = e_sp[0]; oy[self] = e_sp[1];`, `        e_tpl_defaults();`, `        e_spr_set();`);
    if (F.text) push(`        if otx[self] != 0 { e_text_dims(e_str_len(otx[self])); }`);
    push(`        e_tpl_init();`);
    if (hasCreate) push(`        e_d_create();`);
    push(`    }`, `    e_pop_self();`, `}`, ``);
  }

  // Scene setup: one shared loader fills slots from the row table
  // (and clears spare spawn slots); each scene's setup only adds its
  // per-instance values and start events. No per-scene locals: every
  // fn local is a zero-page byte the user's scripts can't have.
  const anyRows = allRows.length > 0;
  if (anyRows) {
    push(`e_load :: fn(r: u16, n: u16, top: u16) {`, `    for i in 0..top {`, `        oflags[i] = 0;`, `        if i < n {`, `            self = i;`);
    push(`            odef[i] = e_rows[r]; osp[i] = e_rows[r + 1];`);
    push(`            ox[i] = e_rows[r + 2]; ox[i] = (ox[i] << 8) | e_rows[r + 3];`);
    push(`            oy[i] = e_rows[r + 4]; oy[i] = (oy[i] << 8) | e_rows[r + 5];`);
    push(`            ocell[i] = e_rows[r + 6]; om[i] = e_rows[r + 7]; oflags[i] = e_rows[r + 8];`);
    if (F.text) push(`            otx[i] = e_rows[r + 9];`);
    if (F.anim) push(`            oan[i] = e_rows[r + 10];`);
    push(`            e_spr_set();`);
    if (F.text) push(`            if otx[i] != 0 { e_text_dims(e_str_len(otx[i])); }`);
    push(`            e_tpl_init();`, `            r = r + ${ROW};`, `        }`, `    }`, `}`, ``);
  }
  if (hasCreate) push(`e_create_all :: fn(n: u16) {`, `    for i in 0..n {`, `        if oflags[i] & 1 != 0 { self = i; e_d_create(); }`, `    }`, `}`, ``);
  for (const s of scenes) {
    const leaves = flat.get(s.id) ?? [];
    const N = leaves.length;
    const pool = poolOf(s);
    push(`e_setup_${s.id} :: fn() {`);
    push(`    ocount = ${N + pool};`);
    if (F.spawn) push(`    e_sy[4] = ${N}; e_sy[5] = ${N + pool};`);
    F.sceneTimers.forEach((on, n) => {
      if (on) push(`    e_st[${n}] = 0;`);
    });
    if (F.tiles) {
      const tm = s.tilemap;
      const at = tmAt.get(s.id);
      if (tm && at) push(`    e_tm[0] = ${at.map}; e_tm[1] = ${tm.cols}; e_tm[2] = ${tm.rows}; e_tm[3] = &spr_${tm.sprite}; e_tm[4] = ${at.sol}; e_tm[5] = ${128 | ((tm.blend ?? 1) & 15)};`);
      else push(`    e_tm[1] = 0;`);
    }
    if (view) {
      const [ww, wh] = worldSize(p, s);
      push(`    e_cam[0] = 0; e_cam[1] = 0; e_cam[2] = ${ww}; e_cam[3] = ${wh}; e_cam[6] = ${s.camera?.follow ? (tpls.find((t) => t.def?.id === s.camera?.follow)?.k ?? 0) : 0};`);
    }
    if (anyRows) push(`    e_load(${rowStart.get(s.id) ?? 0}, ${N}, ${N + pool});`);
    leaves.forEach((l, i) => {
      const t = templateOfLeaf(tpls, l);
      if (l.mask && needHit && (!t?.mask || JSON.stringify(t.mask) !== JSON.stringify(l.mask)))
        push(`    omx[${i}] = ${l.mask.x}; omy[${i}] = ${l.mask.y}; omw[${i}] = ${l.mask.w}; omh[${i}] = ${l.mask.h};`);
      for (const [name, val] of Object.entries(l.vars ?? {})) if (t?.vars.some((v) => v.id === name)) push(`    iv_${name}[${i}] = ${val};`);
    });
    (s.events ?? []).forEach((e, i) => {
      if (e.trigger === "create" && e.blocks.length > 0) push(`    ${sname(s, e, i)}();`);
    });
    if (hasCreate && N > 0) push(`    e_create_all(${N});`);
    push(`}`, ``);
  }
  push(`e_setup :: fn() {`, `    match scene {`);
  scenes.forEach((s, i) => push(`        ${i} => { e_setup_${s.id}(); }`));
  push(`        _ => { }`, `    }`, `}`, ``);

  /* ---- per-frame systems ---- */
  push(`e_input :: fn() {`, `    e_in[1] = e_in[0]; e_in[0] = 0;`, `    e_in[3] = Controller.button & (e_in[2] ^ 255); e_in[2] = Controller.button;`);
  push(`    e_in[4] = e_in[4] | Mouse.state;`, `    e_in[6] = e_in[4] & (e_in[5] ^ 255); e_in[7] = e_in[5] & (e_in[4] ^ 255); e_in[5] = e_in[4]; e_in[4] = 0;`, `}`, ``);
  const timerSlots = [0, 1, 2, 3].filter((n) => objTimers[n]);
  if (timerSlots.length > 0 || F.glide || F.anim) {
    push(`e_systems :: fn() {`, `    for i in 0..ocount {`, `        if oflags[i] & 1 != 0 {`, `            self = i;`);
    for (const n of timerSlots) {
      push(`            if oa${n}[i] != 0 {`, `                oa${n}[i] = oa${n}[i] - 1;`);
      if (alarmD[n]) push(`                if oa${n}[i] == 0 { e_d_alarm${n}(); }`);
      push(`            }`);
    }
    if (F.glide) {
      push(`            if ogn[i] != 0 {`);
      push(`                if ogx[i] > ox[i] { ox[i] = ox[i] + (ogx[i] - ox[i]) / ogn[i]; } else { ox[i] = ox[i] - (ox[i] - ogx[i]) / ogn[i]; }`);
      push(`                if ogy[i] > oy[i] { oy[i] = oy[i] + (ogy[i] - oy[i]) / ogn[i]; } else { oy[i] = oy[i] - (oy[i] - ogy[i]) / ogn[i]; }`);
      push(`                ogn[i] = ogn[i] - 1;`, `            }`);
    }
    if (F.anim) push(`            if oan[i] != 0 { e_anim_tick(); }`);
    push(`        }`, `    }`, `}`, ``);
  }
  if (F.anim) {
    push(`e_anim_tick :: fn() {`, `    oak[self] = oak[self] + 1;`, `    match oan[self] {`);
    p.anims.forEach((a, ai) => {
      const F_ = a.frames.length;
      const lines: string[] = [`if oak[self] >= ${a.rate} {`, `    oak[self] = 0;`];
      if (a.pingpong) {
        lines.push(`    if oad[self] == 0 {`, `        oaf[self] = oaf[self] + 1;`, `        if oaf[self] >= ${F_} { oaf[self] = ${F_ - 2}; oad[self] = 1; }`, `    } else {`);
        lines.push(`        if oaf[self] == 0 { oaf[self] = 1; oad[self] = 0; } else { oaf[self] = oaf[self] - 1; }`, `    }`);
      } else {
        lines.push(`    oaf[self] = oaf[self] + 1;`, `    if oaf[self] >= ${F_} { oaf[self] = ${a.loop ? 0 : F_ - 1}; }`);
      }
      lines.push(`    match oaf[self] {`);
      a.frames.forEach((f, fi) => lines.push(`        ${fi} => { osp[self] = ${spriteIdx.get(f) ?? 0}; }`));
      lines.push(`        _ => { }`, `    }`, `    e_spr_set();`, `}`);
      push(`        ${ai + 1} => {`, ...lines.map((l) => `            ${l}`), `        }`);
    });
    push(`        _ => { }`, `    }`, `}`, ``);
  }
  if (F.drive) {
    // Arrow keys move keyboard-driven objects 1px, blocked by solids,
    // pushing movables that have room.
    push(`e_drive :: fn() {`, `    for i in 0..ocount {`, `        if oflags[i] & 33 == 33 {`, `            self = i;`, `            e_drive_one();`, `        }`, `    }`, `}`, ``);
    push(`e_drive_one :: fn() {`);
    push(`    b: u8 = Controller.button;`, `    px: u16 = ox[self]; py: u16 = oy[self];`);
    push(`    if b & 64 != 0 { if ox[self] >= 1 { ox[self] = ox[self] - 1; } }`);
    push(`    if b & 128 != 0 { if ox[self] + ow[self] < ${p.width} { ox[self] = ox[self] + 1; } }`);
    push(`    if b & 16 != 0 { if oy[self] >= 1 { oy[self] = oy[self] - 1; } }`);
    push(`    if b & 32 != 0 { if oy[self] + oh[self] < ${p.height} { oy[self] = oy[self] + 1; } }`);
    push(`    blocked: u8 = 0;`);
    push(`    for j in 0..ocount {`, `        if e_tmatch(j, 1, 0) != 0 {`, `            if e_ovl(self, j) != 0 {`);
    push(`                if oflags[j] & 4 != 0 {`, `                    qx: u16 = ox[j]; qy: u16 = oy[j];`);
    push(`                    ox[j] = ox[j] + ox[self] - px; oy[j] = oy[j] + oy[self] - py;`);
    push(`                    free: u8 = 1;`, `                    if ox[j] + ow[j] > ${p.width} { free = 0; } if oy[j] + oh[j] > ${p.height} { free = 0; }`);
    push(`                    for q in 0..ocount {`, `                        if q != j { if e_tmatch(q, 1, 0) != 0 { if e_ovl(j, q) != 0 { free = 0; } } }`, `                    }`);
    push(`                    if free == 0 { ox[j] = qx; oy[j] = qy; blocked = 1; }`);
    push(`                } else { blocked = 1; }`, `            }`, `        }`, `    }`);
    push(`    if blocked != 0 { ox[self] = px; oy[self] = py; }`, `}`, ``);
  }

  // Draw: clear our layer, then every live visible slot, in order.
  const bg = (p.bg ?? 0) & 3;
  push(`e_draw :: fn() {`, `    Screen.x = 0; Screen.y = 0;`);
  push(F.overlay ? `    if e_sy[2] == 0 { Screen.pixel = ${128 | bg}; } else { Screen.pixel = 192; }` : `    Screen.pixel = ${128 | bg};`);
  if (F.tiles) push(`    if e_tm[1] != 0 { e_draw_tiles(); }`);
  push(`    for i in 0..ocount {`, `        if oflags[i] & 9 == 9 {`, `            self = i;`);
  // Screen position: world minus camera, unless the object is HUD.
  if (view) push(`            e_cam[4] = ox[i]; e_cam[5] = oy[i];`, `            if oflags[i] & 128 == 0 { e_cam[4] = e_cam[4] - e_cam[0]; e_cam[5] = e_cam[5] - e_cam[1]; }`);
  push(`            if ot[i] != 0 { e_draw_obj(); }`);
  if (F.text) push(`            if otx[i] != 0 { e_draw_text(); }`);
  push(`        }`, `    }`, `}`, ``);
  // Tiles row-major inside the cell, a sheet-width apart in the blob;
  // flips mirror where each tile lands (the VM mirrors its pixels).
  // (ty * osw + tx) * 16 stays under 256: cells are at most 4×4 tiles.
  push(`e_draw_obj :: fn() {`, `    m: u8 = om[self] | e_sy[2];`, `    for ty in 0..oth[self] {`, `        for tx in 0..otw[self] {`);
  push(`            if m & 16 != 0 { Screen.x = ${view ? "e_cam[4]" : "ox[self]"} + (otw[self] - 1 - tx) * 8; } else { Screen.x = ${view ? "e_cam[4]" : "ox[self]"} + tx * 8; }`);
  push(`            if m & 32 != 0 { Screen.y = ${view ? "e_cam[5]" : "oy[self]"} + (oth[self] - 1 - ty) * 8; } else { Screen.y = ${view ? "e_cam[5]" : "oy[self]"} + ty * 8; }`);
  push(`            Screen.addr = ot[self] + (ty * osw[self] + tx) * 16;`, `            Screen.sprite = m;`, `        }`, `    }`, `}`, ``);
  if (F.text) {
    // Scratch in RAM (e_nb: glyph, value, divisor, digit, lead) keeps
    // text drawing off the zero page.
    push(`e_draw_text :: fn() {`);
    push(`    tm: u8 = 5 | e_sy[2];`, `    if ot[self] == 0 { tm = (om[self] & 15) | e_sy[2]; }`);
    push(`    off: u16 = e_stro[otx[self] * 2];`, `    off = (off << 8) | e_stro[otx[self] * 2 + 1];`, `    cx: u16 = ${view ? "e_cam[4]" : "ox[self]"};`);
    push(`    for c in 0..e_strs[off] {`, `        e_nb[0] = e_strs[off + 1 + c];`, `        Screen.x = cx; Screen.y = ${view ? "e_cam[5]" : "oy[self]"};`, `        Screen.addr = &e_glyphs + e_nb[0] * 8;`, `        Screen.sprite = tm;`, `        cx = cx + 8;`, `    }`);
    if (F.number) {
      push(`    if onf[self] != 0 {`, `        e_nb[1] = onv[self]; e_nb[2] = 10000; e_nb[4] = 1;`);
      push(`        while e_nb[2] != 0 {`, `            e_nb[3] = e_nb[1] / e_nb[2];`, `            if e_nb[3] != 0 { e_nb[4] = 0; }`, `            if e_nb[2] == 1 { e_nb[4] = 0; }`);
      push(`            if e_nb[4] == 0 {`, `                Screen.x = cx; Screen.y = ${view ? "e_cam[5]" : "oy[self]"};`, `                Screen.addr = &e_glyphs + (e_DIGIT0 + e_nb[3]) * 8;`, `                Screen.sprite = tm;`, `                cx = cx + 8;`, `            }`);
      push(`            e_nb[1] = e_nb[1] % e_nb[2];`, `            e_nb[2] = e_nb[2] / 10;`, `        }`, `    }`);
    }
    push(`}`, ``);
  }

  if (F.tiles) {
    // Only the cells under the screen: (W/8 + 1) × (H/8 + 1) blits.
    push(`e_draw_tiles :: fn() {`, `    e_tv[0] = ${view ? "e_cam[0]" : "0"} / 8; e_tv[1] = e_tv[0] + ${Math.floor(p.width / 8) + 1};`, `    if e_tv[1] > e_tm[1] { e_tv[1] = e_tm[1]; }`);
    push(`    e_tv[2] = ${view ? "e_cam[1]" : "0"} / 8; e_tv[3] = e_tv[2] + ${Math.floor(p.height / 8) + 1};`, `    if e_tv[3] > e_tm[2] { e_tv[3] = e_tm[2]; }`);
    push(`    for r in e_tv[2]..e_tv[3] {`, `        for c in e_tv[0]..e_tv[1] {`, `            e_tv[4] = e_tmap[e_tm[0] + r * e_tm[1] + c];`, `            if e_tv[4] != 0 {`);
    push(`                Screen.x = c * 8 - e_cam[0]; Screen.y = r * 8 - e_cam[1];`, `                Screen.addr = e_tm[3] + (e_tv[4] - 1) * 16;`, `                Screen.sprite = e_tm[5] | e_sy[2];`, `            }`, `        }`, `    }`, `}`, ``);
  }
  if (F.phys) {
    // Is the world pixel (e_tq[0], e_tq[1]) inside a solid tile? Past
    // the side edges counts as wall; above and below the map is open.
    push(`e_tile_solid :: fn() -> u8 {`);
    if (F.tiles) {
      push(`    if e_tm[1] == 0 { return 0; }`, `    e_tq[2] = e_tq[0] / 8; e_tq[3] = e_tq[1] / 8;`, `    if e_tq[2] >= e_tm[1] { return 1; }`, `    if e_tq[3] >= e_tm[2] { return 0; }`);
      push(`    e_tq[4] = e_tmap[e_tm[0] + e_tq[3] * e_tm[1] + e_tq[2]];`, `    if e_tq[4] == 0 { return 0; }`, `    return e_tsol[e_tm[4] + e_tq[4] - 1];`);
    } else push(`    return 0;`);
    push(`}`, ``);
    // Does self's hitbox, where it is now, overlap a solid tile or a
    // solid object? Tiles are sampled every 8px plus the far edges.
    push(`e_blocked :: fn() -> u8 {`, `    e_tq[5] = omw[self] / 8; e_tq[6] = omh[self] / 8;`);
    push(`    for a in 0..e_tq[5] + 1 {`, `        e_tq[0] = ox[self] + omx[self] + a * 8;`, `        if a * 8 >= omw[self] { e_tq[0] = ox[self] + omx[self] + omw[self] - 1; }`);
    push(`        for b in 0..e_tq[6] + 1 {`, `            e_tq[1] = oy[self] + omy[self] + b * 8;`, `            if b * 8 >= omh[self] { e_tq[1] = oy[self] + omy[self] + omh[self] - 1; }`, `            if e_tile_solid() != 0 { return 1; }`, `        }`, `    }`);
    push(`    for j in 0..ocount {`, `        if e_tmatch(j, 1, 0) != 0 { if e_ovl(self, j) != 0 { return 1; } }`, `    }`, `    return 0;`, `}`, ``);
    // Walls flip walkers (and their art); runners just stop.
    push(`e_hitwall :: fn() {`, `    if omv[self] == 2 { odir[self] = odir[self] ^ 1; om[self] = om[self] ^ 16; }`, `}`, ``);
    // One step of movement for self. Vertical speed lives in ovy
    // offset by 8 (8 = still, <8 up, >8 down); gravity adds 1 every
    // 3 frames up to +4 px/frame.
    push(`e_phys_one :: fn() {`);
    push(`    oy[self] = oy[self] + 1;`, `    ognd[self] = e_blocked();`, `    oy[self] = oy[self] - 1;`);
    push(`    e_tq[7] = 0;`, `    if omv[self] == 1 {`, `        if Controller.button & 64 != 0 { e_tq[7] = 1; om[self] = om[self] | 16; }`, `        if Controller.button & 128 != 0 { e_tq[7] = 2; om[self] = om[self] & 239; }`);
    push(`        if ognd[self] != 0 { if (e_in[3] & 17 != 0) || (e_in[1] == 32) { ovy[self] = 8 - ojmp[self]; ognd[self] = 0; } }`, `    } else {`, `        e_tq[7] = odir[self] + 1;`, `    }`);
    push(`    for sa in 0..ospd[self] {`);
    push(`        if e_tq[7] == 1 {`, `            if ox[self] >= 1 {`, `                ox[self] = ox[self] - 1;`, `                if e_blocked() != 0 { ox[self] = ox[self] + 1; e_hitwall(); }`, `            } else { e_hitwall(); }`, `        }`);
    push(`        if e_tq[7] == 2 {`, `            ox[self] = ox[self] + 1;`, `            if ox[self] + ow[self] > ${view ? "e_cam[2]" : p.width} { ox[self] = ox[self] - 1; e_hitwall(); }`, `            elif e_blocked() != 0 { ox[self] = ox[self] - 1; e_hitwall(); }`, `        }`, `    }`);
    // Walkers turn at ledges: nothing solid under the leading foot.
    push(`    if omv[self] == 2 { if ognd[self] != 0 {`, `        e_tq[0] = ox[self] + omx[self] - 1;`, `        if odir[self] != 0 { e_tq[0] = ox[self] + omx[self] + omw[self]; }`, `        e_tq[1] = oy[self] + omy[self] + omh[self];`, `        if e_tile_solid() == 0 { e_hitwall(); }`, `    } }`);
    push(`    if ognd[self] != 0 { if ovy[self] > 8 { ovy[self] = 8; } ogt[self] = 0; }`, `    else {`, `        ogt[self] = ogt[self] + 1;`, `        if ogt[self] >= 3 { ogt[self] = 0; if ovy[self] < 12 { ovy[self] = ovy[self] + 1; } }`, `    }`);
    push(`    if ovy[self] > 8 {`, `        for sb in 0..ovy[self] - 8 {`, `            oy[self] = oy[self] + 1;`, `            if e_blocked() != 0 { oy[self] = oy[self] - 1; ovy[self] = 8; }`, `        }`, `    }`);
    push(`    if ovy[self] < 8 {`, `        for sc in 0..8 - ovy[self] {`, `            if oy[self] >= 1 {`, `                oy[self] = oy[self] - 1;`, `                if e_blocked() != 0 { oy[self] = oy[self] + 1; ovy[self] = 8; }`, `            } else { ovy[self] = 8; }`, `        }`, `    }`);
    // Fell out of the world: park just below it (events decide).
    push(`    if oy[self] > ${view ? "e_cam[3]" : p.height} + 16 { oy[self] = ${view ? "e_cam[3]" : p.height} + 16; ovy[self] = 8; }`, `}`, ``);
    push(`e_phys :: fn() {`, `    for i in 0..ocount {`, `        if oflags[i] & 1 != 0 { if omv[i] != 0 { self = i; e_phys_one(); } }`, `    }`, `}`, ``);
  }
  if (F.camera) {
    // Center the followed object, clamped to the world.
    push(`e_camera :: fn() {`, `    if e_cam[6] == 0 { return; }`, `    for i in 0..ocount {`, `        if oflags[i] & 1 != 0 { if odef[i] == e_cam[6] {`);
    push(`            e_cam[0] = 0; e_cam[4] = ox[i] + ow[i] / 2;`, `            if e_cam[4] > ${p.width >> 1} { e_cam[0] = e_cam[4] - ${p.width >> 1}; }`, `            if e_cam[2] > ${p.width} { if e_cam[0] > e_cam[2] - ${p.width} { e_cam[0] = e_cam[2] - ${p.width}; } } else { e_cam[0] = 0; }`);
    push(`            e_cam[1] = 0; e_cam[5] = oy[i] + oh[i] / 2;`, `            if e_cam[5] > ${p.height >> 1} { e_cam[1] = e_cam[5] - ${p.height >> 1}; }`, `            if e_cam[3] > ${p.height} { if e_cam[1] > e_cam[3] - ${p.height} { e_cam[1] = e_cam[3] - ${p.height}; } } else { e_cam[1] = 0; }`);
    push(`            return;`, `        } }`, `    }`, `}`, ``);
  }

  // Overlays freeze the scene below: its slots are copied aside and
  // its last frame stays on the background layer while the overlay
  // draws on the foreground; back restores both.
  if (F.overlay) {
    push(`e_save :: fn() {`, `    for i in 0..${MAX_OBJECTS} {`);
    b16.forEach((n, j) => push(`        e_bk16[e_sy[3] * ${K16} + ${j * MAX_OBJECTS} + i] = ${n}[i];`));
    b8.forEach((n, j) => push(`        e_bk8[e_sy[3] * ${K8} + ${j * MAX_OBJECTS} + i] = ${n}[i];`));
    push(`    }`, `    e_bk8[e_sy[3] * ${K8} + ${K8 - 4}] = ocount; e_bk8[e_sy[3] * ${K8} + ${K8 - 3}] = scene;`);
    if (view) push(`    for i in 0..7 { e_bkv[e_sy[3] * 13 + i] = e_cam[i]; }`);
    if (F.tiles) push(`    for i in 0..6 { e_bkv[e_sy[3] * 13 + 7 + i] = e_tm[i]; }`);
    if (F.spawn) push(`    e_bk8[e_sy[3] * ${K8} + ${K8 - 2}] = e_sy[4]; e_bk8[e_sy[3] * ${K8} + ${K8 - 1}] = e_sy[5];`);
    push(`}`, ``);
    push(`e_restore :: fn() {`, `    for i in 0..${MAX_OBJECTS} {`);
    b16.forEach((n, j) => push(`        ${n}[i] = e_bk16[e_sy[3] * ${K16} + ${j * MAX_OBJECTS} + i];`));
    b8.forEach((n, j) => push(`        ${n}[i] = e_bk8[e_sy[3] * ${K8} + ${j * MAX_OBJECTS} + i];`));
    push(`    }`, `    ocount = e_bk8[e_sy[3] * ${K8} + ${K8 - 4}]; scene = e_bk8[e_sy[3] * ${K8} + ${K8 - 3}];`);
    if (view) push(`    for i in 0..7 { e_cam[i] = e_bkv[e_sy[3] * 13 + i]; }`);
    if (F.tiles) push(`    for i in 0..6 { e_tm[i] = e_bkv[e_sy[3] * 13 + 7 + i]; }`);
    if (F.spawn) push(`    e_sy[4] = e_bk8[e_sy[3] * ${K8} + ${K8 - 2}]; e_sy[5] = e_bk8[e_sy[3] * ${K8} + ${K8 - 1}];`);
    push(`}`, ``);
  }
  push(`e_apply_scene :: fn() {`);
  if (F.overlay) {
    push(`    if e_sy[1] == 2 {`, `        e_sy[1] = 0;`, `        if e_sy[3] != 0 {`, `            e_sy[3] = e_sy[3] - 1;`);
    push(`            e_restore();`, `            if e_sy[3] == 0 { e_sy[2] = 0; }`, `            Screen.x = 0; Screen.y = 0; Screen.pixel = 192;`, `        }`, `        return;`, `    }`);
  } else push(`    if e_sy[1] == 2 { e_sy[1] = 0; return; }`);
  push(`    if e_sy[0] == 255 { return; }`);
  if (F.overlay) {
    push(`    if e_sy[1] == 1 {`, `        if e_sy[3] < 2 { e_save(); e_sy[3] = e_sy[3] + 1; }`, `        e_sy[2] = 64;`);
    push(`    } else {`, `        if e_sy[3] != 0 { e_sy[3] = 0; e_sy[2] = 0; Screen.x = 0; Screen.y = 0; Screen.pixel = 192; }`, `    }`);
  }
  push(`    scene = e_sy[0]; e_sy[0] = 255; e_sy[1] = 0;`, `    e_setup();`, `}`, ``);

  // The frame.
  if (F.song) {
    for (const s of songList) {
      push(`e_song_${s.id}_start :: fn() {`);
      s.tracks.forEach((tr, v) => {
        if (!songVoices(p).includes(v)) return;
        if (tr.notes.length === 0 || tr.vol <= 0) {
          push(`    e_sg[${v * 4 + 2}] = 0;`);
          return;
        }
        push(`    for i in 0..${tr.notes.length} { sglp${v}[i] = e_sg_${s.id}_v${v}p[i]; sgll${v}[i] = e_sg_${s.id}_v${v}l[i]; }`);
        push(`    e_sg[${v * 4 + 2}] = ${tr.notes.length};`, `    e_sg[${v * 4 + 3}] = ${tr.vol};`, `    e_sg[${v * 4}] = 0;`, `    e_sg[${v * 4 + 1}] = 0;`);
      });
      push(`}`, ``);
    }
    push(`song_tick :: fn() {`, `    if e_sg[16] == 0 { return; }`);
    for (const v of songVoices(p)) {
      push(`    if e_sg[${v * 4 + 2}] != 0 {`, `        if e_sg[${v * 4 + 1}] != 0 { e_sg[${v * 4 + 1}] = e_sg[${v * 4 + 1}] - 1; }`, `        else {`);
      push(`            p${v}: u8 = sglp${v}[e_sg[${v * 4}]];`, `            if p${v} != 127 {`);
      push(`                Audio${v}.addr = &sq32;`, `                Audio${v}.length = 32;`, `                Audio${v}.volume = e_sg[${v * 4 + 3}];`, `                Audio${v}.adsr = 4369;`, `                Audio${v}.pitch = 128 + p${v};`, `            }`);
      push(`            l${v}: u8 = sgll${v}[e_sg[${v * 4}]];`, `            if l${v} == 0 { l${v} = 1; }`, `            e_sg[${v * 4 + 1}] = l${v} - 1;`, `            e_sg[${v * 4}] = e_sg[${v * 4}] + 1;`, `            if e_sg[${v * 4}] >= e_sg[${v * 4 + 2}] { e_sg[${v * 4}] = 0; }`, `        }`, `    }`);
    }
    push(`}`, ``);
  }
  const sceneFrames = scenes.map((s, i) => [i, s] as const).filter(([, s]) => (s.events ?? []).some((e) => ["key", "click", "release", "step", "alarm"].includes(e.trigger) && e.blocks.length > 0) || F.sceneTimers.some(Boolean));
  push(`on_frame :: event() {`);
  if (F.song) push(`    song_tick();`);
  push(`    e_input();`);
  const realSceneFrames = sceneFrames.filter(([, s]) => (s.events ?? []).some((e) => ["key", "click", "release", "step", "alarm"].includes(e.trigger) && e.blocks.length > 0));
  if (realSceneFrames.length > 0) {
    push(`    match scene {`);
    for (const [i, s] of realSceneFrames) push(`        ${i} => { e_sf_${s.id}(); }`);
    push(`        _ => { }`, `    }`);
  }
  if (hasFrame) push(`    for i in 0..ocount {`, `        if oflags[i] & 1 != 0 { self = i; e_d_frame(); }`, `    }`);
  if (timerSlots.length > 0 || F.glide || F.anim) push(`    e_systems();`);
  if (hasColl) push(`    for i in 0..ocount {`, `        if oflags[i] & 1 != 0 { self = i; e_d_coll(); }`, `    }`);
  if (F.drive) push(`    e_drive();`);
  if (F.phys) push(`    e_phys();`);
  if (hooks.has("custom_frame")) push(`    custom_frame();`);
  if (F.camera) push(`    e_camera();`);
  push(`    e_draw();`);
  if (hooks.has("custom_draw")) push(`    custom_draw();`);
  push(`    e_apply_scene();`, `}`, ``);
  push(`on_key :: event() {`, `    e_in[0] = Controller.key;`);
  if (hooks.has("custom_key")) push(`    custom_key();`);
  push(`}`, ``, `on_mouse :: event() {`, `    e_in[4] = e_in[4] | Mouse.state;`);
  if (hooks.has("custom_mouse")) push(`    custom_mouse();`);
  push(`}`, ``);

  const theme = p.theme ?? { r: THEME_R, g: THEME_G, b: THEME_B };
  push(`start :: fn() {`, `    System.r = ${theme.r};`, `    System.g = ${theme.g};`, `    System.b = ${theme.b};`);
  push(`    Screen.width = ${p.width};`, `    Screen.height = ${p.height};`, `    e_sy[0] = 255;`);
  if (F.random) push(`    e_seedb[0] = 7;`);
  for (const v of vars) push(`    var_${v.id}[0] = ${v.init};`);
  for (const v of usedVoices(p)) {
    const voice = (p.sound?.voices ?? [])[v];
    if (!voice || voice.vol <= 0) continue;
    push(`    Audio${v}.addr = &sq32;`, `    Audio${v}.length = 32;`, `    Audio${v}.volume = ${voice.vol};`, `    Audio${v}.adsr = 4369;`, `    Audio${v}.pitch = ${128 + voice.note};`);
  }
  push(`    scene = SC_${p.start.toUpperCase()};`, `    e_setup();`);
  if (hooks.has("custom_setup")) push(`    custom_setup();`);
  push(`    Screen.vector = &on_frame;`, `    Controller.vector = &on_key;`, `    Mouse.vector = &on_mouse;`, `}`, ``);
  push(`main :: event() {`, `    start();`, `}`, ``);

  let devices = DEVICES_ENGINE;
  for (const v of usedVoices(p)) devices += audioBlock(`Audio${v}`, 48 + v * 16);
  const lean = thrift(o);
  const main = lean.lines.map((l) => (l === "@E_IX@" ? (lean.counters > 0 ? `buffer e_ix[${lean.counters}]: u16;` : "") : l)).join("\n");
  return { "devices.ux": devices, "main.ux": main, ...moduleFiles };
}

function objectWaits(tpls: Template[], n: number): boolean {
  return tpls.some((t) => eachBlock(t.events).some((b) => b.op === "wait" && (b.slot ?? 0) === n));
}

/* ------------------------------------------------------------------
   Scene flow (the Blocks map): goto/overlay arrows.
   ------------------------------------------------------------------ */

export interface FlowEdge {
  from: string;
  to: string;
  /** "goto" | "overlay" */
  kind: "goto" | "overlay";
  /** Who triggers it: object name or "scene". */
  via: string;
  trigger: EventTrigger;
}

export function sceneFlow(p: Project): FlowEdge[] {
  const out: FlowEdge[] = [];
  const tpls = templatesOf(p);
  for (const s of p.scenes) {
    const add = (events: ObjectEvent[], via: string): void => {
      for (const e of events) {
        for (const b of eachBlock([e])) {
          if (b.op === "goto" || b.op === "overlay") out.push({ from: s.id, to: b.scene, kind: b.op, via, trigger: e.trigger });
        }
      }
    };
    add(s.events ?? [], "scene");
    let leaves: FlatLeaf[] = [];
    try {
      leaves = flattenScene(p, s.id);
    } catch {
      leaves = [];
    }
    const seen = new Set<number>();
    for (const l of leaves) {
      const t = templateOfLeaf(tpls, l);
      if (!t || seen.has(t.k)) continue;
      seen.add(t.k);
      add(t.events, t.def ? t.def.id : l.id);
    }
  }
  return out;
}

/* ------------------------------------------------------------------
   Rewriting behaviour (renames, deletes): one walker over every
   event, action, condition and value in the project.
   ------------------------------------------------------------------ */

export interface BehaviourMap {
  block?: (b: Block) => Block | null;
  value?: (v: Value) => Value;
  cond?: (c: Cond) => Cond;
  event?: (e: ObjectEvent) => ObjectEvent | null;
}

export function mapValue(v: Value, m: BehaviourMap): Value {
  let out: Value = v;
  if (typeof v === "object") {
    if (v.k === "random") out = { ...v, max: mapValue(v.max, m) };
    else if (v.k === "math") out = { ...v, a: mapValue(v.a, m), b: mapValue(v.b, m) };
    else if (v.k === "call") out = { ...v, args: v.args.map((a) => mapValue(a, m)) };
  }
  return m.value ? m.value(out) : out;
}

export function mapCond(c: Cond, m: BehaviourMap): Cond {
  let out: Cond = c;
  if (c.k === "cmp") out = { ...c, a: mapValue(c.a, m), b: mapValue(c.b, m) };
  else if (c.k === "all" || c.k === "any") out = { ...c, of: c.of.map((x) => mapCond(x, m)) };
  else if (c.k === "not") out = { ...c, c: mapCond(c.c, m) };
  return m.cond ? m.cond(out) : out;
}

export function mapBlocks(blocks: Block[], m: BehaviourMap): Block[] {
  const out: Block[] = [];
  for (const b0 of blocks ?? []) {
    const V = (v: Value): Value => mapValue(v, m);
    let b: Block = b0;
    switch (b0.op) {
      case "move":
        b = { ...b0, dx: V(b0.dx), dy: V(b0.dy) };
        break;
      case "set_pos":
        b = { ...b0, x: V(b0.x), y: V(b0.y) };
        break;
      case "glide":
        b = { ...b0, x: V(b0.x), y: V(b0.y) };
        break;
      case "spawn":
        b = { ...b0, x: V(b0.x), y: V(b0.y) };
        break;
      case "sprite":
        b = b0.cell === undefined ? b0 : { ...b0, cell: V(b0.cell) };
        break;
      case "cell":
        b = { ...b0, cell: V(b0.cell) };
        break;
      case "text":
        b = b0.value === undefined ? b0 : { ...b0, value: V(b0.value) };
        break;
      case "wait":
        b = { ...b0, ticks: V(b0.ticks) };
        break;
      case "set":
        b = { ...b0, value: V(b0.value) };
        break;
      case "call":
        b = { ...b0, args: (b0.args ?? []).map(V) };
        break;
      case "jump":
        b = { ...b0, power: V(b0.power) };
        break;
      case "if":
        b = { ...b0, cond: mapCond(b0.cond, m), then: mapBlocks(b0.then ?? [], m), ...(b0.else ? { else: mapBlocks(b0.else, m) } : {}) };
        break;
      case "repeat":
        b = { ...b0, times: V(b0.times), body: mapBlocks(b0.body ?? [], m) };
        break;
    }
    const r = m.block ? m.block(b) : b;
    if (r) out.push(r);
  }
  return out;
}

function mapEvents(events: ObjectEvent[] | undefined, m: BehaviourMap): ObjectEvent[] | undefined {
  if (!events) return events;
  const out: ObjectEvent[] = [];
  for (const e of events) {
    const next = { ...e, blocks: mapBlocks(e.blocks, m) };
    const r = m.event ? m.event(next) : next;
    if (r) out.push(r);
  }
  return out;
}

export function mapBehaviour(p: Project, m: BehaviourMap): Project {
  return {
    ...p,
    objectDefs: p.objectDefs?.map((d) => ({ ...d, events: mapEvents(d.events, m) })),
    scenes: p.scenes.map((s) => ({
      ...s,
      ...(s.events ? { events: mapEvents(s.events, m) } : {}),
      nodes: s.nodes.map((n) => (n.events ? { ...n, events: mapEvents(n.events, m) } : n)),
    })),
  };
}

/** What a reference names: renames follow it everywhere, deletes are
    refused while something still uses it. */
export type RefKind = "var" | "sound" | "song" | "scene" | "sprite" | "def" | "input" | "message";

function refMap(kind: RefKind, from: string, to: string, hit: () => void): BehaviourMap {
  const sw = (x: string): string => {
    if (x !== from) return x;
    hit();
    return to;
  };
  const defT = (t: string | undefined): string | undefined => (t && t === `def:${from}` ? (hit(), `def:${to}`) : t);
  return {
    value: (v) => (kind === "var" && typeof v === "object" && v.k === "var" ? { ...v, name: sw(v.name) } : v),
    cond: (c) => (kind === "def" && c.k === "touching" ? { ...c, target: defT(c.target) ?? c.target } : c),
    block: (b) => {
      if (kind === "var" && b.op === "set" && (b.scope ?? "global") === "global") return { ...b, name: sw(b.name) };
      if (kind === "var" && b.op === "repeat" && b.index) return { ...b, index: sw(b.index) };
      if (kind === "sound" && b.op === "play") return { ...b, sound: sw(b.sound) };
      if (kind === "song" && b.op === "song") return { ...b, song: sw(b.song) };
      if (kind === "scene" && (b.op === "goto" || b.op === "overlay")) return { ...b, scene: sw(b.scene) };
      if (kind === "sprite" && b.op === "sprite") return { ...b, sprite: sw(b.sprite) };
      if (kind === "def" && b.op === "spawn") return { ...b, def: sw(b.def) };
      if (kind === "def" && b.op === "destroy") return { ...b, target: defT(b.target) };
      if (kind === "message" && b.op === "send") return { ...b, message: sw(b.message) };
      return b;
    },
    event: (e) => {
      if (kind === "input" && e.trigger === "key" && e.key) return { ...e, key: sw(e.key) };
      if (kind === "def" && e.trigger === "collide") return { ...e, target: defT(e.target) };
      if (kind === "message" && e.trigger === "message" && e.message) return { ...e, message: sw(e.message) };
      return e;
    },
  };
}

export function usesRef(p: Project, kind: RefKind, id: string): boolean {
  let used = false;
  mapBehaviour(p, refMap(kind, id, id, () => (used = true)));
  return used;
}

export function renameRef(p: Project, kind: RefKind, from: string, to: string): Project {
  return mapBehaviour(p, refMap(kind, from, to, () => {}));
}

/* ------------------------------------------------------------------
   Zero-page thrift. ETAL gives every fn local (loop counters, match
   temporaries) its own permanent zero-page byte(s); 256 is all there
   is, and user scripts need it more than the runtime does. This pass
   rewrites the ENGINE's generated lines (user code is fenced by the
   USER_CODE markers and left alone):
   - `for v in a..b {` → a RAM counter e_ix[k] (one per loop site —
     the same static semantics, zero zero-page)
   - `match x {` → an if/elif chain (no temporary)
   ------------------------------------------------------------------ */

export const USER_CODE_BEGIN = "( user code )";
export const USER_CODE_END = "( end user code )";

export function thrift(lines: string[]): { lines: string[]; counters: number } {
  let k = 0;
  const word = (v: string): RegExp => new RegExp(`\\b${v}\\b`, "g");
  const closeAt = (ls: string[], from: number, indent: string): number => {
    for (let j = from; j < ls.length; j++) if (ls[j] === `${indent}}`) return j;
    return -1;
  };
  const pass = (ls: string[]): string[] => {
    const out: string[] = [];
    let user = 0;
    for (let i = 0; i < ls.length; i++) {
      const line = ls[i];
      if (line.trim() === USER_CODE_BEGIN) user++;
      if (line.trim() === USER_CODE_END) user--;
      if (user > 0) {
        out.push(line);
        continue;
      }
      let m = line.match(/^(\s*)for (\w+) in (.+?)\.\.(.+) \{ (.*) \}$/);
      if (m) {
        const [, ind, v, a, b, body] = m;
        const c = `e_ix[${k++}]`;
        out.push(`${ind}${c} = ${a};`, `${ind}while ${c} < ${b} {`, `${ind}    ${body.replace(word(v), c)}`, `${ind}    ${c} = ${c} + 1;`, `${ind}}`);
        continue;
      }
      m = line.match(/^(\s*)for (\w+) in (.+?)\.\.(.+) \{$/);
      if (m) {
        const [, ind, v, a, b] = m;
        const end = closeAt(ls, i + 1, ind);
        if (end < 0) {
          out.push(line);
          continue;
        }
        const c = `e_ix[${k++}]`;
        const body = pass(ls.slice(i + 1, end).map((l) => l.replace(word(v), c)));
        out.push(`${ind}${c} = ${a};`, `${ind}while ${c} < ${b} {`, ...body, `${ind}    ${c} = ${c} + 1;`, `${ind}}`);
        i = end;
        continue;
      }
      m = line.match(/^(\s*)match (.+) \{$/);
      if (m) {
        const [, ind, expr] = m;
        const end = closeAt(ls, i + 1, ind);
        if (end < 0) {
          out.push(line);
          continue;
        }
        const arms: Array<{ key: string; body: string[] }> = [];
        for (let j = i + 1; j < end; j++) {
          const one = ls[j].match(/^\s*(\d+|_) => \{ (.*) \}$/);
          const many = ls[j].match(/^(\s*)(\d+|_) => \{$/);
          if (one) arms.push({ key: one[1], body: one[2].trim() ? [`${ind}    ${one[2]}`] : [] });
          else if (ls[j].match(/^\s*(\d+|_) => \{ \}$/)) arms.push({ key: ls[j].trim()[0] === "_" ? "_" : ls[j].trim().split(" ")[0], body: [] });
          else if (many) {
            const armEnd = closeAt(ls, j + 1, many[1]);
            arms.push({ key: many[2], body: ls.slice(j + 1, armEnd).map((l) => l.slice(4)) });
            j = armEnd;
          }
        }
        const keyed = arms.filter((a) => a.key !== "_");
        const dflt = arms.find((a) => a.key === "_");
        const hasDefault = !!dflt && dflt.body.length > 0;
        if (keyed.length === 0) {
          out.push(...pass(dflt?.body ?? []));
        } else {
          keyed.forEach((a, n) => {
            out.push(`${ind}${n === 0 ? "if" : "} elif"} ${expr} == ${a.key} {`, ...pass(a.body));
          });
          if (hasDefault) out.push(`${ind}} else {`, ...pass(dflt!.body));
          out.push(`${ind}}`);
        }
        i = end;
        continue;
      }
      out.push(line);
    }
    return out;
  };
  const result = pass(lines);
  return { lines: result, counters: k };
}
