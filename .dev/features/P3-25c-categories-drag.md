# P3-25c — Drag and drop channels and categories

- **Unit Type:** Implementation (child of P3-25)
- **Phase:** 3
- **State:** REVIEW
- **Starting baseline:** main at 0a31ace (#145 merged)
- **Effort:** S–M
- **Depends on:** P3-25b

## Scope
- **Managers can drag** a channel (within a category, to another category, or to the uncategorized top) and drag a category heading to reorder categories.
- **During the drag,** a drop line shows where it will land, and an empty or collapsed category accepts drops on its heading.
- **On drop,** one `PUT /layout` with the new order. The list updates immediately and is put back if the server refuses.
- **Pointer-based**, so a mouse or pen works. On touch screens dragging starts only from a small handle shown in an "Arrange" mode; otherwise phones use b's menus. Esc cancels a drag.

## Acceptance criteria
- [x] Web: the layout sent for dropping within a category, across categories, and to the uncategorized area; dragging a category; Esc cancels; non-managers can't drag; a refusal puts the list back.
- [x] Sandbox: drag a channel into another category and reorder categories; a second user sees it.

## Implementation notes
- **Mouse and pen only.** On phones and touch screens dragging is off: the Move menus from P3-25b cover them. The "Arrange mode" handle for touch was left out (recorded below).
- **Drop maths are plain functions in `channelLayout.js`** (`dropChannel`, `dropCategory`, `channelDropTarget`, `categoryDropIndex`), working on page positions read from `data-drop-row` / `data-drop-heading` / `data-drop-section` elements.
- **A drag starts after 5 px.** Esc cancels it, and the click that ends a drag is swallowed, so it neither opens the channel nor collapses a heading.
- **The drop line is drawn over the gap and takes no room.** In the live check, a line that took space pushed rows down mid-drag and the drop landed one place early; that's fixed.

## Evidence (2026-10-18)
| Acceptance criterion | Evidence |
|---|---|
| Web | `channelLayout.test.js` (9, 3 new): channel drops within a category (indices as shown, no-ops null), into an empty category, to the top, clamped; category drops before another, never above the top; drop targets from heights (row halves, heading halves, below everything) and category indices. `ChannelCategories.test.jsx` (8, 3 new): a manager drags general onto lounge's lower half → one line shown, layout sends Voice [lounge, general] and Text [news, memes], and the trailing click doesn't select; dragging the Voice heading above Text sends categories [2, 1, 3]; Esc cancels (no line, nothing sent); a 2 px wobble stays a click (`onSelect('news')`); members and touch can't drag |
| Suites | Web: 76 files, 641 tests. `vite build` clean |
| Sandbox | Tx Check, sandy, 1100×750 viewport, real mouse drags: #staff from Text channels to below lounge → "Voice channels: lounge staff" (the first try, before the drop-line fix, landed above lounge), with the open channel still #random; dragging the "Voice channels" heading above "Text channels" reordered them, and both stayed expanded. The layout was restored afterwards. Live updates to other members use the same PUT /layout as P3-25b's two-user check |

## Discovered Work
- A touch "Arrange mode" (drag handles on phones) wasn't built; phones use the Move menus. Add it if wanted.
