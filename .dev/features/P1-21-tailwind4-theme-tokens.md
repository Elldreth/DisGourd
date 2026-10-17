# P1-21 — Tailwind 4, with the theme as CSS variables (absorbs P2-16)

- **Unit Type:** Implementation
- **Phase:** 1 (ops: last npm audit findings) + 2 rank 9 slice 1 (P2-16)
- **State:** REVIEW (PR open)
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
- [x] `npm audit --prefix web`: 0 high, 0 critical. (0 findings at all.)
- [x] No visual change: computed styles (colours normalised to pixel values, sizes, spacing, borders, radii, shadows, fonts) of every element on login, server chat (with code block, mention, reactions), DMs, settings, emoji picker and the voice panel are identical before and after, apart from documented sub-pixel/anti-aliasing noise. Before/after screenshots in the PR. (The element-level computed-style diff below replaced pixel screenshots as the gate: browser-pane screenshots are lossy JPEGs and scaled, so they can't show 1px shifts; spot screenshots were checked.)
- [x] Changing `--color-brand` in devtools recolours buttons live.
- [x] Web tests and build pass; main JS chunk within ±10%; CSS size noted.

## Expected Areas of Change
`web/package.json` + lockfile, `web/vite.config.js`, `web/src/index.css`, delete `web/tailwind.config.js` and `web/postcss.config.js`, class renames in `web/src/components/*.jsx` (upgrader).

## Working Set / Blast Radius
Every styled element depends on it. The computed-style diff is the gate.

## How the "no visual change" gate worked
A small in-page script recorded, for every visible element on each screen, its rect and ~40 computed properties (colours turned into actual RGBA pixel values via a 1px canvas, so `#7444f0`, `rgb(...)` and `color-mix(...)` compare equal when they render the same). Baseline taken on the Tailwind 3 build (main at 07e1945), then diffed against the Tailwind 4 build after a reload, same data, same 1100x760 viewport. A repeat capture on unchanged code gave 0 differences (no noise).

Treated as equal because they render identically: `rounded-full` 9999px vs v4's `calc(infinity)`; identity `transform` vs `none` (v4 uses the `translate` property); extra zero-size box-shadow layers (v4 adds transparent ring layers; v3 had a zero-width white ring-offset layer); v3 `outline-none` (2px transparent) vs v4 `outline-hidden` (none); `space-y-*` moving the gap from margin-top to margin-bottom (all rects identical).

## Evidence
| Check | Result |
|---|---|
| Computed-style diff, 6 screens / 3,416 elements: login 20, chat (code block, mention, quote, spoiler, member list) 202, DMs 513, settings 293, emoji picker 2,166, voice panel 222 | first run: buttons lost the pointer cursor (v4 preflight change), 41 elements on chat alone -> fixed with v3's rule (`button, [role=button] { cursor: pointer }`, `:disabled { cursor: default }`). After the fix: **0 differences** on login, chat, DMs, settings, emoji; voice: 1, the line-height inside a 20px avatar's initials (20px -> 10.86px, below) |
| Avatar initials line-height | v4's `text-sm` passes line-height down as a ratio, not a fixed 20px; the avatar sets its own font size inline, so its line box shrinks. The initials stay flex-centred in the same 20px circle (rect unchanged). Every other font-size-only class (`text-[10px]`/`[11px]`) was checked: none sits under a `text-*` ancestor where the line box could move anything |
| `npm audit` | 7 (5 high, 2 moderate) -> **0** |
| Live theme variables | setting `--color-brand` on `:root` turned the Sign in button green (after its 0.15 s transition); removing it restored violet |
| Built CSS | no `theme()` or `<alpha-value>` left; 37.42 -> 52.15 kB (7.93 -> 9.92 kB gzip): v4 ships the theme variables, cascade layers and `@property` rules |
| Main JS | 306.57 -> 306.71 kB (93.28 -> 93.29 kB gzip) |
| Build time | ~0.6 s -> ~0.18 s |
| Web tests | 159/159 |
| Linux native binaries in the lockfile (CI / Docker run `npm ci` / `npm install` on Linux) | `@tailwindcss/oxide-linux-x64-*`, `lightningcss-linux-x64-*`, `@rolldown/binding-linux-x64-*` present |

## Implementation notes
- Ran `@tailwindcss/upgrade@4.3.3`: it moved the config into `@theme`, renamed classes in 20 files (`rounded`->`rounded-sm`, `outline-none`->`outline-hidden`, `shadow-sm`->`shadow-xs`, `[&_*]:`->`**:`, `break-words`->`wrap-break-word`, `!x`->`x!`, …) and added v3's default border colour as a base rule.
- **The upgrader also broke code:** it renamed the `'blur'` event in `useVoiceCall.js` (`removeEventListener('blur', …)`) to `'blur-sm'`, which would leave push-to-talk's window-blur listener attached. That file was reverted, and every other changed line in .js/.jsx was checked to be a class string.
- Switched from the upgrader's PostCSS setup to `@tailwindcss/vite`; removed `postcss.config.js`, `postcss`, `autoprefixer` and `@tailwindcss/postcss`.
- By hand: restored the palette comments in `@theme`; took `:root` back out of the utilities layer the upgrader put it in; `::selection` uses `color-mix()` (v4 has no `theme('… / 45%')`).
- Theme variables are named `--color-*` (Tailwind's names) rather than P2-16's planned `--c-*`; P2-17 overrides these.

## Not verified
- Hover / focus / active states beyond the default cursor (the diff captures resting state; the hover styles are the same class names, renamed one-for-one).
- Screens not captured: setup wizard, server settings dialogs, lightbox, video stage, search overlay. They use the same renamed utilities.
- Firefox / Safari.
