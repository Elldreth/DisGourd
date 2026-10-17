# P2-06 — Full emoji picker with search + emoji button in the composer

- **Unit Type:** Implementation
- **Phase:** 2, rank 4 (part 1)
- **State:** REVIEW (PR open)
- **Effort:** S–M
- **Depends on:** none
- **Serialize with:** Composer.jsx units (P2-08, P2-09, P3-12), web/package.json units (P1-18, P1-19, P2-02)
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 2 #4. Revalidated: only 8 fixed `REACTION_EMOJIS` in MessageList, and no composer emoji button.

## Scope
- Data: `emojibase-data` (`en/compact.json` plus group metadata), loaded with dynamic `import()` the first time the picker opens. It must not be in the main chunk.
- New `web/src/components/EmojiPicker.jsx`:
  - autofocused search, matching annotation, tags and shortcodes
  - category tabs and a "Recent" row (localStorage, 24 max)
  - a skin-tone selector, which is optional and can be cut
  - keyboard support: arrows move, Enter picks, Esc closes
  - `onPick(emoji)`
  - rendering stays responsive: per-category `content-visibility: auto`, or render only the categories in view
- Composer: a smile button next to Send opens the picker as a popover anchored above it, and inserts the emoji at the caret. Typing `:fire` could suggest emoji inline, but that's a non-goal for this unit.

## Acceptance criteria
- [x] Main chunk grows by under 8 KB gzip. Emoji data is a separate chunk loaded on first open (check the build output).
- [x] Searching "fire" shows 🔥 and "thumbs" shows 👍. The keyboard alone can open, search, pick and close.
- [x] The emoji goes in at the caret, and the caret ends up after it.
- [x] Picked emoji appear in Recent across reloads.

## Expected Areas of Change
New `web/src/components/EmojiPicker.jsx`, new `web/src/emoji.js` (loader and search), `web/src/components/Composer.jsx`, `web/package.json`/lockfile.

## Working Set / Blast Radius
3–4 files.

## Evidence
| Check | Result |
|---|---|
| Bundle: main chunk 92.70 KB -> 94.97 KB gzip (+2.3 KB, limit 8 KB). Emoji data in its own chunks: `compact-*.js` 84.66 KB gzip and `emojibase-*.js` (shortcodes) 31.71 KB gzip; in the sandbox neither was requested before the picker opened, both after | pass |
| `emoji.test.js` (8): loads in Unicode order without regional letters / skin-tone swatches, once; "fire" -> 🔥 first, "thumbs" includes 👍, ":+1:" -> 👍, tag "lit" -> 🔥; empty query -> none; Recent newest-first, no repeats, max 24, bad JSON ignored; `insertAtCaret` (caret, selection, unknown caret) | pass (failed first) |
| `EmojiPicker.test.jsx` (6): search focused on open; type + Enter picks the top match; arrows move the highlight; Esc closes; click picks and shows in Recent next time; "No emoji found" | pass (written with the component, not seen failing first) |
| `Composer.test.jsx` (+2): the Emoji button opens the picker, the pick lands at the caret ("so hot🔥 right now"), the picker closes, focus and caret return after the emoji; Esc closes and refocuses | pass (failed first) |
| Full suite / build | web 159/159, lint clean, build ok |
| Sandbox, keyboard only (real key presses): typed "so hot right now", ArrowLeft x10, Tab to the emoji button, Enter opens with the search focused, typed "fire", Enter -> "so hot🔥 right now", caret 8, focus back in the box | pass |
| Sandbox: after a reload the Recent row shows 🔥; "thumbs" lists thumbs up, thumbs down; no console errors | pass |
| Sandbox at phone width (375 px): the first version hung 40 px off the left edge; anchored to the composer and capped at the screen width it now sits at 39-359 px, no sideways scroll | pass (after fix) |

## Implementation notes
- `emojibase-data` pinned to 17.0.0 (Nov 2025). 18.0.0 was published the same day as this work, so it was skipped as too new to trust yet. Its peer `emojibase` (range `*`) would have auto-installed 18.0.0 too, so `overrides` pins it to 17.0.0; our code never imports it.
- `npm audit` shows 17 findings (2 critical), all in build/test tooling (vite, vitest, tailwind and their deps), none from this unit; they predate it. P1-18 (Vite bump) is where they get addressed.
- Emoji are inserted fully qualified (👍 is 👍 + U+FE0F), as the data provides.
- The picker keeps keyboard focus in the search box (arrows / Enter / Esc there), so it works without tabbing through ~1,900 buttons; every emoji is also clickable.
- Each category uses `content-visibility: auto` so off-screen ones aren't laid out.
- Skin tones were cut (the packet marks them optional). Inline `:shortcode` suggestions remain a non-goal.
- `npm install` reported a held-back install script for esbuild (already present via Vite), not for emojibase-data, which has none. Left as is.

## Not verified
- Firefox / Safari; real touch devices.
- Screen reader announcements of the highlighted emoji (aria-selected on listbox options is set, but not tried with a reader).
