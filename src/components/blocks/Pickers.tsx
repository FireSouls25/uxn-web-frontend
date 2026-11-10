import { useState } from "react";
import { useStore } from "@nanostores/react";
import { Plus, Volume2 } from "lucide-react";
import Popover, { Chip } from "./Popover";
import { LookThumb } from "../LookEditor";
import { testTone } from "../SoundMixer";
import { t, useLang } from "../../lib/i18n";
import { themeColors } from "../../lib/palette";
import { BUTTONS, cellCount, type ButtonName, type CmpOp, type Cond, type MathOp, type PropName, type Value } from "../../lib/project";
import { allEvents, eachBlock, scriptFunctions } from "../../lib/engine";
import { addInput, addSong, addSound, addVariable, projectStore, soundSelStore, songSelStore, viewStore } from "../../lib/store";
import { keyLabel } from "../../lib/keys";

/** What a slot may refer to, from where it sits. */
export interface PickCtx {
  /** This object's template variables (empty for inline objects/scenes). */
  myVars: string[];
  /** Every template variable name (for "other's …"). */
  allMyVars: string[];
  /** In a collision event: "other" exists. */
  other: boolean;
  /** Scene event: no "this object". */
  scene: boolean;
  locked: boolean;
}

const row = "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] text-subtext0 transition-colors hover:bg-surface0 hover:text-text";
const head = "mt-2 mb-0.5 px-1 font-mono text-[10px] uppercase tracking-widest text-overlay0";

/* ---------------- values ---------------- */

export function valueLabel(v: Value, lang: ReturnType<typeof useLang>): string {
  if (typeof v === "number") return String(v);
  switch (v.k) {
    case "var":
      return v.name;
    case "my":
      return (v.of ?? "self") === "other" ? `${t(lang, "blk.other_s")} ${v.name}` : `${t(lang, "blk.my")} ${v.name}`;
    case "prop":
      return (v.of ?? "self") === "other" ? `${t(lang, "blk.other_s")} ${t(lang, `blk.prop_${v.prop}`)}` : t(lang, `blk.prop_${v.prop}`);
    case "mouse":
      return `${t(lang, "blk.mouse")} ${v.axis}`;
    case "random":
      return `${t(lang, "blk.random")} < ${valueLabel(v.max, lang)}`;
    case "math":
      return `(${valueLabel(v.a, lang)} ${v.op} ${valueLabel(v.b, lang)})`;
    case "call":
      return `${v.fn}(${v.args.map((a) => valueLabel(a, lang)).join(", ")})`;
  }
  return "?";
}

export function ValueChip({ value, onChange, ctx, signed = false }: { value: Value; onChange: (v: Value) => void; ctx: PickCtx; signed?: boolean }) {
  const lang = useLang();
  const project = useStore(projectStore);
  const [num, setNum] = useState(typeof value === "number" ? String(value) : "0");
  const fns = scriptFunctions(project).filter((f) => f.ret);
  const props: PropName[] = ["x", "y", "cell", "w", "h"];
  return (
    <Popover
      width={300}
      title={t(lang, "blk.value")}
      trigger={(open) => (
        <Chip tone="value" open={open} disabled={ctx.locked}>
          {valueLabel(value, lang)}
        </Chip>
      )}
    >
      {(close) => (
        <div>
          {typeof value === "object" && (value.k === "random" || value.k === "math" || value.k === "call") && (
            <div className="mb-2 flex flex-wrap items-center gap-1 rounded-lg border border-surface0 p-2">
              {value.k === "random" && (
                <>
                  <span>{t(lang, "blk.random_below")}</span>
                  <ValueChip value={value.max} ctx={ctx} onChange={(max) => onChange({ ...value, max })} />
                </>
              )}
              {value.k === "math" && (
                <>
                  <ValueChip value={value.a} ctx={ctx} signed={signed} onChange={(a) => onChange({ ...value, a })} />
                  <select className="select w-14" value={value.op} onChange={(e) => onChange({ ...value, op: e.target.value as MathOp })}>
                    {(["+", "-", "*", "/", "%"] as MathOp[]).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                  <ValueChip value={value.b} ctx={ctx} onChange={(b) => onChange({ ...value, b })} />
                </>
              )}
              {value.k === "call" && (
                <>
                  <span className="font-mono">{value.fn}(</span>
                  {value.args.map((a, i) => (
                    <ValueChip key={i} value={a} ctx={ctx} onChange={(x) => onChange({ ...value, args: value.args.map((y, j) => (j === i ? x : y)) })} />
                  ))}
                  <span className="font-mono">)</span>
                </>
              )}
            </div>
          )}
          <p className={head}>{t(lang, "blk.number")}</p>
          <form
            className="flex gap-1 px-1"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Math.round(Number(num));
              if (!Number.isNaN(n)) {
                onChange(Math.max(signed ? -65535 : 0, Math.min(65535, n)));
                close();
              }
            }}
          >
            <input autoFocus type="number" value={num} min={signed ? -65535 : 0} max={65535} onChange={(e) => setNum(e.target.value)} className="w-24 rounded-md border border-surface1 bg-base px-2 py-1 font-mono text-[12px] outline-none focus:border-mauve" />
            <button type="submit" className="seg-active rounded-md px-2 font-mono text-[11px]">
              OK
            </button>
          </form>
          <p className={head}>{t(lang, "blk.game_vars")}</p>
          {(project.vars ?? []).map((v) => (
            <button key={v.id} className={row} onClick={() => (onChange({ k: "var", name: v.id }), close())}>
              {v.id}
            </button>
          ))}
          <button
            className={row}
            onClick={() => {
              const name = window.prompt(t(lang, "blk.new_var_name"), "score");
              if (name) {
                onChange({ k: "var", name: addVariable(name) });
                close();
              }
            }}
          >
            <Plus size={12} /> {t(lang, "blk.new_var")}
          </button>
          {!ctx.scene && ctx.myVars.length > 0 && (
            <>
              <p className={head}>{t(lang, "blk.my_vars")}</p>
              {ctx.myVars.map((n) => (
                <button key={n} className={row} onClick={() => (onChange({ k: "my", name: n }), close())}>
                  {t(lang, "blk.my")} {n}
                </button>
              ))}
            </>
          )}
          {ctx.other && ctx.allMyVars.length > 0 && (
            <>
              <p className={head}>{t(lang, "blk.other_vars")}</p>
              {ctx.allMyVars.map((n) => (
                <button key={n} className={row} onClick={() => (onChange({ k: "my", name: n, of: "other" }), close())}>
                  {t(lang, "blk.other_s")} {n}
                </button>
              ))}
            </>
          )}
          {!ctx.scene && (
            <>
              <p className={head}>{t(lang, "blk.props")}</p>
              <div className="flex flex-wrap gap-1 px-1">
                {props.map((pr) => (
                  <button key={pr} className="rounded-md border border-surface0 px-1.5 py-0.5 hover:border-mauve" onClick={() => (onChange({ k: "prop", prop: pr }), close())}>
                    {t(lang, `blk.prop_${pr}`)}
                  </button>
                ))}
                {ctx.other &&
                  props.map((pr) => (
                    <button key={`o${pr}`} className="rounded-md border border-surface0 px-1.5 py-0.5 hover:border-mauve" onClick={() => (onChange({ k: "prop", prop: pr, of: "other" }), close())}>
                      {t(lang, "blk.other_s")} {t(lang, `blk.prop_${pr}`)}
                    </button>
                  ))}
              </div>
            </>
          )}
          <p className={head}>{t(lang, "blk.computed")}</p>
          <div className="flex flex-wrap gap-1 px-1">
            <button className="rounded-md border border-surface0 px-1.5 py-0.5 hover:border-mauve" onClick={() => onChange({ k: "mouse", axis: "x" })}>
              {t(lang, "blk.mouse")} x
            </button>
            <button className="rounded-md border border-surface0 px-1.5 py-0.5 hover:border-mauve" onClick={() => onChange({ k: "mouse", axis: "y" })}>
              {t(lang, "blk.mouse")} y
            </button>
            <button className="rounded-md border border-surface0 px-1.5 py-0.5 hover:border-mauve" onClick={() => onChange({ k: "random", max: 10 })}>
              {t(lang, "blk.random")}
            </button>
            <button className="rounded-md border border-surface0 px-1.5 py-0.5 hover:border-mauve" onClick={() => onChange({ k: "math", op: "+", a: value, b: 1 })}>
              {t(lang, "blk.math")}
            </button>
          </div>
          {fns.length > 0 && (
            <>
              <p className={head}>{t(lang, "blk.functions")}</p>
              {fns.map((f) => (
                <button key={f.name} className={row} onClick={() => onChange({ k: "call", fn: f.name, args: f.params.map(() => 0) })}>
                  <span className="font-mono">
                    {f.name}({f.params.map((x) => x.name).join(", ")})
                  </span>
                  <span className="ml-auto text-[10px] text-overlay0">{f.file}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </Popover>
  );
}

/* ---------------- conditions ---------------- */

const CMP_LABEL: Record<CmpOp, string> = { eq: "=", neq: "≠", lt: "<", lte: "≤", gt: ">", gte: "≥" };

export function condLabel(c: Cond, lang: ReturnType<typeof useLang>): string {
  switch (c.k) {
    case "cmp":
      return `${valueLabel(c.a, lang)} ${CMP_LABEL[c.op]} ${valueLabel(c.b, lang)}`;
    case "held":
      return `${t(lang, "blk.held")} ${t(lang, `btn.${c.button}`)}`;
    case "touching":
      return `${t(lang, "blk.touching")} ${targetLabel(c.target, lang)}`;
    case "mouse_over":
      return t(lang, "blk.mouse_over");
    case "mouse_down":
      return t(lang, "blk.mouse_down");
    case "all":
      return c.of.map((x) => condLabel(x, lang)).join(` ${t(lang, "blk.and")} `);
    case "any":
      return c.of.map((x) => condLabel(x, lang)).join(` ${t(lang, "blk.or")} `);
    case "not":
      return `${t(lang, "blk.not")} (${condLabel(c.c, lang)})`;
  }
  return "?";
}

export function CondChip({ cond, onChange, ctx }: { cond: Cond; onChange: (c: Cond) => void; ctx: PickCtx }) {
  const lang = useLang();
  const project = useStore(projectStore);
  const kinds: Array<[Cond["k"], () => Cond]> = [
    ["cmp", () => ({ k: "cmp", a: (project.vars ?? [])[0] ? { k: "var", name: (project.vars ?? [])[0].id } : 0, op: "eq", b: 0 })],
    ["held", () => ({ k: "held", button: "right" })],
    ...(ctx.scene ? [] : ([["touching", () => ({ k: "touching", target: "any" })], ["mouse_over", () => ({ k: "mouse_over" })]] as Array<[Cond["k"], () => Cond]>)),
    ["mouse_down", () => ({ k: "mouse_down" })],
    ["all", () => ({ k: "all", of: [cond] })],
    ["any", () => ({ k: "any", of: [cond] })],
    ["not", () => ({ k: "not", c: cond })],
  ];
  return (
    <Popover
      width={330}
      title={t(lang, "blk.condition")}
      trigger={(open) => (
        <Chip tone="value" open={open} disabled={ctx.locked}>
          {condLabel(cond, lang)}
        </Chip>
      )}
    >
      {() => (
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-1 rounded-lg border border-surface0 p-2">
            {cond.k === "cmp" && (
              <>
                <ValueChip value={cond.a} ctx={ctx} onChange={(a) => onChange({ ...cond, a })} />
                <select className="select w-14" value={cond.op} onChange={(e) => onChange({ ...cond, op: e.target.value as CmpOp })}>
                  {(Object.keys(CMP_LABEL) as CmpOp[]).map((o) => (
                    <option key={o} value={o}>
                      {CMP_LABEL[o]}
                    </option>
                  ))}
                </select>
                <ValueChip value={cond.b} ctx={ctx} onChange={(b) => onChange({ ...cond, b })} />
              </>
            )}
            {cond.k === "held" && (
              <>
                <span>{t(lang, "blk.held")}</span>
                <ButtonSelect value={cond.button} onChange={(button) => onChange({ ...cond, button })} />
              </>
            )}
            {cond.k === "touching" && (
              <>
                <span>{t(lang, "blk.touching")}</span>
                <TargetChip value={cond.target} onChange={(target) => onChange({ ...cond, target })} ctx={ctx} />
              </>
            )}
            {(cond.k === "mouse_over" || cond.k === "mouse_down") && <span>{condLabel(cond, lang)}</span>}
            {(cond.k === "all" || cond.k === "any") && (
              <div className="flex w-full flex-col gap-1">
                {cond.of.map((c, i) => (
                  <div key={i} className="flex items-center gap-1">
                    {i > 0 && <span className="text-overlay0">{t(lang, cond.k === "all" ? "blk.and" : "blk.or")}</span>}
                    <CondChip cond={c} ctx={ctx} onChange={(x) => onChange({ ...cond, of: cond.of.map((y, j) => (j === i ? x : y)) })} />
                    {cond.of.length > 1 && (
                      <button className="ml-auto text-overlay0 hover:text-red" onClick={() => onChange({ ...cond, of: cond.of.filter((_, j) => j !== i) })}>
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                <button className={row} onClick={() => onChange({ ...cond, of: [...cond.of, { k: "mouse_down" }] })}>
                  <Plus size={12} /> {t(lang, "blk.add_test")}
                </button>
              </div>
            )}
            {cond.k === "not" && (
              <>
                <span>{t(lang, "blk.not")}</span>
                <CondChip cond={cond.c} ctx={ctx} onChange={(c) => onChange({ ...cond, c })} />
              </>
            )}
          </div>
          <p className={head}>{t(lang, "blk.change_test")}</p>
          {kinds.map(([k, make]) => (
            <button key={k} className={`${row} ${cond.k === k ? "text-text" : ""}`} onClick={() => onChange(make())}>
              {t(lang, `blk.cond_${k}`)}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

export function ButtonSelect({ value, onChange }: { value: ButtonName; onChange: (b: ButtonName) => void }) {
  const lang = useLang();
  return (
    <select className="select w-28" value={value} onChange={(e) => onChange(e.target.value as ButtonName)}>
      {(Object.keys(BUTTONS) as ButtonName[]).map((b) => (
        <option key={b} value={b}>
          {t(lang, `btn.${b}`)}
        </option>
      ))}
    </select>
  );
}

/* ---------------- targets (collide / touching / destroy) ---------------- */

export function targetLabel(target: string, lang: ReturnType<typeof useLang>): string {
  if (target.startsWith("def:")) return target.slice(4);
  return t(lang, `blk.target_${target}`);
}

export function TargetChip({ value, onChange, ctx, destroy = false }: { value: string; onChange: (t: string) => void; ctx: PickCtx; destroy?: boolean }) {
  const lang = useLang();
  const project = useStore(projectStore);
  const opts = destroy ? [...(ctx.scene ? [] : ["self"]), ...(ctx.other ? ["other"] : [])] : ["any", "solid", "player", "movable"];
  return (
    <Popover
      width={240}
      title={t(lang, "blk.who")}
      trigger={(open) => (
        <Chip tone="asset" open={open} disabled={ctx.locked}>
          {targetLabel(value, lang)}
        </Chip>
      )}
    >
      {(close) => (
        <div>
          {opts.map((o) => (
            <button key={o} className={row} onClick={() => (onChange(o), close())}>
              {t(lang, `blk.target_${o}`)}
            </button>
          ))}
          <p className={head}>{destroy ? t(lang, "blk.every_of") : t(lang, "blk.templates")}</p>
          {(project.objectDefs ?? []).map((d) => (
            <button key={d.id} className={row} onClick={() => (onChange(`def:${d.id}`), close())}>
              <span className="w-5">{d.sprite ? <SpriteMini id={d.sprite} /> : "T"}</span>
              {d.id}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

/* ---------------- assets ---------------- */

export function SpriteMini({ id, cell = 0, size = 18 }: { id: string; cell?: number; size?: number }) {
  const project = useStore(projectStore);
  const s = project.sprites.find((x) => x.id === id);
  const pal = themeColors(project.theme);
  if (!s) return <span className="text-red">?</span>;
  return (
    <span className="inline-block shrink-0" style={{ width: size }}>
      <LookThumb sprite={s} look={{ cell }} pal={pal} bg={pal[project.bg ?? 0]} />
    </span>
  );
}

export function SpriteChip({ sprite, cell, onChange, locked }: { sprite: string; cell?: number; onChange: (sprite: string, cell?: number) => void; locked: boolean }) {
  const lang = useLang();
  const project = useStore(projectStore);
  const [q, setQ] = useState("");
  return (
    <Popover
      width={320}
      title={t(lang, "blk.pick_sprite")}
      trigger={(open) => (
        <Chip tone="asset" open={open} disabled={locked}>
          <SpriteMini id={sprite} cell={cell ?? 0} size={14} /> {sprite}
          {cell ? ` #${cell}` : ""}
        </Chip>
      )}
    >
      {(close) => (
        <div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t(lang, "blk.search")} className="mb-2 w-full rounded-md border border-surface1 bg-base px-2 py-1 outline-none focus:border-mauve" />
          <div className="grid grid-cols-4 gap-1.5">
            {project.sprites
              .filter((s) => s.id.includes(q.toLowerCase()))
              .flatMap((s) =>
                Array.from({ length: cellCount(s) }, (_, c) => (
                  <button
                    key={`${s.id}/${c}`}
                    title={cellCount(s) > 1 ? `${s.id} #${c}` : s.id}
                    onClick={() => (onChange(s.id, cellCount(s) > 1 ? c : undefined), close())}
                    className={`rounded-md border p-1 ${s.id === sprite && (cell ?? 0) === c ? "border-mauve" : "border-surface0 hover:border-mauve/50"}`}
                  >
                    <SpriteMini id={s.id} cell={c} size={52} />
                    <span className="mt-0.5 block truncate text-center text-[9px] text-overlay0">{cellCount(s) > 1 ? `${s.id} #${c}` : s.id}</span>
                  </button>
                )),
              )}
          </div>
          <button className={`${row} mt-2`} onClick={() => (viewStore.set("sprites"), close())}>
            {t(lang, "blk.open_sprites")}
          </button>
        </div>
      )}
    </Popover>
  );
}

export function SoundChip({ sound, onChange, locked }: { sound: string; onChange: (id: string) => void; locked: boolean }) {
  const lang = useLang();
  const project = useStore(projectStore);
  const known = (project.sounds ?? []).some((s) => s.id === sound);
  const play = (id: string): void => {
    const v = (project.sounds ?? []).find((s) => s.id === id)?.voices.find((x) => x.vol > 0);
    if (v) testTone(v.note);
  };
  return (
    <Popover
      width={260}
      title={t(lang, "blk.pick_sound")}
      trigger={(open) => (
        <Chip tone={known ? "asset" : "warn"} open={open} disabled={locked}>
          <Volume2 size={11} /> {sound || t(lang, "blk.none")}
        </Chip>
      )}
    >
      {(close) => (
        <div>
          {(project.sounds ?? []).map((s) => (
            <div key={s.id} className="flex items-center gap-1">
              <button
                className="grid size-6 place-items-center rounded-md text-subtext0 hover:bg-surface0 hover:text-text"
                title={t(lang, "sound.test")}
                onClick={() => play(s.id)}
              >
                ▶
              </button>
              <button className={`${row} ${s.id === sound ? "text-text" : ""}`} onClick={() => (onChange(s.id), close())}>
                {s.id}
              </button>
            </div>
          ))}
          <button
            className={row}
            onClick={() => {
              const name = window.prompt(t(lang, "blk.new_sound_name"), "blip");
              if (!name) return;
              const id = addSound(name);
              onChange(id);
              close();
            }}
          >
            <Plus size={12} /> {t(lang, "blk.new_sound")}
          </button>
          {known && (
            <button className={row} onClick={() => (soundSelStore.set(sound), viewStore.set("sound"), close())}>
              {t(lang, "blk.edit_sound")}
            </button>
          )}
        </div>
      )}
    </Popover>
  );
}

export function SongChip({ song, onChange, locked }: { song: string; onChange: (id: string) => void; locked: boolean }) {
  const lang = useLang();
  const project = useStore(projectStore);
  const known = (project.songs ?? []).some((s) => s.id === song);
  return (
    <Popover
      width={240}
      title={t(lang, "blk.pick_song")}
      trigger={(open) => (
        <Chip tone={known ? "asset" : "warn"} open={open} disabled={locked}>
          ♫ {song || t(lang, "blk.none")}
        </Chip>
      )}
    >
      {(close) => (
        <div>
          {(project.songs ?? []).map((s) => (
            <button key={s.id} className={`${row} ${s.id === song ? "text-text" : ""}`} onClick={() => (onChange(s.id), close())}>
              {s.id}
            </button>
          ))}
          <button
            className={row}
            onClick={() => {
              const name = window.prompt(t(lang, "blk.new_song_name"), "theme");
              if (!name) return;
              onChange(addSong(name));
              close();
            }}
          >
            <Plus size={12} /> {t(lang, "blk.new_song")}
          </button>
          {known && (
            <button className={row} onClick={() => (songSelStore.set(song), viewStore.set("sound"), close())}>
              {t(lang, "blk.edit_song")}
            </button>
          )}
        </div>
      )}
    </Popover>
  );
}

export function SceneChip({ scene, onChange, locked }: { scene: string; onChange: (id: string) => void; locked: boolean }) {
  const lang = useLang();
  const project = useStore(projectStore);
  const known = project.scenes.some((s) => s.id === scene);
  return (
    <Popover
      width={220}
      title={t(lang, "blk.pick_scene")}
      trigger={(open) => (
        <Chip tone={known ? "asset" : "warn"} open={open} disabled={locked}>
          ▣ {scene}
        </Chip>
      )}
    >
      {(close) => (
        <div>
          {project.scenes.map((s) => (
            <button key={s.id} className={`${row} ${s.id === scene ? "text-text" : ""}`} onClick={() => (onChange(s.id), close())}>
              {s.id}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

export function DefChip({ def, onChange, locked }: { def: string; onChange: (id: string) => void; locked: boolean }) {
  const lang = useLang();
  const project = useStore(projectStore);
  const d = (project.objectDefs ?? []).find((x) => x.id === def);
  return (
    <Popover
      width={240}
      title={t(lang, "blk.pick_template")}
      trigger={(open) => (
        <Chip tone={d ? "asset" : "warn"} open={open} disabled={locked}>
          {d?.sprite ? <SpriteMini id={d.sprite} cell={d.cell ?? 0} size={14} /> : null} {def || t(lang, "blk.none")}
        </Chip>
      )}
    >
      {(close) => (
        <div>
          {(project.objectDefs ?? []).length === 0 && <p className="px-1 text-overlay0">{t(lang, "blk.no_templates")}</p>}
          {(project.objectDefs ?? []).map((x) => (
            <button key={x.id} className={row} onClick={() => (onChange(x.id), close())}>
              <span className="w-5">{x.sprite ? <SpriteMini id={x.sprite} cell={x.cell ?? 0} /> : "T"}</span>
              {x.id}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

/** Messages already used anywhere (sent or listened for). */
export function knownMessages(p: ReturnType<typeof projectStore.get>): string[] {
  const set = new Set<string>();
  for (const e of allEvents(p)) if (e.trigger === "message" && e.message) set.add(e.message);
  for (const b of eachBlock(allEvents(p))) if (b.op === "send") set.add(b.message);
  return [...set].sort();
}

export function MessageChip({ message, onChange, locked }: { message: string; onChange: (m: string) => void; locked: boolean }) {
  const lang = useLang();
  const project = useStore(projectStore);
  return (
    <Popover
      width={220}
      title={t(lang, "blk.pick_message")}
      trigger={(open) => (
        <Chip tone="asset" open={open} disabled={locked}>
          ✉ {message}
        </Chip>
      )}
    >
      {(close) => (
        <div>
          {knownMessages(project).map((m) => (
            <button key={m} className={row} onClick={() => (onChange(m), close())}>
              {m}
            </button>
          ))}
          <button
            className={row}
            onClick={() => {
              const name = window.prompt(t(lang, "blk.new_message_name"), "go")?.trim().replace(/[^A-Za-z0-9_]/g, "_");
              if (name && /^[A-Za-z]/.test(name)) {
                onChange(name);
                close();
              }
            }}
          >
            <Plus size={12} /> {t(lang, "blk.new_message")}
          </button>
        </div>
      )}
    </Popover>
  );
}

export function VarChip({ name, onChange, locked, mine }: { name: string; onChange: (name: string, scope: "global" | "self" | "other") => void; locked: boolean; mine?: { self: string[]; other: string[] } }) {
  const lang = useLang();
  const project = useStore(projectStore);
  return (
    <Popover
      width={240}
      title={t(lang, "blk.pick_var")}
      trigger={(open) => (
        <Chip tone="value" open={open} disabled={locked}>
          {name || t(lang, "blk.none")}
        </Chip>
      )}
    >
      {(close) => (
        <div>
          <p className={head}>{t(lang, "blk.game_vars")}</p>
          {(project.vars ?? []).map((v) => (
            <button key={v.id} className={row} onClick={() => (onChange(v.id, "global"), close())}>
              {v.id}
            </button>
          ))}
          <button
            className={row}
            onClick={() => {
              const n = window.prompt(t(lang, "blk.new_var_name"), "score");
              if (n) {
                onChange(addVariable(n), "global");
                close();
              }
            }}
          >
            <Plus size={12} /> {t(lang, "blk.new_var")}
          </button>
          {mine && mine.self.length > 0 && (
            <>
              <p className={head}>{t(lang, "blk.my_vars")}</p>
              {mine.self.map((v) => (
                <button key={v} className={row} onClick={() => (onChange(v, "self"), close())}>
                  {t(lang, "blk.my")} {v}
                </button>
              ))}
            </>
          )}
          {mine && mine.other.length > 0 && (
            <>
              <p className={head}>{t(lang, "blk.other_vars")}</p>
              {mine.other.map((v) => (
                <button key={v} className={row} onClick={() => (onChange(v, "other"), close())}>
                  {t(lang, "blk.other_s")} {v}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </Popover>
  );
}

/** Keyboard key (named input) or controller button for key events. */
export function KeyChip({ input, button, onChange, locked }: { input?: string; button?: string; onChange: (p: { key?: string; button?: ButtonName }) => void; locked: boolean }) {
  const lang = useLang();
  const project = useStore(projectStore);
  const [listening, setListening] = useState(false);
  const inp = (project.inputs ?? []).find((i) => i.id === input);
  const label = button ? t(lang, `btn.${button}`) : inp ? `${inp.id} (${keyLabel(inp.key, (k) => t(lang, k))})` : t(lang, "blk.none");
  return (
    <Popover
      width={260}
      title={t(lang, "blk.pick_key")}
      trigger={(open) => (
        <Chip tone={button || inp ? "asset" : "warn"} open={open} disabled={locked}>
          ⌨ {label}
        </Chip>
      )}
    >
      {(close) => (
        <div
          onKeyDown={(e) => {
            if (!listening) return;
            e.preventDefault();
            const code = e.key.length === 1 ? e.key.charCodeAt(0) : e.key === "Enter" ? 13 : e.key === "Escape" ? 27 : e.key === "Backspace" ? 8 : e.key === "Tab" ? 9 : 0;
            if (code > 0) {
              onChange({ key: addInput(code, e.key.length === 1 ? (e.key === " " ? "space" : e.key) : e.key.toLowerCase()) });
              setListening(false);
              close();
            }
          }}
        >
          <button autoFocus className={`${row} ${listening ? "seg-active" : ""}`} onClick={() => setListening(true)}>
            {listening ? t(lang, "blk.press_key") : t(lang, "blk.record_key")}
          </button>
          <p className={head}>{t(lang, "blk.keys")}</p>
          {(project.inputs ?? []).map((i) => (
            <button key={i.id} className={row} onClick={() => (onChange({ key: i.id }), close())}>
              {i.id} <span className="ml-auto text-overlay0">{keyLabel(i.key, (k) => t(lang, k))}</span>
            </button>
          ))}
          <p className={head}>{t(lang, "blk.buttons")}</p>
          <div className="flex flex-wrap gap-1 px-1">
            {(Object.keys(BUTTONS) as ButtonName[]).map((b) => (
              <button key={b} className="rounded-md border border-surface0 px-1.5 py-0.5 hover:border-mauve" onClick={() => (onChange({ button: b }), close())}>
                {t(lang, `btn.${b}`)}
              </button>
            ))}
          </div>
        </div>
      )}
    </Popover>
  );
}

/** Script function picker for the "run function" action. */
export function FnChip({ fn, onChange, locked }: { fn: string; onChange: (name: string, arity: number) => void; locked: boolean }) {
  const lang = useLang();
  const project = useStore(projectStore);
  const fns = scriptFunctions(project);
  return (
    <Popover
      width={300}
      title={t(lang, "blk.pick_fn")}
      trigger={(open) => (
        <Chip tone={fns.some((f) => f.name === fn) ? "asset" : "warn"} open={open} disabled={locked}>
          ƒ {fn || t(lang, "blk.none")}
        </Chip>
      )}
    >
      {(close) => (
        <div>
          {fns.length === 0 && <p className="px-1 text-overlay0">{t(lang, "blk.no_fns")}</p>}
          {fns.map((f) => (
            <button key={f.name} className={row} onClick={() => (onChange(f.name, f.params.length), close())}>
              <span className="font-mono">
                {f.name}({f.params.map((x) => x.name).join(", ")})
              </span>
              <span className="ml-auto text-[10px] text-overlay0">{f.file}</span>
            </button>
          ))}
          <button className={row} onClick={() => (viewStore.set("code"), close())}>
            {t(lang, "blk.open_code")}
          </button>
        </div>
      )}
    </Popover>
  );
}
