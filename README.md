# Frontend — uxn·forge studio web

Astro 5 + React 19 islands. Layout follows `reference/` (mockups +
`retro_technical_workstation/DESIGN.md`, git-ignored, never shipped);
colors are Catppuccin **Mocha** (dark, default) / **Latte** (light)
via CSS variables in `src/styles/theme.css` — one `data-theme` flip
re-themes everything.

## Pages

| Route | Content |
|---|---|
| `/` | Hero, workstation features, live export targets (`GET /targets` with static fallback) |
| `/login`, `/register` | Animated forms backed by `POST /auth/*` (JWT session → `/studio`), with account-required-for-saving notice |
| `/projects` | Project management: create/open/delete, per-project scene/object stats |
| `/studio` | Workstation: Godot-like scene hierarchy (drag-reorder, cross-scene moves, kind icons, per-scene colors), canvas (select + drag + size presets + scene switcher), fullscreen sprite editor (gallery, animations, 4 real Uxn colors), scene graph + transition editor, sound mixer (voice list + detail), generated-code preview, kind-based inspector (rename, physics, bindings), export pane — side panels specialize per view |

## Studio store + export

`src/lib/store.ts` (nanostores) is the single source of truth canvas,
inspector and exporter read. Persistence is login-gated: guests work
in memory only (amber banner says so), logins persist to localStorage.
`src/lib/export.ts` validates → emits → `POST /compile` → downloads
the artifact (`forge-demo.html`, …) into Downloads. Landing target
cards export the demo project; the studio panel exports live edits.

## i18n (en/es)

One dictionary: `src/lib/i18n.ts`. Detection order is stored
preference → `navigator.language` → English, applied pre-paint
(`data-lang`, no flash) and persisted. Static Astro markup uses
`data-i18n="key"` with English fallback content; React islands use
`useLang()` + `t()`. Toggle lives in the header. New strings go in
the dictionary, never inline.

## Project → ETAL emitter (`src/lib/project.ts`)

`Project` (scenes of 8px objects + click/key → goto bindings) lowers to
two dependency-free files (`devices.ux`, `main.ux`) the backend compiles
as-is. Deterministic (sorted ids, fixed 16-slot pool), validated up
front (`validateProject`, legacy 1bpp projects auto-migrate). Objects
reference a shared 8×8 2bpp sprite library (planar `.chr` layout, blit
mode 129) with frame animations; each object has a kind (player /
static / movable, at most one player per scene, 0 allowed) plus
collision and keyboard-drive flags, lowered to collide-and-push frame
code emitted in hierarchy order (drag-reorder = draw order); up to 4
sound voices (MIDI 0–107) play once on boot through `Audio0–3` with a
shared square wave — all inside Uxn limits, palette computed from the
emulator's own formula (`src/lib/palette.ts`).

```sh
npm test          # determinism, validation, dispatch markers…
                  # …plus a real `etal -r` of the sample when a binary exists
                  # (ETAL_BIN env, else the local checkout path)
```

## Develop

```sh
npm install
npm run dev        # http://localhost:4321
npm run build
```

Config lives in `.env` (dev defaults, git-ignored; see
`.env.example`): `PUBLIC_API_URL` points at the backend
(default `http://localhost:8000`).
