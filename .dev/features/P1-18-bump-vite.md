# P1-18 — Bump Vite (and @vitejs/plugin-react), drop the esbuild override

- **Unit Type:** Implementation
- **Phase:** 1 — Ops ("Bump vite")
- **State:** READY
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
- [ ] `npm --prefix web run build` succeeds. The output is served by `node server/server.js` and the app loads.
- [ ] `npm --prefix web run dev`: HMR works, and the `/gateway` WebSocket proxy connects (send a message).
- [ ] `npm audit --prefix web` shows no high or critical issues.
- [ ] The main JS chunk size is within ±10% of before (record both numbers in the PR).

## Expected Areas of Change
`web/package.json`, `web/package-lock.json`, possibly `web/vite.config.js`.

## Working Set / Blast Radius
Build tooling only, but every client unit builds through it.
