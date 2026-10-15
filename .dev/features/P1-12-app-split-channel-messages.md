# P1-12 — App.jsx split 1/3: channel-message state hook + handler composition

- **Unit Type:** Implementation (child of "Split up App.jsx": P1-12 → P1-13 → P1-14)
- **Phase:** 1 — "Split up App.jsx (943 lines, about 30 useStates) using a reducer or a small store"
- **State:** READY
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
- [ ] App.jsx shrinks by ≥ 150 lines. No user-visible behaviour change.
- [ ] Manual two-browser smoke test: send, edit, delete, react, typing indicator, unread badge on another channel, mention badge, channel switch clears transcript, reconnect reloads the channel.
- [ ] `npm --prefix web run build` passes with no new warnings.
- [ ] The reducer is a pure exported function (no React imports inside it).

## Expected Areas of Change
`web/src/App.jsx`, new `web/src/state/useChannelMessages.js`, new `web/src/state/gatewayHandlers.js`.

## Working Set / Blast Radius
App.jsx (943 lines), `useSocket.js`, `util.js` (`mergeMessages`). Blast radius: all channel chat on the client.

## Assumptions
- ASSUMPTION: hooks + useReducer is preferred over adding a store library. Flag for human.
