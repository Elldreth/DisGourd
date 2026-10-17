# P1-18 — Bump Vite (and @vitejs/plugin-react), drop the esbuild override

- **Unit Type:** Implementation
- **Phase:** 1 — Ops ("Bump vite")
- **State:** REVIEW (PR open)
- **Effort:** S
- **Depends on:** none
- **Serialize with:** any unit editing `web/package.json` or the lockfile (P1-19, P2-02, P2-06)
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 1. Revalidated: `vite ^5.4.11`, `@vitejs/plugin-react ^4.3.4`, and an `esbuild ^0.25.0` override for GHSA-67mh-4wv8-2f99.

## Scope
- Upgrade to the current Vite major and the matching `@vitejs/plugin-react` (check `npm view vite version` at implementation time). Keep Tailwind 3 and PostCSS as they are. Tailwind 4 is a non-goal.
- Remove the `overrides.esbuild` and `comment:overrides` entries if the new Vite ships a patched esbuild.
- Check `web/vite.config.js` (dev proxy for `/gateway` with ws, and the API paths) against the new major's config changes.
- Node 22 in Docker and CI must meet the new Vite's minimum Node version.

## Acceptance criteria
- [x] `npm --prefix web run build` succeeds. The output is served by `node server/server.js` and the app loads.
- [x] `npm --prefix web run dev`: HMR works, and the `/gateway` WebSocket proxy connects (send a message).
- [ ] `npm audit --prefix web` shows no high or critical issues. **Partly met:** both criticals and every finding outside Tailwind 3 are fixed (17 -> 7); the 7 left (5 high, 2 moderate) are all Tailwind 3's own dependency chain and can't be fixed without Tailwind 4, which this packet rules out. See Discovered Work.
- [x] The main JS chunk size is within ±10% of before (record both numbers in the PR).

## Expected Areas of Change
`web/package.json`, `web/package-lock.json`, possibly `web/vite.config.js`.

## Working Set / Blast Radius
Build tooling only, but every client unit builds through it.

## Scope changes during the work
- **Vitest 2 -> 5 (two majors) and jsdom 25 -> 30**, not just Vite: the critical tinypool and Vitest advisories are only fixed in Vitest 4.1.11+, and Vitest 5 is the line that supports Vite 8. No test or config changes were needed.
- **`build.chunkSizeWarningLimit: 600`** in `vite.config.js`: Vite 8 warns about the lazily loaded emoji data chunk (571 kB raw, 86 kB gzip, only fetched when the picker opens).
- Version choice: newest releases at least two weeks old (vite 8.3.2, @vitejs/plugin-react 6.1.1, vitest 5.0.3, jsdom 30.1.1, postcss 8.5.28, autoprefixer 10.6.1; transitive source-map-js 1.2.2). Newer ones (vite 8.3.4, vitest 4.1.12, postcss 8.5.30, jsdom 30.1.3) were days old and skipped.

## Evidence
| Check | Result |
|---|---|
| `npm audit` | before: 17 (2 critical, 10 high, 5 moderate). After: 7 (0 critical, 5 high, 2 moderate): braces, chokidar, micromatch, fast-glob, postcss-selector-parser, postcss-nested, tailwindcss; npm's only fix for each is tailwindcss 4 (braces has no patched release at all) |
| `esbuild` override removed | Vite 8 bundles with Rolldown; esbuild is only an optional peer now |
| Web tests | 159/159 on Vitest 5 + jsdom 30, no changes |
| Server tests | 77/77 |
| `npm --prefix web run build` | ok in ~0.6 s (was ~1 s); main chunk 306.96 kB / 94.97 kB gzip -> 306.57 kB / 93.28 kB gzip (-1.8% gzip) |
| Built app served by the sandbox server (:3005) | loads, gateway "Connected" |
| `vite` dev server (8.3.2) on :5174 proxying to the sandbox | sign-in through the API proxy; gateway connected through the `/gateway` ws proxy; a message sent and echoed; a temporary edit to Composer's placeholder hot-reloaded in the same page (no reload, still connected), then reverted; no server or console errors |
| Node | Vite 8 needs ^20.19 or >=22.12, Vitest 5 ^22.12; Docker (`node:22-bookworm`) and CI (`node-version: 22`) resolve to current 22.x |

## Discovered Work
- **Tailwind 4 migration** clears the last 7 audit findings (all build-time only: Tailwind reads our source files when building and never ships to the server or browser). It's a real migration (config moves into CSS, some class changes), so it fits best alongside P2-16 (theme tokens -> CSS variables). Proposed as its own unit.
- A `web-sandbox` launch configuration (Vite dev server on :5174 proxying to the sandbox on :3005) was added to the local, uncommitted `.claude/launch.json` for this check.
