# P3-16 — Two small follow-ups (typing in threads, server view after create/join)

- **Unit Type:** Implementation (bundle of noted follow-ups)
- **Phase:** 3
- **State:** COMPLETE (merged in #112, 2026-10-18)
- **Effort:** S
- **Depends on:** P2-22b (threads), P2-17 (light theme), P1-14 (view state)
- **Serialize with:** `server/gateway/chat.js`, `state/useChannelMessages.js`, `App.jsx`, `Gourd.jsx`

## Scope
Items recorded as Discovered Work in earlier packets, small enough to land together:
1. **Typing indicators inside threads** (from P2-22b). The server's `typing` relay only reaches sockets whose gateway focus is that channel, and the thread panel doesn't take the focus (it would steal the channel's). Give each socket a second, thread focus: `focus { space, channel, thread: true }` sets `ws.threadFocus` (no channel clears it), and `typing` relays to sockets whose channel focus *or* thread focus matches. The thread instance of `useChannelMessages` sends the thread focus when it loads and clears it when the panel closes.
2. **Creating or joining a server while in DMs stays in DMs** (from P1-14). After a successful create or join, switch to the server view.

Not here: two items on the list turned out to be done already. The avatar/server-initial contrast from P2-17 was fixed by `avatarColor` in `util.js`, and the gourd logo's leaf already uses the light theme's darker `--color-lime` (`Gourd.jsx`).

## Acceptance criteria
- [x] Server test: with a thread focus, typing in the thread reaches that socket; a socket with only the channel focus doesn't get thread typing and still gets channel typing; clearing the thread focus stops it.
- [x] Web tests: the thread instance sends `focus { thread: true }` on load and clears it on close; creating or joining a server from the DM view shows the server view.
- [x] Sandbox: a second user sees "x is typing…" inside an open thread; create a server from DMs and land in it.
- [x] Both suites pass.

## Expected Areas of Change
`server/gateway/chat.js`, `server/gateway/index.js`, `web/src/state/useChannelMessages.js`, `web/src/App.jsx`, tests.

## Working Set / Blast Radius
~5 files, each change a few lines.

## Implementation notes
- `focus { space, channel, thread: true }` sets `ws.threadFocus`; `focus { thread: true }` (no channel) clears it; the plain `focus` op is unchanged. `typing` relays to a socket when either focus matches. A fresh socket starts with both null.
- The thread instance of `useChannelMessages` sends the thread focus in its load effect and clears it in that effect's cleanup (so closing the panel, switching thread, or a reconnect's re-run all keep the server's idea of "looking" right).
- `createServerAndShow` / `joinServerAndShow` in App wrap `sp.createSpace` / `sp.joinServer` and set the view to `server` after they succeed; errors still propagate to the dialog, which shows them inline.
- Two of the three items noted as follow-ups were already done on main (see Scope), so this unit is two items.

## Evidence (2026-10-18)
| Acceptance criterion | Evidence |
|---|---|
| Server: thread focus and typing | `threads.test.js` "typing inside a thread reaches people with that thread open…": a member with both focuses gets typing for the thread and the channel; the owner (channel focus only) gets only the channel's; clearing the thread focus leaves the member with only the channel's. Suite: 25 suites, 251 tests |
| Web: thread focus sent and cleared | `useChannelMessages.thread.test.js`: the thread instance's first frames are `focus { thread: true }` then `read`; unmounting sends `focus { thread: true }` with no channel. The channel instance's `focus` is unchanged |
| Web: create from DMs lands in the server | `App.test.jsx` "creating a server from the DM view lands you in it": from the DM view, Add a server → Create → the new server's heading and `Messages in #general` show, no console errors. Suite: 59 files, 515 tests; `vite build` clean |
| Sandbox (:3005, sandbox DB only) | sandy (localhost) opened "Board game night"; bob (127.0.0.1) opened the same thread and typed without sending: sandy's thread panel read "bob is typing…" and her channel showed nothing. bob closed the panel and typed in #general: sandy's channel read "bob is typing…" and the panel showed nothing. bob switched to Direct Messages, pressed Create a server, named it "Follow-up Check": the app landed in the new server's #general. No console errors |
