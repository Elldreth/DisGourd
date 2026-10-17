# P3-11 — Ctrl+K quick switcher + Alt+↑/↓ channel navigation

- **Unit Type:** Implementation
- **Phase:** 3 — "Keyboard shortcuts"
- **State:** COMPLETE
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
- [x] Ctrl+K, type "gen", Enter: lands in #general of the top-ranked server.
- [x] Alt+↓ cycles channels and wraps around. It works while the composer has focus.
- [x] Ctrl+K inside a text field doesn't trigger the browser's search bar.
- [x] Voice shortcuts still work.

## Expected Areas of Change
New `QuickSwitcher.jsx`, new `shortcuts.js`, `App.jsx` (mount and navigation wiring).

## Working Set / Blast Radius
3 files.

## Evidence
Baseline: main at bb237e5 (after P3-04). Branch `claude/p3-11-quick-switcher`.

| Acceptance criterion | Evidence |
|---|---|
| Ctrl+K, "gen", Enter lands in #general of the top-ranked server | `QuickSwitcher.test.jsx`: ranking (a better match first, then mentions, unread, recent, server order) and "type and press Enter". Sandbox: Ctrl+K from the composer opened "Quick switcher" with focus in the box; "gen" listed #general for Smoke Test and Tx Check; Enter (and ↓ Enter) went there. |
| Alt+↓ cycles and wraps, works with the composer focused | `shortcuts.test.js` (stepChannel wraps; the handler runs before a focused textarea sees the key). Sandbox, composer focused: Alt+↓ ×5 went general → random → history → made-offline → second-offline → general; Alt+↑ wrapped to second-offline. Focus stayed in the composer and "edit last message" did not open. |
| Ctrl+K in a text field doesn't trigger the browser's search | Unit test (defaultPrevented). Sandbox: real Ctrl+K presses inside the composer came through `defaultPrevented: true`, also while the switcher was already open. |
| Voice shortcuts still work | `matchShortcut` returns null for Ctrl+Shift+M/D (unit test), and the PTT key has no modifier rules here. Sandbox: a real Ctrl+Shift+M passed through untouched (`defaultPrevented: false`). **Not checked inside a live call:** the Browser pane blocks the mic. |

Also checked: DMs are listed without opening the DM view first. With no query, an unread DM came first, then recent channels. "bo" + Enter opened the DM with bob.

Web tests: 356 pass (11 new). Build clean.

### Notes
- Shortcuts listen on window in the capture phase and stop the event, so Alt+↑ never reaches the composer (where ↑ means "edit last message"). While any modal dialog is open nothing navigates; Ctrl+K is still kept from the browser.
- Alt+Shift+↑/↓ jumps to the previous/next unread or mentioned channel *in the current server*. It does nothing when there are none.
- Recent places are stored per user in localStorage (`disgourd.recent.<id>`, the last 10).
- The optional settings cheat-sheet row was not done. The switcher footer shows the keys instead.
