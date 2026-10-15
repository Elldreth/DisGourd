# P2-03 — Unread count in the tab title + favicon dot

- **Unit Type:** Implementation
- **Phase:** 2, rank 2 (part 1 of "Browser notifications, unread count in the tab title and favicon, message sound")
- **State:** READY
- **Effort:** S
- **Depends on:** none
- **Serialize with:** App.jsx units. It adds one hook call; if P1-12..14 are in flight, add the call after they land.
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 2 #2

## Why split rank 2
The title and favicon are passive, need no permission, and don't touch message handlers. Desktop notifications and sounds (P2-04) need settings, a permission flow, and the handler hooks from P1-12/P1-13.

## Scope
- New `web/src/attention.js`:
  - `attentionTitle(base, { mentions, dms, unread })` is a pure function. It returns `"(N) DisGourd"` where N = mentions + DM unread, `"• DisGourd"` when there are only plain unreads, and `"DisGourd"` otherwise.
  - `useDocumentAttention({ mentions, dms, unread })` sets `document.title`. It swaps the `<link rel="icon">` to a canvas-rendered copy of `/favicon-32.png` with a pink (`#FF5FA2`) dot when N > 0, and restores the original otherwise. The canvas work is memoised by N > 0.
- App.jsx: one call that passes the totals App already computes (`spaceMentions`, `totalDmUnread`, `spaceUnread`).

## Acceptance criteria
- [ ] Unit test for `attentionTitle` (needs P1-19; otherwise an inline manual check).
- [ ] Manual: get mentioned in another channel → title "(1) DisGourd" and the favicon has a dot. Open that channel → back to "DisGourd" with no dot. A plain unread → "• DisGourd".
- [ ] No favicon flicker while counts are stable (the effect only runs on change).

## Expected Areas of Change
New `web/src/attention.js`, and `web/src/App.jsx` (+2 lines).

## Working Set / Blast Radius
Tiny.
