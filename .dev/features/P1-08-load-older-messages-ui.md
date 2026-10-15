# P1-08 — "Load older messages" (infinite scroll up) in channels and DMs

- **Unit Type:** Implementation
- **Phase:** 1 — "Cursor pagination, plus load older messages in the UI"
- **State:** COMPLETE (merged in Elldreth/DisGourd#53)
- **Effort:** M
- **Depends on:** P1-07 (API), P1-12 (channel message state lives in a hook; avoids editing the 950-line App.jsx)
- **Serialize with:** MessageList.jsx units (P3-05, P2-01, P2-05, P2-07, P2-09, P1-10, P3-09, P3-12); App.jsx units
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 1

## Scope
- `api.getMessages(space, channel, { limit, before })` and `api.getDmMessages(user, { limit, before })`.
- State hook (`useChannelMessages`, plus the DM equivalent from P1-13 if it has landed; otherwise DMs go through the App.jsx DM effect) tracks `hasMore` and `loadingOlder`, and exposes `loadOlder()`. It merges with `mergeMessages`.
- `MessageList.jsx`: an IntersectionObserver sentinel at the top triggers `loadOlder()` when `hasMore`. Preserve the scroll position (record `scrollHeight` before the prepend and restore `scrollTop += delta` after layout). The "near bottom" auto-follow must not fire on a prepend. Show a small spinner row. When `!hasMore`, show the existing "Welcome to #channel" header *at the top of history* (today it only shows when the list is empty).
- Guard against duplicate concurrent loads and against channel switches mid-load (cancel by key).

## Non-goals
Jumping to arbitrary history (that's P2-05 and P2-10). Virtualised rendering.

## Acceptance criteria (manual + build)
- [x] A channel with 300 messages: scrolling to the top loads 50 more at a time until all 300 are shown, then the channel header appears. No duplicates.
- [x] The viewport doesn't jump during a prepend: the message under the cursor stays put within ±1 row.
- [x] A new live message while scrolled up doesn't yank the view down. A new live message while at the bottom still follows.
- [x] Switching channels during a load doesn't leak old-channel messages into the new one.
- [x] Works in DMs.
- [x] `npm --prefix web run build` passes.

## Expected Areas of Change
`web/src/api.js`, `web/src/components/MessageList.jsx`, `web/src/state/useChannelMessages.js` (from P1-12), DM state (App.jsx or the P1-13 hook), `web/src/components/DmPanel.jsx` (pass-through props), `web/src/components/ChatPanel.jsx` (pass-through props).

## Working Set / Blast Radius
~6 client files. MessageList.jsx is a hot file, so serialize.

## Activation
- Activated 2026-10-15 on branch `claude/p1-08-load-older`, cut from main @ ddc5def (P1-12 merged).

## Implementation notes
- New `web/src/state/useHistoryPaging.js` (shared by channels and DMs) tracks `hasMore` and `loadingOlder` per conversation key. `loadOlder(fetchPage, apply)` ignores calls while a load is in flight or when there's no more. It drops results if the key changed mid-load. `hasMore` = the last page was full (50).
- Channels: `useChannelMessages` exposes `hasMore` / `loadingOlder` / `loadOlder` (`?before=<oldest id>`, merged via the reducer).
- DMs: P1-13 hasn't landed, so App.jsx uses the same paging hook directly (key `dm:<name>`). P1-13 will move it into the DM hook.
- `MessageList`: an IntersectionObserver sentinel at the top (300px early) captures `{ scrollHeight, scrollTop }` before each load. A `useLayoutEffect` notices the prepend (the first id changed) and restores `scrollTop` before paint, skipping the bottom auto-follow. A "Loading older messages…" row shows during loads.
- **Behaviour change (as specified):** the "Welcome to #channel" / "beginning of your conversation" header now shows at the top of history whenever there's no more to load. Before, it only showed in an empty channel.
- `api.getMessages` / `api.getDmMessages` take `{ before }`.

## Verification (AC → evidence)
| AC | Evidence |
|---|---|
| 300 messages: pages of 50 to the end, then header, no duplicates | `#history` (300 seeded, ids 75–374): the initial 50 (325–374) are at the bottom. Scrolling to the top loads 100 / 150 / 200 / 250 / 300, then an empty page ends it. Duplicates 0, ids sorted, the "Welcome to #history" header is shown. |
| No jump during prepend | The top message's on-screen position was measured before and after each of the 5 loads: **shift 0px** every time. |
| Live message while scrolled up / at bottom | Scrolled to the top: Bob's live message was added (301) with `scrollTop` still 0. At the bottom: the next live message was followed (gap back to the normal 15px padding). |
| Channel switch mid-load | Older-page requests delayed 1.5s in-page. A load was confirmed in flight ("Loading older messages…") when switching to `#general`. After the late response: `#general` had 0 history rows and no spinner was left. `#history` then paged fully again (to 302). |
| DMs | DM with Bob (123): 50 → 100 → 123, then end. Duplicates 0. The "This is the beginning of your conversation with bob" header shows (screenshot). |
| Build | `vite build`: clean. |
