# P3-11 — Ctrl+K quick switcher + Alt+↑/↓ channel navigation

- **Unit Type:** Implementation
- **Phase:** 3 — "Keyboard shortcuts"
- **State:** PLANNED (READY after P3-01)
- **Effort:** S–M
- **Depends on:** P3-01
- **Soft-depends on:** P1-14 (navigation actions in `useSpaces`, which is cleaner)
- **Serialize with:** App.jsx units
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 3

## Scope
- New `web/src/components/QuickSwitcher.jsx`, built on Modal with the combobox pattern:
  - fuzzy-matches text channels across all servers (`#channel — Server`), servers, and DM partners
  - ranks unread and mentioned items first, then recently visited ones (store the last 10)
  - Enter navigates
- New `web/src/shortcuts.js`, a global keydown listener:
  - Ctrl/Cmd+K opens the switcher (preventDefault, so it works even inside the composer)
  - Alt+↑/↓ moves to the previous/next text channel in the current server
  - Alt+Shift+↑/↓ moves to the previous/next *unread* channel
  - none of these may clash with the existing Ctrl+Shift+M/D voice shortcuts or PTT
- A shortcut cheat-sheet row goes in settings (optional).

## Acceptance criteria
- [ ] Ctrl+K, type "gen", Enter: lands in #general of the top-ranked server.
- [ ] Alt+↓ cycles channels and wraps around. It works while the composer has focus.
- [ ] Ctrl+K inside a text field doesn't trigger the browser's search bar.
- [ ] Voice shortcuts still work.

## Expected Areas of Change
New `QuickSwitcher.jsx`, new `shortcuts.js`, `App.jsx` (mount and navigation wiring).

## Working Set / Blast Radius
3 files.
