# P2-17 — Light theme + theme picker (Dark / Light / System)

- **Unit Type:** Implementation
- **Phase:** 2, rank 9 (slice 2)
- **State:** PLANNED
- **Effort:** M
- **Depends on:** P2-16
- **Serialize with:** index.css units. Its component audit touches many files, so run it when few client units are in flight.
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 2 #9

## Scope
- `[data-theme="light"]` overrides every theme variable (`--color-*` from `@theme` in `index.css`, since P1-21; the packet originally said `--c-*`) with a Neon Calabash light palette: lavender-white surfaces, deep violet text, brand violet kept, and lime/pink darkened enough to reach AA as text on light.
- New `web/src/theme.js`: `getTheme`/`setTheme` ('dark'|'light'|'system') and `applyTheme()`. `system` follows `matchMedia('(prefers-color-scheme: light)')` live. An inline script in `index.html` applies the saved theme before first paint (no flash). Update `color-scheme` and `meta[name=theme-color]`.
- An "Appearance" section in ProfileDialog.
- **Audit hard-coded colour classes** that assume dark: `text-white`, `bg-black/*`, `shadow-black/*`, `ring-white/*`, plus inline hex. Replace them with semantic tokens (`--c-on-brand`, `--c-overlay`). Expect about 10–15 components.

## Acceptance criteria
- [ ] Every text/background pair listed in the PR reaches ≥ 4.5:1 in light mode (body, muted, hints, links, mentions, buttons, danger).
- [ ] No flash of the dark theme on load in light mode (hard reload with throttled CPU).
- [ ] `system` mode follows an OS theme change without a reload.
- [ ] Manual visual pass of login, setup wizard, chat, DMs, settings, dialogs, voice stage and lightbox in both themes.

## Expected Areas of Change
`web/src/index.css`, `web/index.html`, new `web/src/theme.js`, `web/src/main.jsx`, `web/src/components/ProfileDialog.jsx`, and the audited components (~10–15 files, mostly one-line class swaps).

## Working Set / Blast Radius
High fan-out but shallow edits. Run it in a quiet window.
