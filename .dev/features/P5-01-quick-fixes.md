# P5-01 — Quick fixes: image overflow and member menu dismissal

- **Unit Type:** Implementation (child of P5-00)
- **Phase:** 5
- **State:** REVIEW (PR open, 2026-10-19)
- **Effort:** S
- **Depends on:** none
- **Serialize with:** P5-05 (`MemberList.jsx`)
- **Requirement Source:** `design/settings-review-2026-10/REVIEW.md` B1 and M1.

## Scope
- Images in messages (the `/imagine` results and uploaded pictures rendered by the `max-h-80 max-w-md` image button) never get wider than their column: add a column-width cap alongside the 448 px cap.
- The member menu (click a member in the list) closes on Escape and on a click or tap outside it, and returns focus to the member row it came from.

## Acceptance criteria
- [x] AC-1: at 1024×768 with both sidebars open, the message list has no horizontal overflow (`scrollWidth <= clientWidth`) on a channel with a generated image.
- [x] AC-2: at 375×812 a generated image fits the screen width; the page has no horizontal scroll.
- [x] AC-3: with the member menu open, Escape closes it and focus returns to that member's row.
- [x] AC-4: a mousedown outside the menu (and outside its member row) closes it; clicking inside it does not.
- [x] AC-5: tests cover AC-3 and AC-4; existing MemberList and MessageList suites stay green.

## Expected Areas of Change
`web/src/components/MessageList.jsx` or `Attachment.jsx`/`Album.jsx` (wherever the `max-w-md` image class lives), `web/src/components/MemberList.jsx`, tests.

## Working Set / Blast Radius
3–4 files. Class change plus one effect.

## Testing Strategy
Vitest + Testing Library for the menu; a sandbox check at both widths for the overflow (jsdom has no layout).

## Out of Scope
The menu's new header and grouping (P5-05).

## Starting Baseline
Revision: `99c7991` (main after #157), plus #158 (the review and packets) which this branch is cut from. Web suite before: 81 files / 678 tests.

## Implementation notes
- Images: `max-w-md` (448 px) became `max-w-[min(28rem,100%)]` on the single picture and video (`Album.jsx`), the picture grid, the spoiler picture and the file card (`Attachment.jsx`). The spoiler wrappers, which are `w-fit`, also got `max-w-full`. On wide screens nothing changes.
- Member menu: one effect in `MemberList.jsx` while a menu is open. A `mousedown` outside the row-and-menu wrapper closes it. Escape is caught in the capture phase on `document` and stopped there, so on a phone it closes only the menu and the drawer stays open; a second Escape closes the drawer as before. Focus goes back to the member's row.

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | Sandbox (sandbox server :3005, a dev server on this worktree at :5175), 1024×768 | Tx Check #general with the fox image: no scroll container overflowing (it was 524/478 before the fix). `shots/p5-01-desktop-image-fits.jpg` |
| AC-2 | Verified | Sandbox at 375×812 | `document.documentElement.scrollWidth` 375 = viewport, no overflowing container; the whole fox is visible (before, it was cut off at the right edge: `shots/15-phone-image-overflow.jpg`). `shots/p5-01-phone-image-fits.jpg` |
| AC-3 | Verified | Sandbox + `QuickFixes.test.jsx` | Desktop: open bob's menu, Escape, menu gone, focus on bob's row. Phone: same inside the member drawer, and the drawer stays open (`shots/p5-01-phone-member-menu.jpg` shows the menu inside the drawer) |
| AC-4 | Verified | Sandbox + test | A click in the message area closes the menu; a mousedown inside it doesn't (test) |
| AC-5 | Verified | Vitest, Vite | `QuickFixes.test.jsx`: 7 tests (the menu and spoiler tests failed before the fix). Full web suite 82 files / 685 tests green; `MemberList.test.jsx` unchanged and green; `vite build` clean |
