# P2-17 — Light theme + theme picker (Dark / Light / System)

- **Unit Type:** Implementation
- **Phase:** 2, rank 9 (slice 2)
- **State:** COMPLETE (merged in #71)
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
- [x] Every text/background pair listed in the PR reaches ≥ 4.5:1 in light mode (body, muted, hints, links, mentions, buttons, danger).
- [x] No flash of the dark theme on load in light mode. (Checked structurally and by unit test, not by a throttled hard reload, which the preview pane can't do: `theme-init.js` is a classic blocking script in `<head>` ahead of the stylesheet and app, so `data-theme` is set before first paint.)
- [x] `system` mode follows an OS theme change without a reload.
- [ ] Manual visual pass of login, setup wizard, chat, DMs, settings, dialogs, voice stage and lightbox in both themes. **Partly:** login, loading screen, chat, DMs, settings, channel settings dialog, search, emoji picker and voice panel checked in light (screenshots + a rendered-contrast audit); setup wizard, video stage and lightbox not opened (the lightbox and video tiles are dark overlays by design in both themes).

## Expected Areas of Change
`web/src/index.css`, `web/index.html`, new `web/src/theme.js`, `web/src/main.jsx`, `web/src/components/ProfileDialog.jsx`, and the audited components (~10–15 files, mostly one-line class swaps).

## Working Set / Blast Radius
High fan-out but shallow edits. Run it in a quiet window.

## Evidence
| Check | Result |
|---|---|
| `theme.contrast.test.js`: 53 text/background pairs per theme read from `index.css` (gray-100…500, fg, brand-hi, online, pink, danger, idle on ink-700/800/600/900; white on brand + hover; ink-900 on danger and danger/80 (Leave); @mention, @you, own reaction, mention row, notice tint) | all >= 4.5:1 in **both** themes (106 checks) + every themed colour has a light override |
| Light palette tuning | first pick failed one pair: ink-900 text on the `bg-danger/80` Leave button (3.67); pink/danger darkened to `#9A1052` -> 4.64 |
| Rendered-contrast audit in the browser (real composited backgrounds, every text element on screen), light theme | chat 68, settings 273 (3 scroll positions), emoji picker 147, search 70, voice panel 78, channel settings 78, DMs 61: one real failure, the code-block "JS" / "Copy" header (2.98) -> own `--code-muted` (gray-500 in light, unchanged in dark) -> pass. Remaining hits are spoilers (hidden on purpose) and avatar/server initials (see Discovered Work) |
| `theme.test.js` (12): default dark, bad stored value ignored, setTheme saves + applies + updates `theme-color`, system resolves from the OS, OS change applies live in system mode only, watcher removable; `theme-init.js` agrees with theme.js for 5 saved/OS combinations | pass (failed first) |
| `AppearanceSettings.test.jsx` (1): shows the saved choice; picking applies and saves | pass (failed first) |
| Sandbox: Light in Settings -> `data-theme=light`, `color-scheme: light`, `theme-color` #EAE5F7; "Match my system" + emulated OS light/dark switched the page both ways without a reload | pass |
| Dark theme unchanged | by construction: `--color-fg` is `#ffffff`, so every `text-white` -> `text-fg` swap (and `bg-fg`, `ring-fg/70`) computes the same; markdown tints use `color-mix(fg …)` = the old `rgb(255 255 255 / …)`; `--code-bg` / `--code-muted` keep the old values in dark |
| Full suite / build / audit | web 278/278, build ok, `npm audit` 0. CSS 52.15 -> 53.55 kB (10.24 kB gzip) |

## Implementation notes
- Light palette is `[data-theme='light']` in `index.css`, overriding the `@theme` variables. Brand violet, its hover and the logo violet are the same in both themes; `brand-hi` (text violet), lime/online, pink/danger and idle are darkened for light.
- New token `--color-fg` (white / near-black) for the strongest foreground. Audit: 29 `hover:text-white` -> `hover:text-fg` (icon hovers on neutral surfaces); `text-white` -> `text-fg` for the active channel, active voice channel, unread DM, push-to-talk key, open emoji button, your own reaction, your @mention; server-rail pill `bg-white` -> `bg-fg`, drop ring `ring-white/70` -> `ring-fg/70`, DM home button's logo follows the text colour. Kept white: text on brand / danger fills and hovers, photos, the lightbox and video tiles, avatars. Kept black: modal scrims (`bg-black/50–70`) and header shadows, which work on light too.
- `public/theme-init.js` (not inline, so a future Content-Security-Policy won't block it) + `src/theme.js` (getTheme / setTheme / applyTheme / watchSystemTheme); `main.jsx` applies and watches. Appearance section in Settings above Notifications.
- `--code-bg`, `--code-muted` for markdown code blocks; quote and code borders use `color-mix(var(--color-fg) …)`.
- Tests were written first and seen failing for theme.js, theme-init.js, AppearanceSettings and the contrast table.

## Not verified
- A throttled hard reload in light mode (no flash) on a real browser.
- Setup wizard, video stage, lightbox screens in light (see AC 4).
- Firefox / Safari; real OS theme switching (emulated in the pane).

## Discovered Work
- ~~**Avatar and server-icon initials** below AA (2.9–3.2:1)~~: fixed on `claude/avatar-initials-contrast` (user request after #71). `avatarColor(hue)` keeps `hsl(h 45% 45%)` and lowers lightness only as far as needed for white text to reach 4.5:1: 179 of 360 hues unchanged, yellows / greens / teals go to 33–44%. A test checks all 360 hues; in the sandbox sandy 2.92 -> 4.59, bob 3.01 -> 4.72, server "ST" 3.23 -> 4.55 in both themes.
- **The full-colour gourd logo** (loading screen, login) has a lime leaf that is faint on the light background. It's brand art with fixed colours, so it's left for a design decision (e.g. a darker leaf in light mode).
