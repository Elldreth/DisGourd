# P3-05 — Accessible message actions: keyboard navigation, "…" menu, long-press

- **Unit Type:** Implementation
- **Phase:** 3 — "Message actions only appear on hover" (`MessageList.jsx:270`)
- **State:** READY
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
- [ ] Keyboard-only: Tab into the list, use arrows to reach a message, Enter, choose React, pick 👍. The reaction lands and focus returns to the row.
- [ ] On a touch device or emulator, long-press opens the sheet, and Edit, Delete and React work. A normal scroll doesn't trigger it.
- [ ] Screen readers announce each row as "author, time, content".
- [ ] Hover behaviour on desktop is unchanged.
- [ ] Composer focus isn't stolen by live messages arriving.

## Expected Areas of Change
`web/src/components/MessageList.jsx`, and new `web/src/components/MessageActions.jsx`.

## Working Set / Blast Radius
2 files. MessageList affects every message row (the hot file).
