# P4-00 — "Shine": polish round from the October 2026 UX review

- **Unit Type:** Container (children P4-01 … P4-07)
- **Phase:** 4 (design polish)
- **State:** PLANNED
- **Effort:** 7 units, three M and four S
- **Depends on:** nothing merged after #100 is required
- **Requirement Source:** `design/UX-REVIEW-2026-10.md` (the prioritised list at the end). Published copy: the "DisGourd UX Review" artifact.

## Goal
Take the fifteen findings of the review and ship the ones that change how the app feels for a normal user in its first week: phones that are comfortable to tap, settings you can navigate, empty states with the brand's personality, one-step DMs, calmer link previews, and a handful of hierarchy and accessibility fixes.

## Children
| ID | Title | Size | Review items | State |
|---|---|---|---|---|
| P4-01 | Phone touch targets and header | M | A1, M2 | REVIEW |
| P4-02 | Settings sections | M | F1 | READY |
| P4-03 | Empty states with illustrations | M | V3 (+ kie.ai assets) | READY |
| P4-04 | New message from DMs | S | F2 | READY |
| P4-05 | Calmer link previews | S | V1 | READY |
| P4-06 | Hierarchy and a11y polish | S | V4, F6, V5, V6, V8, A2, A3, A4, V2, V7 | READY |
| P4-07 | Thread panel on phones | S | M1 (+ V8 if P4-06 hasn't landed) | READY |

## Cross-child dependencies and hot files
- All children are independent in scope, but several touch the same files, so they run **one at a time**:
  - `ChatPanel.jsx`: P4-01 (header buttons), P4-06 (landmarks), P4-07 (thread panel back button)
  - `MessageList.jsx`: P4-01 (reaction and chip sizes), P4-06 (timestamps, toolbar), P4-05 (nothing, the card is `Embed.jsx`)
  - `ThreadPanel.jsx`: P4-06 (V8 layout), P4-07 (back affordance)
  - `index.css`: P4-01 (`pointer: coarse` block), P4-06 (small tweaks)
- P4-03 introduces `EmptyState.jsx`; P4-04 should use it for the DM empty state if P4-03 has landed, otherwise edit the text in place (recorded in each packet).

## Integration verification (before the container is COMPLETE)
- A full phone walk (375×812) in the sandbox: sign in, open a channel, open the member drawer, open a thread and go back, open settings and switch sections, start a DM from the DM view, send a link and see the capped preview. No console errors, nothing under 44 px among the header, rows and composer controls.
- Desktop regression: the same walk at 1280×800 looks the same as before except where a packet says otherwise.
- axe-core on the main screen: no violations (down from two moderate).
- Web and server suites pass; `vite build` clean.

## Follow-ups recorded, not planned (from the review)
- F3 Wizard step 4: show the invite link in its own field with "Copy link" (S).
- F4 Keyboard-shortcuts sheet on Ctrl+/ and shortcut hints in tooltips (S).
- F5 Pins/Threads popovers stay open on inner clicks (S).
- M3 `100dvh` shell and `env(safe-area-inset-bottom)` on the composer (S, needs a real phone to verify).
- F7 Channel topics (M, needs a migration and a route).

## Decisions
- Flat illustrations only, in the Neon Calabash palette, readable in one colour: matches the owner's stated preference (flat, works in black and white) and the L4 logo.
- Generated art goes under `design/empty-states/` with the prompt used; only optimised copies ship under `web/public/` or inline SVG, each under 20 KB.
- Nothing here changes the server API except nothing at all: every unit is client-only.
