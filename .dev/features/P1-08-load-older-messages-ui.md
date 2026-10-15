# P1-08 — "Load older messages" (infinite scroll up) in channels and DMs

- **Unit Type:** Implementation
- **Phase:** 1 — "Cursor pagination, plus load older messages in the UI"
- **State:** PLANNED
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
- [ ] A channel with 300 messages: scrolling to the top loads 50 more at a time until all 300 are shown, then the channel header appears. No duplicates.
- [ ] The viewport doesn't jump during a prepend: the message under the cursor stays put within ±1 row.
- [ ] A new live message while scrolled up doesn't yank the view down. A new live message while at the bottom still follows.
- [ ] Switching channels during a load doesn't leak old-channel messages into the new one.
- [ ] Works in DMs.
- [ ] `npm --prefix web run build` passes.

## Expected Areas of Change
`web/src/api.js`, `web/src/components/MessageList.jsx`, `web/src/state/useChannelMessages.js` (from P1-12), DM state (App.jsx or the P1-13 hook), `web/src/components/DmPanel.jsx` (pass-through props), `web/src/components/ChatPanel.jsx` (pass-through props).

## Working Set / Blast Radius
~6 client files. MessageList.jsx is a hot file, so serialize.
