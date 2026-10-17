# P1-21 — Tailwind 4, with the theme as CSS variables (absorbs P2-16)

- **Unit Type:** Implementation
- **Phase:** 1 (ops: last npm audit findings) + 2 rank 9 slice 1 (P2-16)
- **State:** ACTIVE
- **Effort:** M
- **Depends on:** P1-18 (Vite 8, merged in #69)
- **Serialize with:** anything editing `web/src/index.css`, `tailwind.config.js`, `web/package.json`, or class names across components (the upgrader touches many files)
- **Requirement Source:** P1-18 Discovered Work (7 audit findings in Tailwind 3's dependency chain, 5 high); P2-16; user request 2026-10-16 ("plan and do the Tailwind 4 migration together with P2-16")
- **Starting baseline:** main at 07e1945 (after #69)

## Why together
Tailwind 4 defines the theme in CSS (`@theme`) and emits every colour as a CSS variable (`--color-brand`, `--color-ink-900`, …) that utilities read at runtime, with opacity modifiers done by `color-mix()`. That is P2-16's goal, so P2-16's planned `rgb(var(--c-…) / <alpha-value>)` workaround for Tailwind 3 is unnecessary. P2-17 (light theme) will override these `--color-*` variables.

## Scope
- `tailwindcss` 3.4 -> 4.3.3 via `@tailwindcss/vite` 4.3.3 (Vite plugin). Remove `postcss.config.js`, `autoprefixer` and the direct `postcss` dependency if nothing else needs them (Tailwind 4 prefixes via Lightning CSS).
- Move `tailwind.config.js` into `src/index.css` `@theme`: the `ink`, `gray` (overriding the listed shades only, as `extend` did), `brand` (+ hover, hi, logo, soft), `lime`, `pink`, `online`, `idle`, `danger` colours and the `sans` / `display` fonts. Delete `tailwind.config.js`.
- `theme('colors.…')` in `index.css` -> `var(--color-…)`; `theme('colors.brand.DEFAULT / 45%')` -> `color-mix()`.
- Class renames across components with the official `@tailwindcss/upgrade` 4.3.3, then review its diff.
- Keep v3's look where v4 changed defaults (border colour, ring width/colour, placeholder colour, button cursor) unless the diff shows they're unused.
- `Gourd.jsx` keeps its hex logo colours (brand art, not theme).

## Non-goals
The light theme (P2-17). Any intentional visual change.

## Acceptance criteria
- [ ] `npm audit --prefix web`: 0 high, 0 critical.
- [ ] No visual change: computed styles (colours normalised to pixel values, sizes, spacing, borders, radii, shadows, fonts) of every element on login, server chat (with code block, mention, reactions), DMs, settings, emoji picker and the voice panel are identical before and after, apart from documented sub-pixel/anti-aliasing noise. Before/after screenshots in the PR.
- [ ] Changing `--color-brand` in devtools recolours buttons live.
- [ ] Web tests and build pass; main JS chunk within ±10%; CSS size noted.

## Expected Areas of Change
`web/package.json` + lockfile, `web/vite.config.js`, `web/src/index.css`, delete `web/tailwind.config.js` and `web/postcss.config.js`, class renames in `web/src/components/*.jsx` (upgrader).

## Working Set / Blast Radius
Every styled element depends on it. The computed-style diff is the gate.
