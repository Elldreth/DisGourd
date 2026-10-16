# P2-03 — Unread count in the tab title + favicon dot

- **Unit Type:** Implementation
- **Phase:** 2, rank 2 (part 1 of "Browser notifications, unread count in the tab title and favicon, message sound")
- **State:** REVIEW (PR open)
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
- [x] Unit test for `attentionTitle` (needs P1-19; otherwise an inline manual check).
- [x] Manual: get mentioned in another channel → title "(1) DisGourd" and the favicon has a dot. Open that channel → back to "DisGourd" with no dot. A plain unread → "• DisGourd".
- [x] No favicon flicker while counts are stable (the effect only runs on change).

## Expected Areas of Change
New `web/src/attention.js`, and `web/src/App.jsx` (+2 lines).

## Working Set / Blast Radius
Tiny.

## Activation
- Activated 2026-10-16 on branch `claude/p2-03-tab-badge`, cut from main @ e0dc42d (P2-02 merged).

## Implementation notes
- **Deviation:** the planned canvas rendering is replaced by **two static icons** in `web/public`: `favicon-dot.svg` (the favicon plus a pink `#FF5FA2` dot outlined in ink-900) and `favicon-dot-32.png`, rendered from it. `setFaviconDot` swaps every `link[rel~=icon]` by its `type` between the plain and dot files. This avoids async image loading and canvas work, stays sharp at any size, and still costs nothing until the state changes.
- `web/src/attention.js`:
  - `attentionTitle` is pure, with counts capped at "99+".
  - `useDocumentAttention` has three effects. The title one runs on change. The favicon one runs **only when the dot turns on or off**. On unmount it restores "DisGourd" and the plain icons.
- `App.jsx` calls the hook before its signed-out early return, with mentions = Σ`spaceMentions`, dms = `dm.totalUnread` and unread = Σ`spaceUnread`.
- Process note: the tests were written alongside the hook in one pass, not watched failing first.

## Verification (AC → evidence)
| AC | Evidence |
|---|---|
| Unit test for `attentionTitle` | `attention.test.js`: none, mentions+DMs, plain-unread dot, and the 99+ cap. Plus hook tests: a mention gives `(1)` plus both dot icons, and reading restores both. Plain unreads give `•` with the plain icon. Unmount restores. Web suite: 76/76. |
| Mention elsewhere → "(1) DisGourd" + dot; open it → plain; plain unread → "•" | Sandbox (sandy in #random, bob posting): `@sandy` in #history gave title **"(1) DisGourd"** and icons `/favicon-dot.svg` and `/favicon-dot-32.png`. Opening #history gave **"DisGourd"** and the plain icons. A plain post in #random gave **"• DisGourd"** with the plain icon. Two DMs from cara gave **"(2) DisGourd"** with the dot. |
| No favicon flicker while counts are stable | Hook test: a MutationObserver counted `href` writes, and they didn't change across count changes that kept the dot on (1, then 3, then 4). |
| Build | `vite build` passes. `dist/` contains both dot icons. |
