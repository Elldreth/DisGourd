# P5-01 — Quick fixes: image overflow and member menu dismissal

- **Unit Type:** Implementation (child of P5-00)
- **Phase:** 5
- **State:** READY (needs no design decision)
- **Effort:** S
- **Depends on:** none
- **Serialize with:** P5-05 (`MemberList.jsx`)
- **Requirement Source:** `design/settings-review-2026-10/REVIEW.md` B1 and M1.

## Scope
- Images in messages (the `/imagine` results and uploaded pictures rendered by the `max-h-80 max-w-md` image button) never get wider than their column: add a column-width cap alongside the 448 px cap.
- The member menu (click a member in the list) closes on Escape and on a click or tap outside it, and returns focus to the member row it came from.

## Acceptance criteria
- [ ] AC-1: at 1024×768 with both sidebars open, the message list has no horizontal overflow (`scrollWidth <= clientWidth`) on a channel with a generated image.
- [ ] AC-2: at 375×812 a generated image fits the screen width; the page has no horizontal scroll.
- [ ] AC-3: with the member menu open, Escape closes it and focus returns to that member's row.
- [ ] AC-4: a mousedown outside the menu (and outside its member row) closes it; clicking inside it does not.
- [ ] AC-5: tests cover AC-3 and AC-4; existing MemberList and MessageList suites stay green.

## Expected Areas of Change
`web/src/components/MessageList.jsx` or `Attachment.jsx`/`Album.jsx` (wherever the `max-w-md` image class lives), `web/src/components/MemberList.jsx`, tests.

## Working Set / Blast Radius
3–4 files. Class change plus one effect.

## Testing Strategy
Vitest + Testing Library for the menu; a sandbox check at both widths for the overflow (jsdom has no layout).

## Out of Scope
The menu's new header and grouping (P5-05).

## Starting Baseline
Revision: `99c7991` (main after #157).
