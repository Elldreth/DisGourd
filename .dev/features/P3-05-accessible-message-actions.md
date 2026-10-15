# P3-05 — Accessible message actions: keyboard navigation, "…" menu, long-press

- **Unit Type:** Implementation
- **Phase:** 3 — "Message actions only appear on hover" (`MessageList.jsx:270`)
- **State:** REVIEW (PR open)
- **Effort:** M
- **Depends on:** none
- **Serialize with:** MessageList.jsx units. **Do this early**: P1-10, P2-07, P2-09, P2-13, P3-09 and P3-12 all add items to the menu it creates.
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 3. Revalidated: the toolbar is `hidden ... group-hover:flex`, which keyboard and touch users can't reach.

## Scope
- Extract the toolbar into a new `web/src/components/MessageActions.jsx` with an `actions` array: `{ id, label, icon, onSelect, danger, visible }`. Today's items are React, Edit, Delete and **Copy text** (new). Later units append Reply, Pin and moderator Delete.
- Keyboard:
  - The message list becomes `role="log"`. Each message row is focusable with a **roving tabindex**, so the list is a single tab stop.
  - Up and Down move between messages.
  - When a row has focus, the toolbar is visible (`group-focus-within:flex`).
  - Enter, or the "…" button, opens a menu (`role="menu"`, arrow keys, Esc returns focus to the row).
  - `E` edits your own message; Delete/Backspace deletes it, still with `window.confirm` until P3-09.
- Touch:
  - long-press (≥ 450ms, < 10px movement) on a row opens a bottom action sheet with the same actions
  - the hover toolbar is suppressed on `(hover: none)` devices
- Desktop right-click on a row opens the same menu (optional, cheap once the menu exists).

## Acceptance criteria
- [x] Keyboard-only: Tab into the list, use arrows to reach a message, Enter, choose React, pick 👍. The reaction lands and focus returns to the row.
- [x] On a touch device or emulator, long-press opens the sheet, and Edit, Delete and React work. A normal scroll doesn't trigger it.
- [x] Screen readers announce each row as "author, time, content".
- [x] Hover behaviour on desktop is unchanged.
- [x] Composer focus isn't stolen by live messages arriving.

## Expected Areas of Change
`web/src/components/MessageList.jsx`, and new `web/src/components/MessageActions.jsx`.

## Working Set / Blast Radius
2 files. MessageList affects every message row (the hot file).

## Activation
- Activated 2026-10-15 on branch `claude/p3-05-message-actions`, cut from main @ 1a3e568.

## Implementation notes
- `MessageActions.jsx` exports `MessageToolbar`, `ActionMenu` (popover or bottom sheet) and `ReactionPicker`, all driven by one `actions` array built in `MessageRow`. `quick` items also get a toolbar button. Later units append items to that array.
- **Small scope addition:** `Icon.jsx` gains `copy` and `more` (…) icons. Both are needed by the new items, and the change is icon-only.
- The toolbar is visible on `[@media(hover:hover)]:group-hover`, on keyboard focus (`group-focus-visible`), and while its popover is open. Mouse clicks that focus a row don't pin it open.
- Popovers near the bottom of the scrolling list open **upward**, so they aren't clipped. This was found during verification.
- Long-press: 450ms, 10px slop. The click after it is swallowed. The swallow flag clears 50ms after lift, so browsers that send no click (they show a native context menu instead) don't eat the first tap in the sheet. This was found during verification.
- Focus returns to the row after a popup or edit closes, but only if focus is still on the row, on the body or inside the row. It never pulls focus out of the composer.
- `window.confirm` for delete is kept until P3-09.

## Verification (AC → evidence)
| AC | Evidence |
|---|---|
| Keyboard-only react | Sandbox, real key presses: Shift+Tab ×2 from the composer lands on the list's single tab stop (newest message). ↑ moves to the previous message. Enter opens the menu (focus on "Add reaction"). Enter opens the picker (focus on 👍). Enter: 👍 is applied and focus returns to the row. A second run used →→→ to pick 🎉. |
| Touch long-press | Phone preset (`hover: none` true), touch-type pointer events. A drag of 30px opens nothing. A 120ms tap opens nothing. Holding 550ms opens a bottom sheet (Add reaction / Edit / Copy / Delete). Add reaction leads to an emoji sheet, and 🔥 is applied. Edit opens the focused edit box. Delete removed a throwaway message (confirm stubbed for the check). The hover toolbar is `display: none` on touch. |
| Screen-reader label | Rows are `role="article"` with `aria-label` like "sandy, 12:57 AM, gateway split check". The list is `role="log"` ("Messages in #general"). Reaction chips read "👍 1, you reacted" with `aria-pressed`. |
| Desktop hover unchanged | Hovering shows the toolbar (react / edit / delete, plus the new …). "…" on the bottom message opens upward, all 4 items visible. Esc closes it and focus returns to the row. |
| Composer focus not stolen | With the composer focused, a message sent from a second session arrived: focus stayed in the composer, and no focusin/focusout events fired. |
| (extra) DMs | The DM list is `role="log"` "Messages". The menu has Edit / Copy / Delete and no React (no `onReact` in DMs). No React or TypeError console errors. |
