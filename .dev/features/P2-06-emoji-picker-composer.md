# P2-06 — Full emoji picker with search + emoji button in the composer

- **Unit Type:** Implementation
- **Phase:** 2, rank 4 (part 1)
- **State:** READY
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
- [ ] Main chunk grows by under 8 KB gzip. Emoji data is a separate chunk loaded on first open (check the build output).
- [ ] Searching "fire" shows 🔥 and "thumbs" shows 👍. The keyboard alone can open, search, pick and close.
- [ ] The emoji goes in at the caret, and the caret ends up after it.
- [ ] Picked emoji appear in Recent across reloads.

## Expected Areas of Change
New `web/src/components/EmojiPicker.jsx`, new `web/src/emoji.js` (loader and search), `web/src/components/Composer.jsx`, `web/package.json`/lockfile.

## Working Set / Blast Radius
3–4 files.
