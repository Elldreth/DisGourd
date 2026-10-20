# P7-02 — Keyboard shortcuts sheet (Ctrl+/) and shortcut hints in tooltips

- **Unit Type:** Implementation
- **Phase:** 7 (UX review follow-ups)
- **State:** COMPLETE (merged #172)
- **Effort:** S
- **Depends on:** none
- **Serialize with:** P7-04 if both touch `App.jsx` (they touch different lines)
- **Requirement Source:** `design/UX-REVIEW-2026-10.md` F4; recorded as a follow-up in `P4-00`.

## Scope
- **A "Keyboard shortcuts" sheet** (a small `Modal` in the settings-kit style) listing every shortcut the app has today, grouped:
  - **Navigation:** Ctrl/⌘+K quick switcher; Ctrl/⌘+Shift+K new direct message; Alt+↑/↓ previous/next channel; Alt+Shift+↑/↓ previous/next unread channel.
  - **Messages:** ↑ in an empty message box edits your last message; Esc cancels an edit.
  - **Voice:** Ctrl+Shift+M mute, Ctrl+Shift+D deafen; push-to-talk (the key set in Voice & audio).
- **Where it opens from:**
  - **Ctrl/⌘+/**: added to `shortcuts.js` as action `'help'`. Like the others, it works from inside the message box, and not while another dialog is open.
  - **"Keyboard shortcuts"** in the status menu, next to Settings.
- **The single list:** one exported list in `shortcuts.js` feeds the sheet, so the two can't drift apart.
- **Hints in tooltips:** buttons that have a shortcut get it in their tooltip, in the "Name · Ctrl+K" style, for example the quick-switcher / "Find a conversation" button, "New message" in DMs, and Mute/Deafen in the voice panel. The accessible names don't change; only `title` does.
- **⌘ instead of Ctrl on a Mac**, picked from `navigator.platform`.

## Acceptance criteria
- [x] AC-1: Ctrl+/ opens the sheet from anywhere, including the message box; Esc closes it. It doesn't open while another dialog is open.
- [x] AC-2: "Keyboard shortcuts" in the status menu opens the same sheet.
- [x] AC-3: the sheet lists exactly the shortcuts in the exported list, grouped, with ⌘ on a Mac.
- [x] AC-4: the buttons listed above show their shortcut in the tooltip, and their accessible names are unchanged. *(Found already done: see the notes.)*
- [x] AC-5: web tests (`ShortcutsSheet.test.jsx`, plus a `shortcuts.test.js` case for Ctrl+/). The suite stays green.
- [x] AC-6: a sandbox check with screenshots of the sheet.

## Expected Areas of Change
`web/src/shortcuts.js`, a new `web/src/components/ShortcutsSheet.jsx`, `App.jsx` (open state), `UserFooter.jsx` (status menu item), and the tooltips in `DmSidebar.jsx`, the voice panel in `ChannelList.jsx` and the switcher button. Plus tests.

## Out of Scope
Rebinding shortcuts, and new shortcuts.

## Starting Baseline
Revision: `ee16b7e` (main after #168).

## Implementation notes
- **Ctrl/⌘+/:** `matchShortcut` returns `'help'` for Ctrl/⌘ plus `/`, without Shift or Alt. App opens `ShortcutsSheet` on it; `useShortcuts` already ignores navigation while a modal is open.
- **The single list:** `SHORTCUT_GROUPS` and `keyNames` live in `shortcuts.js`. The sheet renders from them, and adds a push-to-talk row with the key you set (or "Off · set it in Voice & audio"). On a Mac it shows ⌘ ⌥ ⇧. Voice stays Ctrl, because that's what it listens for.
- **The status menu:** a "Keyboard shortcuts" item above Sign out, with a Ctrl+/ hint, in both footers (servers and DMs).
- **Tooltips were already there:** New message (Ctrl+Shift+K) and Mute/Deafen (Ctrl+Shift+M/D) already had their shortcut in the tooltip. Ctrl+K has no button to hint on. So the tooltip part needed no change; the sheet is where Ctrl+K becomes discoverable.
- **Fixed in passing:** the status menu was 8 px wider than its 240 px column (`left-2` + `w-60`), so its right edge was clipped. That only became visible with the new right-aligned hint (`design/p6-actions/shots/p7-02-menu-clipped-before.png`). It now spans the column (`left-2 right-2`).

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | Vitest `shortcuts.test.js` + sandbox | Ctrl+/ and ⌘+/ match; not with Shift, Alt or no modifier. It works from inside the message box, and does nothing while a modal is open. Sandbox: a real Ctrl+/ in the message box opened the sheet (`design/p6-actions/shots/p7-02-sheet.jpg`), and Esc closed it. |
| AC-2 | Verified | Vitest `ShortcutsSheet.test.jsx` + sandbox | The menu item calls `onOpenShortcuts` and closes the menu. Sandbox: clicking it opened "Keyboard shortcuts" (`p7-02-status-menu.png`). |
| AC-3 | Verified | Vitest | Every group and item in `SHORTCUT_GROUPS` is rendered, with `keyNames` keys. Ctrl off a Mac; ⌘ ⇧ K on a Mac, with voice still Ctrl. The push-to-talk row shows Off, or the set key. |
| AC-4 | Verified (already there) | Code read | `DmSidebar.jsx:34` "New message (Ctrl+Shift+K)"; `ChannelList.jsx` Mute/Deafen include Ctrl+Shift+M/D. |
| AC-5 | Verified | Vitest, Vite | 1 new case in `shortcuts.test.js` and 5 tests in `ShortcutsSheet.test.jsx`. Web 95 files / 747 tests green. `vite build` clean. |
| AC-6 | Verified | Sandbox (a fresh install on :3008, this branch's code) | The sheet and the status menu, as above. No console errors. |
