# Engine plan: from scene painter to real engine

Status: **Phases 0–2 done** (friction fixes + multi-tile sprites +
object templates + events/blocks). Phase 3+ is still plan only. Each
phase lists the model change, the emitter change, the UI change, and
the docs/tests that move with it. Phases are ordered so every one
ships something usable on its own.

## 1. Where we are

### 1.1 Our model today (`src/lib/project.ts` + `src/lib/store.ts`)

| Piece | What it is | Limit |
|---|---|---|
| Scenes | Godot-like tree: sprite leaves + subscene branches, cycle-guarded, depth ≤ 8 | nesting only, no reuse-with-overrides |
| Leaves | sprite id + x/y + kind (`player` ≤ 1/scene, `static`, `movable`⇒solid) + `solid` + `controls` + `anim` + `tick` ETAL | **no sprite picker anywhere**: creation hard-codes `sprites[0]` (`HierarchyPanel.tsx:85`); inspector cannot change the sprite |
| Bindings | scene-level `click object → goto`, `key code → goto` | the *only* events; raw key codes, scene-switch only |
| Scripts | per-leaf `tick` textarea + per-scene `frameCode`, raw ETAL | text only, no visual path, no per-event structure |
| Sprites | shared 8×8 2bpp library, 4 palette indices | fixed size; anims are id lists + rate + loop |
| Sound | 4 voices, note+vol, **boot jingle only** | nothing can trigger a sound after boot |
| Canvas | single-scene WYSIWYG, click-select, drag-move, size presets | no layers, no multi-select, no place/paint mode, no snap toggle |
| Events view | `EventsGraph`: a *list* of transition edges + `TransitionEditor` form | not a map; no per-object anything |
| Export | validate → emit ETAL → `POST /compile` → artifact | solid; unchanged by this plan |

Strengths to keep: deterministic lowering, validation gating every
mutation, one store + tool manifest shared by UI and agent
(`src/lib/agent/tools.ts`, 19 tools), bilingual UI, locked-example
read-only mode.

### 1.2 What Godot does (borrow the patterns, not the engine)

Researched against `docs.godotengine.org` (4.x, Oct 2026). Relevant patterns:

* **Left tree / right inspector / bottom drawer / center canvas**, mode
  switcher on top, scene tabs. Proven; we already look like this.
* **Create-node fuzzy dialog + drag-file-into-slot** (compatible slots
  highlight). Our equivalent: sprite picker + drag-sprite-onto-canvas.
* **Instance vs Inherited Variant + revert arrows + Make Unique.**
  Our nested scenes are composition already; what we lack is the
  template/instance split and override affordances.
* **Node → Signals tab → double-click → pick receiver → auto-stub.**
  Best-in-class event wiring; our per-object events should feel like
  this once they exist.
* **`@export` widget hints** (range/slider/enum/file/button). Cheap way
  to make our inspector feel pro.
* **Input Map**: named actions abstract keys/pads. We have raw key
  codes; named inputs are a prerequisite for readable visual blocks.
* **Audio buses by name + mixer drawer.** Out of Uxn scope; steal only
  the *idea* (sounds as named assets triggered by name).
* **UID+path refs + dependents dialog.** Relevant when our asset
  browser allows renames.
* Godot 4 **removed** built-in visual scripting (0.5% usage) — but
  GameMaker proves blocks work *when they are a projection of the
  code*, not a separate language. We follow GameMaker here, not Godot.

### 1.3 What GameMaker does (the model to copy)

Researched against `manual.gamemaker.io` (GMS2/LTS, Oct 2026). The core loop:

* **Asset Browser** (right dock): Sprites, Objects, Rooms, Sounds,
  Scripts… with groups, tags, search, `Ctrl+T` go-to-everything.
* **Object ≠ Sprite ≠ Instance.** Sprite = pixels. Object = behavior
  template (sprite pointer + flags + **Events list**). Instance = live
  placement with overrides + Creation Code. *This distinction is the
  whole engine.*
* **Object Events**: Create, Step (Begin/Step/End), Draw, Key
  Press/Down/Release (key *picker*, not codes), Collision (pick other
  object), Alarm (12 timers), Mouse, Gestures, Other (Room Start, User
  Events…), Async. Events are *moments in the loop* — the user never
  writes a main loop. Emission order documented per event.
* **DnD/GML Visual**: vertical action stack per event, searchable
  toolbox (~27 libraries), `If` forks right, `Applies To` scope per
  block, fields accept code with autocomplete. **Every block is a
  projection of GML: Live Preview shows the code, Convert-to-GML is
  one-way, Execute-Code blocks mix hand code inline.** This is exactly
  how our blocks must relate to ETAL.
* **Room editor**: drag object from browser → stamp (`Alt+LMB` paints
  multiples, `Ctrl` unsnaps), layers (instances/tiles/assets/…),
  per-instance overrides in inspector, Creation Code runs after Create
  Event, multi-select bulk edit, room inheritance.
* **Inspector**: selection-driven, `Open Editor` escalation, `-` for
  divergent multi-select values, lockable multiples.
* **Sounds**: assets with volume/gain, `Play Audio` action, audio
  groups. Triggered *from events*, not only at boot.
* **Sequences**: drag assets to canvas → auto-track + Record keys for
  cutscenes without code. (Out of scope for us — note in §4.)
* **Zero-to-running**: new project already has a room; sprite →
  object → drag into room → Play. One click, minutes.

### 1.4 Gap analysis: ours vs that

| Capability | GameMaker | Godot | Ours |
|---|---|---|---|
| Sprite/object/instance split | yes (template + placements) | scenes as types + instancing | **no** — leaves are one-off placements |
| Sprite picker on create/edit | picker dialog | drag into slot | **no** — `sprites[0]`, unchangeable |
| Per-object events | 10+ categories | signals + callbacks | **no** — only scene click/key→goto |
| Visual scripting ⇄ code | DnD ⇄ GML 1:1 | removed in 4.x | **no** — raw ETAL textareas |
| Event-triggered sound | Play Audio action | `stream.play()` | **no** — boot jingle only |
| Named inputs | key picker per event | Input Map | **no** — raw codes |
| Collision events | Collision + mask editor | shapes + signals | flags only, no events |
| Asset browser | full, tags/search | FileSystem + UID | sprite list only |
| Scene overview map | room order + inheritance | scene tabs | edge *list*, not a map |
| Instance overrides | inspector + Creation Code | revert arrows | nested = read-only + edit-home jump (good start) |
| In-editor preview | Play Animations, F5 | F5/F6, Game view | export-and-open only |

Uxn constraints that stay (they're the point): 8×8 sprites, 4 palette
indices, ≤128 objects, 4 square-wave voices, no physics engine, no
native text. The plan works *within* these — events and blocks lower
to the same ETAL the emitter already produces.

## 2. Target model (where we're going)

```
// New library (project.ts)
interface ObjectDef {
  id: string;                 // obj_player — the template
  sprite: string;             // default sprite (picker!)
  kind: ObjectKind;           // player/static/movable
  solid: boolean;
  controls: boolean;
  anim?: string;
  events: ObjectEvent[];      // <-- the engine part
}
interface ObjectEvent {
  id: string;
  trigger: EventTrigger;      // create | step | destroy | key | collide | click | alarm
  key?: NamedInput | number;  // migrated to named inputs (§3.1)
  target?: string;            // collide: other def id or kind
  alarm?: number;             // alarm: slot 0-7
  blocks: Block[];            // visual actions…
  code?: string;              // …or raw ETAL (Execute-Code hatch)
}
type Block =
  | { op: "move"; dx: number; dy: number }
  | { op: "set_pos"; x: number; y: number }
  | { op: "play"; voice: NamedVoice }   // event-triggered SFX
  | { op: "goto"; scene: string }
  | { op: "destroy"; target?: string }  // self default
  | { op: "if"; cond: Cond; then: Block[]; else?: Block[] }
  | { op: "wait"; ticks: number }       // alarm-backed
  | { op: "set"; name: string; value: string }; // ETAL expr

// SceneNode gains one optional field; everything else keeps working:
interface SceneNode {
  ...; def?: string;          // instance of ObjectDef; local fields override
}
```

Rules that keep it an engine and not a form builder:

1. **Blocks are a projection of ETAL, not a second language.**
   Every block has exactly one lowering (`emitBlocks`), preview shows
   the ETAL, "convert to code" freezes the event to its `code` field.
   Same contract as DnD⇄GML. The agent corpus (`backend/rag/tools.md`)
   documents blocks the same way it documents tools today.
2. **Old projects keep loading.** A leaf without `def` is an inline
   instance (today's behavior). "Extract to object" converts it.
3. **Validation stays the gate.** Unknown sprite/input/voice/scene,
   player-count across defs+inlines, slot budget, reserved names —
   all in `validateProject`, all before emit.
4. **No main loop is ever user-visible.** Triggers are loop moments
   (Create/Step/…), exactly like GameMaker events.

## 3. Phases

### Phase 0 — Friction fixes ✅ DONE (+ multi-tile sprites)

*Why first:* the user's complaint ("can't even select sprites") and
everything later needs a picker and named inputs anyway.

* Sprite picker: `SpritePicker.tsx` (search + grid + tile dims, shared
  `SpriteThumb`) used by hierarchy "new object" form and the new
  inspector Sprite row. Agent `put_on_scene` already took a sprite —
  UI caught up, no tool change there.
* Canvas toolbar: snap toggle (default on, 8px) + stamp mode
  (click empty canvas places gallery sprite, Esc/right-click exits).
  Hit-testing and clamping are sprite-dims aware.
* Named inputs: `inputs: {id, key}[]` on project + `KeyPicker`
  (dropdown + press-a-key capture via `lib/keys.ts`); bindings store
  `input` id, emitter resolves via `bindingKey()`; legacy raw codes
  migrate to shared `key_<code>` inputs 1:1 (tested).
* Multi-tile sprites (added mid-phase — Uxn draws 8×8 tiles, bigger
  art = consecutive tiles): `Sprite {w?, h?}` 1–4, editor paints the
  full grid, gallery thumbs keep aspect, transforms are tile-aware,
  emitter draws per-scene unrolled tile writes + `ow`/`oh` dims
  buffers (driver scenes only) + `overlapwh`, clicks/drive use real
  dims. Animation frames and leaf sprites must share dims (validated).
* Assembler budget found empirically along the way (etal `-r` probes):
  one `fn` holds ~1200 label references before `References exceeded`
  fails the build (1200 OK, 1400 fails) — documented in
  `backend/rag/etal.md`, and codegen stays far below it (shared
  loops; solid-only dims lines; conditional dims machinery).
* Also fixed: `backend/rag/varvara.md` claimed variable-height strip
  sprites — wrong; one write = one tile, multi-tile via `auto` port
  or repeated writes (we do the latter; device decl already had
  `auto`, the cheat sheet didn't).
* Tests/docs: 9 new tests (tiles, inputs, tool), i18n en+es,
  `tools.md` (`create_sprite` w/h), corpus re-synced, chess example
  uses named inputs. Suites: frontend 59, backend 55, `tsc` clean.

### Phase 1 — Object templates (the GameMaker split) ✅ DONE

* Model: `ObjectDef[]` library as in §2 (incl. default tick — useful
  already); `SceneNode.def?` + local overrides (sprite/kind/solid/
  controls/anim/tick; id/x/y always instance state). Inline leaves
  keep working; `objectDefs` is optional so old projects load
  untouched, no migration. Deleting a def bakes effective values
  into instances (non-destructive, game plays identically).
* Emitter: **no change** — defs resolve in `flattenScene`, so setup,
  draw, clicks, drive and anims consume effective values untouched.
  Physics rules, player/driver caps and anim-size matches moved to
  resolved leaves (paths pinpoint nested leaves).
* UI:
  * Left column: new **AssetBrowser** (search, kind icons, drag to
    canvas, + templates the gallery sprite) stacked over the
    hierarchy. Right panel shows **ObjectEditor** when a def is
    selected (rename with ref updates, sprite/kind/flags/anim/tick,
    used-by list, two-click delete with bake note).
  * Hierarchy "new object" gained a template picker (blank form
    unchanged otherwise). Drag def → canvas stamps a clamped
    instance (snap-aware). Alt-paint multiples deferred.
  * Inspector on instances: teal "Instance of" banner + Open Object,
    effective values everywhere, teal dots on overridden rows, one
    Reset for all overrides; inline leaves get "Extract to object
    template". X/Y inputs clamp by effective sprite dims.
* Agent: `create_object_def`, `place_instance`, `extract_object`
  tools; `describe` lists defs; old tools untouched. Corpus mirrors
  the new tools.
* Tests: 10 new (resolution incl. explicit-false, def/instance
  validation, post-resolution caps, emitter passthrough, store
  add/rename/extract/delete-bake/patch, tool flow). Suites:
  frontend 69, backend 55, `tsc` clean, production build ok.

### Phase 2 — Events + blocks (the big one) ✅ DONE

* Model: `ObjectEvent {id, trigger, key?, target?, blocks}` on defs
  and inline leaves (`SceneNode.events`); instances run their def's
  (local lists on instances are an error). 7 triggers, 6 blocks.
* Triggers v1: `create` (scene enter, via setup), `step`, `destroy`,
  `key` (named input), `collide` (AABB vs any/solid/player/movable/
  def, **level-triggered** while overlapping), `click`
  (press-in-rect), `alarm` (**single** countdown timer per slot,
  set by `wait`).
* Blocks v1: move (clamped), set_pos, play (one-shot SFX reusing the
  boot sample), goto, destroy (self; runs the destroy event first),
  wait. **No `if`/`set` in v1** — events are the conditionals, and
  the legacy `tick` textarea stays as the step code hatch (blocks
  first, then tick text, same historic `tick_<tag>` name).
* No data migration: clicks/keys/frameCode/tick stay exactly as they
  were; object events are new and coexist (scene transitions still
  run first in the frame).
* Emitter: every event lowers to a small per-leaf `slot`-param fn
  (step shares `tick_<tag>`); destroy fns live per template
  (`destroy_def_<id>`) or per inline leaf. Frame only dispatches, in
  documented order: input latch → drive → anims → scene transitions
  → object key → object click → step → collide → alarm →
  custom/frameCode → draw. Destroyed leaves go quiet via a new
  alive bit (oflags bit 3; draw, drive, collide, handlers honor
  it). Collide pairs unroll statically (max 48/scene, validated)
  with a dead-target error — no runtime tags needed.
* UI: events view center = `EventPanel` (owner picker: scene leaves
  + templates; event list with Add picker incl. KeyPicker and
  collide targets; vertical block stack with per-op editors, up/down
  reorder, add palette, live ETAL preview via the same
  `previewBlocks` the emitter calls; step shows the tick hatch).
  Transition graph stays below it, untouched (scene map = Phase 4).
  Convert-to-code and toolbox-search deferred (stack is small).
* Agent: `add_event`, `add_block`, `preview_event` (+ delete both);
  corpus documents triggers/blocks/order/caps 1:1.
* Tests: 10 new (validation incl. dups/pairing/dead-targets/cap,
  exact lowerings per op, fn/dispatch/guard wiring, store fns,
  agent tool flow, full-events real-etal assembly). Suites:
  frontend 79, backend 55, `tsc` clean, production build ok.
* Phase 3+ input: `if`/variables need a var system (buffers +
  UI); named sounds replace play literals; edge-triggered collide
  would need prev-frame overlap state.

### Phase 3 — Sound as an event citizen

* Model: `sounds: {id, voices: Voice[]}` — named one-shot blips +
  today's boot jingle becomes `scene_start → play boot` default.
* Emitter: `play` block → voice trigger code; polyphony = today's 4
  voices, documented (steal GameMaker's asset-gain × instance-gain
  *idea* as volume-per-call, nothing more).
* UI: Sound view lists named sounds (each = mini voice editor),
  block picker lists them by name; VoiceList/VoiceEditor generalize.
* Small phase on purpose — it only unlocks after blocks exist.

### Phase 4 — Scenes overview map

* `EventsGraph` list → canvas: scene nodes (status color, object
  count), edges for every transition/event-goto, click-to-jump,
  drag-to-pan, "new scene" drop, minimap-ish zoom for large projects.
  GameMaker's room order + Godot's scene tabs as reference, not copy.
* No model change (reads scenes + bindings + event gotos).

### Phase 5 — Engine-complete polish (pick by pain, not by list)

* Instance Creation Code (per-instance ETAL patch after Create —
  the escape hatch that prevents def proliferation).
* Collision mask choice per def (full/solid-box/precise-slow —
  GameMaker's mask honesty, Uxn-sized).
* Animation polish: ping-pong, per-frame rates (model already has
  rate+loop; extend, don't redesign).
* Multi-select + bulk edit with `-` for divergent values (GameMaker
  inspector), lockable inspector.
* `Ctrl+T` go-to-everything (assets, scenes, inputs, sounds).
* Playtest: needs backend headless-run endpoint (deferred v2 in
  backend ARCHITECTURE.md) — until then, "export + open" stays,
  but one click from the studio.

### Explicitly not copying

* Physics engine / fixtures / Box2D — Uxn gets AABB flags + collide
  events. Enough for the games this engine makes.
* Sequences/timelines editor — cutscenes are scene chains + waits;
  revisit only if Phase 2 users ask twice.
* Godot-style signals auto-stub — our triggers *are* the wiring;
  no second mechanism.
* Third-party block runtimes — blocks lower to our DSL, no
  interpreter in the ROM.

## 4. How the graphical version compiles to our DSL

Same pipeline as today, one new lowering in the middle:

```
defs + instances + events/blocks
  → resolve (defs → inline leaves, overrides win)
  → validate (today's gate + event/block checks)
  → emitBlocks (each block → ETAL statements, fixed templates)
  → emitProject (unchanged shape: devices.ux + main.ux)
  → POST /compile (unchanged, final arbiter)
```

`emitBlocks` templates are total (every block lowers, no partial
states) and readable (preview shows them verbatim). The agent gets
the same blocks as tools, so human-built and agent-built games are
the same bytes — determinism already guaranteed by sorted ids.

## 5. Test/doc contract per phase (non-negotiable, from experience)

* `project.test.ts`: model migration (old project → new fields),
  lowering snapshots (blocks → exact ETAL), validation rejections.
* Agent `loop.test.ts`/`pi.test.ts`: new tools end-to-end, BYOK
  guard intact, no key material in transcripts.
* `backend/rag/tools.md` mirrors every new tool/block the same
  commit (the corpus test fails otherwise — check how).
* `i18n.ts` en+es for every string (the i18n test fails otherwise).
* `ENGINE_PLAN.md` (this file): check off phases as they land,
  record deviations.
