# P1-12 — App.jsx split 1/3: channel-message state hook + handler composition

- **Unit Type:** Implementation (child of "Split up App.jsx": P1-12 → P1-13 → P1-14)
- **Phase:** 1 — "Split up App.jsx (943 lines, about 30 useStates) using a reducer or a small store"
- **State:** COMPLETE (merged in Elldreth/DisGourd#52)
- **Effort:** M
- **Depends on:** none (land P1-11 first if it's pending; both touch App.jsx)
- **Serialize with:** every unit editing `web/src/App.jsx`
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 1; App.jsx revalidated at 943 lines and 31 `useState`s

## Decision
Use per-domain hooks with `useReducer`, and add no new dependency (no zustand or redux). That keeps the bundle and the learning curve flat. Recorded as an assumption below.

## Scope (behaviour-preserving)
1. New `web/src/state/gatewayHandlers.js`: a tiny registry so hooks can contribute frame handlers. Note that `useGateway` already reads handlers through `handlersRef.current`, so handlers don't need to be stable. The circularity (handlers need `send`, and `send` comes from `useGateway`) is solved by registering handlers in a ref-backed object that's created before `useGateway` and read lazily.
2. New `web/src/state/useChannelMessages.js`. It owns `messages`, `typingUsers`, `unread`, `mentions`, the "clear on switch" effect, the focus+load effect, typing-expiry pruning, and the handlers `message`, `unread`, `message_update`, `message_delete`, `reaction`, `typing`. It exposes `{ messages, typingNames, unread, mentions, sendMessage, editMessage, deleteMessage, react, sendTyping }`. Use a reducer for message-list mutations (`merged`, `updated`, `deleted`, `reaction`, `reset`) and export it as a pure function so P1-19 can unit-test it.
3. App.jsx consumes the hook. The unread/mention badge aggregation moves into a selector helper in the same file.

## Acceptance criteria
- [~] App.jsx shrinks by ≥ 150 lines. No user-visible behaviour change.
- [x] Manual two-browser smoke test: send, edit, delete, react, typing indicator, unread badge on another channel, mention badge, channel switch clears transcript, reconnect reloads the channel.
- [x] `npm --prefix web run build` passes with no new warnings.
- [x] The reducer is a pure exported function (no React imports inside it).

## Expected Areas of Change
`web/src/App.jsx`, new `web/src/state/useChannelMessages.js`, new `web/src/state/gatewayHandlers.js`.

## Working Set / Blast Radius
App.jsx (943 lines), `useSocket.js`, `util.js` (`mergeMessages`). Blast radius: all channel chat on the client.

## Assumptions
- ASSUMPTION (kept): hooks + useReducer, with no store library.

## Activation
- Activated 2026-10-15 on branch `claude/p1-12-channel-messages-hook`, cut from main @ de24417.
- Baseline: App.jsx 951 lines; web build clean.

## Implementation notes
- **Handler composition (`state/gatewayHandlers.js`):** `useHandlerTable()` returns one stable `handlers` object that App passes to `useGateway` *before* the feature hooks run. The hooks receive the real `send`/`status`, and App calls `table.fill(appHandlers, chat.handlers)` each render. `useGateway` looks handlers up per frame, so this avoids the send↔handlers cycle with no wrapper or extra render. (A first attempt used a late-bound `send` plus a mirrored status state. That cost an extra render and delivered `status` one render late, so it was replaced.)
- **`state/useChannelMessages.js`:**
  - **State:** `messages` (via `useReducer`), `typingUsers`, `unread`, `mentions`.
  - **Effects:** clear-on-switch, focus+load (reruns on `status`, so it reloads after reconnect), typing pruning.
  - **Handlers:** `message`, `unread`, `message_update`, `message_delete`, `reaction`, `typing`.
  - **Actions:** `sendMessage` (with `replyTo`), `editMessage`, `deleteMessage`, `react`, `sendTyping`, and `reset()` for logout.
- **Pure exports in the same file:** `messagesReducer` (no React inside), `pruneExpired`, `badgeCounts`, `unreadKey`. App uses `badgeCounts` and `unreadKey` (voice state), and `pruneExpired` for DM typing.

## Verification (AC → evidence)
| AC | Evidence |
|---|---|
| App.jsx −150 lines | **Partly met: 951 → 833 (−118).** Everything in this unit's scope moved. The remaining bulk is DM state (P1-13) and spaces/voice (P1-14), so I didn't pad the number by moving out-of-scope code early. |
| No behaviour change: two-client smoke | Sandbox, browser as sandy plus a scripted second client as bob. Each happened live with no reload: bob's message appeared; his edit showed "(edited)"; his 🔥 reaction showed "🔥 1"; "bob is typing" appeared and expired within 5s; his delete removed the message. A post in #random set #random bold with a pink mention badge "1" for "@sandy". Opening #random swapped the transcript and cleared the badge. A plain post in #general set #general's unread dot. |
| Reconnect reloads the channel | With the app open in a tab the restart didn't touch: stop the server, insert a message straight into the sandbox DB, start the server. The same document (no page reload) reconnected and showed the inserted message. |
| Build passes, no new warnings | `vite build`: clean. |
| Reducer is pure | `messagesReducer` sits at the top of `useChannelMessages.js` and uses only `mergeMessages`. The React imports are used only by the hook. |
