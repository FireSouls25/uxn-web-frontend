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
| `/login`, `/register` | Animated forms backed by `POST /auth/*` (JWT session → `/studio`) |
| `/studio` | Workstation shell skeleton: project bar, icon rail, hierarchy, viewport, event graph, inspector, status bar |

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
front (`validateProject`), v1 scope is click + key → scene switch.

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
