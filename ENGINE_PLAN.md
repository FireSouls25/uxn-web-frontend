# Engine plan: from scene painter to real engine — PHASES 0–6 DONE

Status: **Phases 0–6 done** (friction fixes, multi-tile sprites,
object templates, events/blocks, named sounds, scene map, polish,
canvas-first studio rebuild + execute/button blocks).
Phases 0–5 made it an engine; Phase 6 made it feel like one
(GameMaker loop, Godot chrome). Each phase lists the model change,
the emitter change, the UI change, and the docs/tests that move
with it.

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

### Phase 3 — Sound as an event citizen ✅ DONE

* Model: `sounds: {id, voices: Voice[]}[]` — named one-shot SFX;
  voice index = Audio device, vol 0 = silent. The boot mix stays
  exactly as it was (no scene-start trigger exists to migrate it
  to); literal play blocks migrate to synthesized `sfx_*` sounds,
  so `play {sound}` is the one form going forward.
* Emitter: named voices lower to Audio port writes reusing the boot
  sample; `usedVoices` collects block voices so devices exist;
  all-silent sounds are rejected (they would lower to zero lines
  while dispatch still calls the fn).
* UI: sound view = boot mix + named library (VoiceList), per-sound
  editor with rename/4 voices/test tones/refuse-when-referenced
  delete; play rows use a sound dropdown (+play templates an audible
  sound on first use). Locked projects stay read-only (incl. the
  previously unguarded event panel).
* Agent: `create_sound`, `set_sound_voice`, `rename_sound`
  (play blocks follow), `delete_sound` (refused while referenced).
  The demo plays a `blip` when its hero is clicked.
* Tests: 4 new (literal→named migration incl. sharing, library
  validation, sample after-boot SFX, store add/rename/delete).
  Suites: frontend 83, backend 55, `tsc` clean, production build ok.

### Phase 4 — Scenes overview map ✅ DONE

* `EventsGraph` list → SVG canvas: scene nodes (accent color,
  object count, start-scene ring, dashed red when broken), edges
  for every transition — bindings AND event goto blocks (deduped,
  labeled, self-loops included), click-to-jump, drag-to-pan,
  cursor-anchored wheel zoom + buttons + fit. BFS-depth columns
  from the start scene (unreachable last). No minimap (zoom-to-fit
  + pan covers it at our scene counts) and no "new scene" drop
  (creation stays in the hierarchy).
* No model change: pure `buildSceneMap(p)` over scenes + bindings
  + resolved flat-leaf events (def events included automatically);
  broken scenes list with bindings but no event edges, unknown
  gotos skipped.
* Tests: map ordering/depths/edge labels, dedupe, unknown-goto
  skip, broken-scene survival. Suites: frontend 85, `tsc` clean,
  production build ok.

### Phase 5 — Engine-complete polish ✅ DONE (picked by pain)

* Instance Creation Code: `SceneNode.initCode`, spliced after the
  leaf's create blocks (same setup call condition), instance-only
  (defs use create events). Inspector textarea + `creation_code`
  tool; validated like tick text.
* Hitboxes: `HitBox {x,y,w,h}` on defs (default) + leaves (whole-box
  override), resolved in flatten, validated against resolved sprite
  pixels. Collide pairs and click rects use masked literals; **drive
  keeps full bounds on purpose** (generous world, precise hitbox —
  the GameMaker-feel trade without mask buffers blowing the
  assembler budget). Inspector + ObjectEditor share `MaskEditor`;
  `set_mask` tool for the agent. Precise-per-pixel masks skipped
  (AABB is the Uxn-sized honesty).
* Animation: real frame editor (strip + add-selected with
  same-size guard, rate, loop, **ping-pong** with bounce logic and
  `adir_` counters; ping-pong requires loop + 2+ frames) +
  `add_anim_frame` / `set_anim` tools. Per-frame rates skipped
  (rate 1–255 is fine-grained enough).
* `Ctrl+K` go-to-everything (K, because browsers own T): scenes,
  templates, sprites, sounds, inputs with jump-to-view+select.
* Playtest: no backend endpoint needed — `compileProject` returns
  bytes, and a Playtest button runs the web bundle in an iframe
  below the export panel (same bytes as the download).
* Deferred, honestly: multi-select + bulk edit (doubles inspector
  complexity; revisit when level-building pain demands it),
  per-frame rates, precise masks, backend headless-run endpoint.
* Tests: 12 new (mask validation/emitter/drive-unchanged, initCode
  validation/order/initCode-only call, ping-pong validation/lines/
  counters, anim store fns, creation_code/anim/mask tools,
  full-feature real-etal assembly). Suites: frontend 97, backend
  55, `tsc` clean, production build ok.

### Explicitly not copying

* Physics engine / fixtures / Box2D — Uxn gets AABB flags + collide
  events. Enough for the games this engine makes.
* Sequences/timelines editor — cutscenes are scene chains + waits;
  revisit only if Phase 2 users ask twice.
* Godot-style signals auto-stub — our triggers *are* the wiring;
  no second mechanism.
* Third-party block runtimes — blocks lower to our DSL, no
  interpreter in the ROM.

### Phase 6 — Canvas-first studio ✅ DONE

*Why:* phases 0–5 built the engine but left five separate views
around it (rail + side panes + event list + map list). The rebuild
puts one pannable/zoomable canvas at the center with GameMaker's
loop (Scene ⇄ Logic) and Godot's chrome (header tabs, docked
overlays), keeping every byte of project data loading untouched.
* Model: two new blocks, both total in `previewBlocks`:
  `code {code}` (Execute-ETAL hatch — raw statements spliced
  verbatim, same reserved-name gate as tick text, the UI home of the
  old tick/initCode textareas) and `button {label 1–32, action 0–64}`
  (labeled annotation lowering to a comment — clickable affordance,
  zero runtime bytes). Validation rejects empty/colliding code and
  quote/backslash/newline smuggling in button text. Old projects use
  neither op, so their emit is byte-identical (tested: sample
  through migration emits exactly what it always did).
* Emitter: **no shape change** — two new `previewBlocks` arms only.
  `button` is a comment; `code` splices lines like tick text.
* UI:
  * `StudioHeader` (replaces `ProjectBar` + `StudioRail` view
    switching, both deleted): project name/kind, scene tabs (+/x,
    drag-across reorder via new `reorderScenes`), Scene|Logic toggle
    (`canvasModeStore`), snap/grid/fit (`viewportStore`), sprite /
    sound / code dialog buttons (`viewStore`, dialogs only now),
    Playtest button (compiles the web bundle into `playtestStore`)
    and an export popover (target/mode/Download).
  * `EngineCanvas` shell (pan/zoom viewport) + `SceneLayer` (the
    StudioCanvas pixel render/hit/drag/def-drop, snap+grid from the
    viewport store), `SceneMapLayer` (EventsGraph BFS columns
    restyled dark with cubic bezier edges), `LogicGraphLayer` (every
    object a dark node, event ports → child block stacks wired with
    measured beziers, goto edges to scene chips, tick/initCode as
    Execute-ETAL blocks with live `previewBlocks` previews).
  * `NodeDock` (left overlay: AssetBrowser + Hierarchy + SceneNav,
    collapsible, def drag still stamps) and `InspectorOverlay`
    (right overlay: slim Inspector/ObjectEditor with `hideCode` —
    no code textareas, Logic N-events → Open jump, teal dots and
    used-by kept). `PlaytestOverlay` (fullscreen, X/Esc, revokes
    the blob URL on close).
  * `viewStore` kept for sprite/sound/code dialogs only (modal over
    the canvas); scene/events views are canvas modes now. Deleted:
    `EventPanel`, `EventsGraph`, `ExportPanel`, `TransitionEditor`
    (bindings still edit from the inspector), `StudioSides`.
* Agent: `add_block` takes `code {code}` / `button {label,
  action}`; corpus (`corpus/tools.md`) mirrors the two ops.
* Tests/docs: 4 new (lowerings, validation rejections, emit
  inclusion + byte-identical old emit, tool flow), i18n en+es for
  every new string, `tsc` clean, production build ok. Suites:
  frontend 101.

### Phase 7 — Connected blocks ✅ DONE

*Why:* sprites painted bigger than 1 tile still rendered 8×8 in the
scene; logic showed no object-to-object relations; raw ETAL lived
inline in the logic view instead of as connectable Code assets.
* Model: one new block + one library, both total in
  `previewBlocks`: `run {snippet}` splices a named snippet from the
  new `snippets: {id, code}[]` library (tick-text gate, duplicate/bad
  id/unknown-ref rejected, refcounted delete like sounds). Legacy
  `code` keeps its lowering so old projects emit byte-identical
  bytes, but the UI no longer authors it. Menus stay what they are:
  button labels + click/key events + goto scene chains (no second
  language, no interpreter in ROM) — the palette just says so now.
* Emitter: **no shape change** — one new `previewBlocks` arm plus a
  `snippets` map threaded through the existing `BlockCtx` sites.
* UI:
  * `SceneLayer` paints full multi-tile sprites (tile-major walk,
    was first-tile-only) with full-bounds selection.
  * `LogicGraphLayer`: collide events draw dashed sky edges to the
    object nodes they can hit (capped, count chip beyond) with a
    chain/goto/collide legend; add-palette grouped
    Move/Sound/Flow/Code/Note; play rows show their trigger chip +
    audition + Sound jump; `code` rows are read-only + To-snippet;
    tick/initCode textareas are gone — collapsed Legacy scripts with
    one-click move-to-snippet (same bytes out).
  * Inspector `RunCodeSection`: the selected object's run blocks
    (event + snippet + Code jump + remove) plus attach row
    (snippet + trigger → run block on that event).
  * `CodeStudio` edits the snippet library (select/rename/delete,
    highlighted editor, same gate) next to files + custom.ux.
  * `NodeDock` quick actions: New scene + New object (gallery
    sprite) up top; per-row deletes unchanged.
* Agent: `add_block` takes `run {snippet}`; new `add_snippet` /
  `set_snippet_code` tools; both rag mirrors updated
  (`frontend corpus` + `backend/rag/tools.md`).
* Tests/docs: snippet lowering/validation/emit + tool flow (suites:
  frontend 103), i18n en+es, `tsc` clean, production build ok.

### Phase 8 — Blocks view owns connecting ✅ DONE

*Why:* creation lived inside object nodes while the inspector showed
the same object form in both modes; scene chips in the canvas
duplicated navigation; the view name said Logic while its job is
picking blocks.
* UI:
  * The Scene|Logic toggle is now Scene|Blocks (`hdr.mode_logic`,
    en+es; inspector jump buttons follow). Internal ids
    (`canvasMode "logic"`, `viewStore "events"`) unchanged.
  * `LogicInspector` (new, right panel in Blocks mode): target
    object select (follows canvas selection) + event select + new
    event form (trigger/key/collide pickers) + grouped add-palette
    (Move/Sound/Flow/Code/Note, valid-by-construction defaults via
    shared `defaultBlockFor`) + sound attach (picker + audition +
    attach + Sound jump) + snippet connections (`RunCodeSection`)
    + Code jump. Nodes keep display + row edit/reorder/delete +
    legacy convert; creation moved out entirely.
  * Scene switching has one fixed home: the nodes dock (`SceneNav`
    + hierarchy + header tabs). `LogicGraphLayer` lost its scenes
    chip column (goto still a dropdown per row; flow stays visible
    in `SceneMapLayer`, which no longer click-navigates).
* Engine vs language (audited against `lib/*.ux` + language docs):
  visual covers triggers (7 moments), move/set_pos (clamped),
  one-shot play, goto-replace, self-destroy, single wait/alarm,
  snippets-as-`run`; everything else is snippet/custom territory —
  fix16/trig/lerp/u32 math, multi-timer pools (`timer.ux` ×4),
  hold/drag gestures, menu index (`menu_*`), song tracks
  (`track_next`/`song_tick`), runtime spawn (`obj_spawn`),
  scene push/pop stack, strings/fonts, file/datetime, custom
  devices, key combos/modes. No new runtime ops this phase.
* Tests/docs: model untouched (no migration), i18n renames en+es,
  `tsc` clean, suites still 103, production build ok.

### Phase 9 — Phase A blocks + draggable canvas ✅ DONE

*Why:* walk/appear/vanish/clear-room had no visual form, and blocks
could only be appended in place — creation lived in per-object
lists instead of a draggable GameMaker-style palette.
* Model (all additive, old emits byte-identical): `sprite {sprite}`
  (runtime art swap: `ot` + `ow/oh`, same tile dims enforced like
  anim frames), `show`/`hide` (alive bit on/off without running
  destroy events — hidden leaves skip drive/collide/handlers like
  destroyed ones), `destroy {target?}` (self default, else
  `any|solid|player|movable|def:<id>` unrolled statically like
  collide pairs: alive-guarded victim destroy-fn call + bit clear,
  max 12 victims, empty match is a validation error).
  Deliberately NOT included: key press/down/release modes (both VMs
  drop key-up info — `uxn2.c:1279` only clears buttons, `uxn5`
  `controller.js:91-105` never reports release keys — so held-keys
  are VM-impossible; arrows stay held-capable via drive buttons and
  the palette says so nowhere because modes don't exist) and
  standalone `random` (a statement block with nowhere to write
  until Phase B vars land).
* Emitter: three new `previewBlocks` arms + `victimsOf` resolver
  (`destroyVictims`, shared by preview and emit); `ow/oh` buffers
  now trigger on sprite blocks too.
* UI: palette regrouped Move/Art/Sound/Flow/Code/Note with
  valid-by-construction defaults; palette buttons are draggable
  copy-sources, block rows draggable move-sources (grip, form
  controls exempt), every event stack a drop target with
  before/after indicators (reorder, cross-event and cross-object
  moves); click-to-add kept as fallback. Inspector sound section
  is now a single draggable music block — sound choice lives on
  the placed block, never in the menu.
* Agent: `add_block` takes `sprite/show/hide/destroy{target}`,
  both rag mirrors updated.
* Tests/docs: lowering snapshots (incl. real-etal assembly of a
  Phase A project when the binary is present), validation
  rejections (bad/unknown/mismatched sprite, bad/empty/crowded
  destroy), tool flow, i18n en+es. Suites: 107.

### Phase 10 — Free canvas with drill-down ✅ DONE

*Why:* creation had left the nodes but nodes were still a fixed
stack, and scene switching lived in the canvas. Blocks should be
dragged around like a scene graph.
* UI:
  * `project.layout` (new optional field: scene + per-scene object
    block positions; ignored by validation/emit, passes migration
    untouched): every scene/object block stays where left, with
    cascade defaults for untouched projects.
  * Blocks view is two levels (`mapLevelStore`, default map):
    `SceneMapLayer` renders scenes as free HTML blocks (fixed
    184×64, bezier goto edges, single-click selects,
    double-click drills = sets the scene + objects level);
    `LogicGraphLayer` renders that scene's top-level objects as
    free 400px blocks (chain wires inside, dashed collide wires
    between, count chips beyond caps). Viewport pan/zoom unchanged
    (drags are zoom-aware, `data-nopan` keeps gestures apart);
    breadcrumb pill returns to the map.
  * Object nodes gain a `+` quick-add (first unused trigger moment)
    and full-node drag (interactive children exempt); nested
    branches stay dock-only. Scene switching lives in the nodes
    dock + header tabs — canvas nodes never navigate.
* Tests/docs: model additive (no migration), i18n
  map/back/drill/hint en+es, suites still 107, build ok.

### Phase 11 — Variables, conditions, multi-alarm ✅ DONE

*Why:* scores, health, counters, combos and menus had no visual
form; timers were single-slot; keyboard-held was implied but
VM-impossible.
* Model (all additive, old emits byte-identical): `vars: {id,
  init}[]` (one `var_<id>[1]` buffer each, boot init in `start()`,
  shared with hand snippets); `set {name, mode set|add|sub,
  value}` (constants); `if {cond, then, else?}` (operands
  var/const/pos-x-y/btn-up-down-left-right over live dpad bits —
  deliberately NO held-key operand: both VMs drop key-up info, so
  key events stay press-edge and this is documented, not faked);
  `wait`/`alarm` gain slot 0–3 (slot 0 keeps legacy `oat`/fn
  names; slots 1–3 get `oat1..3` buffers only when used).
* Emitter: fixed `previewBlocks` arms (recursive, indented);
  per-slot alarm fns + dispatch + setup; buffer/device detection
  (`eachBlock`) now descends into branches so nested play/move/
  wait can't assemble against missing declarations. Depth cap 3.
* UI: set/if editors + recursive branch stacks (same editors,
  drag-move, compact add rows, chain wires fork from the if row);
  grouped Data palette; alarm slot pickers on wait rows and the
  new-event form; variables library in CodeStudio (new/rename/
  init/delete, refcounted); event summaries show alarm slots.
* Agent: `add/rename/set/delete_variable`, `add_block`
  set/if (+ nested `path`), `delete_block` path, `add_event`
  alarm slot, `wait_slot`; both rag mirrors updated.
* Tests/docs: lowering snapshots (all operand kinds, nesting),
  validation (dup/bad var, bad cond/operands, depth cap, slot
  pairing/ranges), multi-alarm emit + real-etal assembly,
  agent flows. Suites: 111.

### Phase 12 — Music, labels, scene stack ✅ DONE

*Why:* the last three things a game wants and we had no visual
form for — a loop that plays while you play, text on screen, and
a pause/menu that returns you where you were.
* Model (additive, old emits byte-identical):
  `songs: {id, tracks[4]}[]` with `SongNote {pitch 0-107 | 127,
  len 1-255}`, ≤16 steps per voice (the live track buffers are 16
  bytes per voice — 128 bytes of RAM, a real cap, not a UI whim);
  blocks `song {song}`, `song_stop`, `overlay {scene}`, `back`;
  `SceneNode.label` — 1–24 printable ASCII, per-instance state.
* Emitter: shared 4-voice sequencer over live buffers
  (`sglp0..3`/`sgll0..3` pitch+len, `sg_pos/wait/len/vol` per
  voice, `sg_on`), one `song_<id>_start()` per referenced song
  that copies its 16 steps in, and `song_tick()` called once per
  frame from `on_frame` (before the scene match, so a loop keeps
  playing across scene switches). Fires through the same `&sq32`
  square wave as one-shots; voice index = Audio device, and a voice
  with no audible notes gets neither a device nor a tick arm.
  Labels prerender their glyphs into `data lbl_<tag>` at emit (from
  the 8×8 table copied out of `lib/font.ux` into `src/lib/font.ts`)
  and blit 1bpp, mode 1, inside the leaf's alive guard — so a
  labeled project pays only the glyphs it uses and never imports
  the font library. Overlay is a **fresh instance** stack
  (`ovst[8]`/`ovsp[1]` + `overlay_back()` match arm), NOT
  freeze-pause: `setup_X` re-runs, so it is menu navigation, and
  that is documented rather than papered over.
* UI: `music`/`stop music`/`overlay`/`back` in the Sound and Flow
  palette groups with per-block pickers (song select + open, scene
  select); `SongEditor` 4×16 step grid (click a cell to add a note
  off the C-major ladder, click it again to clear, right-click to
  clear, hold-length buttons), songs list next to sounds in
  VoiceList, usage+attach panels shared with one-shots; label field
  in the inspector with a live `LabelPreview` and on-canvas glyph
  render, so what you see is the ROM's blit.
* Agent: `create_song`, `set_song_note`, `set_song_vol`,
  `rename_song`, `delete_song`, `set_label`; `add_block` gains the
  four ops; both rag mirrors updated.
* Tests/docs: song validation (track count, no-notes, pitch/len/
  step/vol ranges), sequencer emit (data blobs, start fn, tick
  arms, voice parity with Audio devices), label prerender + blit
  offsets, overlay stack and its no-op edges, projects without the
  blocks stay byte-identical, real-etal assembly of all three
  together. Suites: 118.

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
