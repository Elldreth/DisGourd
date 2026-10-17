# P2-22b — Thread panel and summaries (client), with composable gateway handlers

- **Unit Type:** Implementation (child of P2-22)
- **Phase:** 2
- **State:** COMPLETE (merged in #98, 2026-10-17)
- **Effort:** M
- **Depends on:** P2-22a
- **Serialize with:** `App.jsx`, `ChatPanel.jsx`, `MessageList.jsx`, `state/*` units

## Scope
- **Composable gateway handlers:** `state/gatewayHandlers.js` keeps a *list* of handlers per frame type and calls each in order. Today it's one per type (`Object.assign`), so the thread panel's message hook would replace the channel's. Unit-test that two maps with `message` both run.
- **A second `useChannelMessages`** for the open thread (`channel = '~tN'`), active while the panel is open. It reuses history, `around`, pins, reactions, edits, deletes, replies and typing as they are.
- **"Create thread"** in a message's menu (parent channels only, if you can post). A small dialog takes a name (prefilled from the message, up to 80 characters) and opens the new thread.
- **Thread summary** under a root message: "**Thread name** · 3 replies · last 5 min ago". Clicking it opens the panel. It's kept live by `thread_updated` and `thread_created`.
- **Thread side panel** (right side; full screen on phones):
  - the root message (quoted, or "original message deleted")
  - the thread's `MessageList` and a composer ("Message thread name")
  - a close button; Esc closes and returns focus to the summary
- **Threads list:** a channel header button opens "Threads" with the active threads (and an "Archived" toggle), newest activity first. Clicking one opens it.
- **Display names:** wherever a `~tN` channel name could show (notification titles, search results, the quick switcher), show "Thread name (#parent)" and open the panel instead of switching channel.

## Acceptance criteria
- [x] Web tests:
  - two handler maps for the same frame type both run
  - Create thread sends the right request and opens the panel
  - the summary renders and updates on `thread_updated`
  - the panel posts with `channel: '~tN'`
  - Esc returns focus to the summary
  - a search result in a thread opens the panel
- [x] Sandbox, two users:
  - start a thread from a message; the other user sees the summary appear and its reply count go up live
  - replies in the thread don't show in the parent channel
  - the thread works on a phone-width viewport
- [x] No regressions in channel chat (the existing App smoke test plus the full suite).

## Expected Areas of Change
`state/gatewayHandlers.js`, `App.jsx`, `ChatPanel.jsx`, `MessageList.jsx`, new `ThreadPanel.jsx`, `ThreadsList.jsx` and `CreateThreadDialog.jsx`, `api.js`, `notify.js` (title), `SearchOverlay.jsx`, `QuickSwitcher` items, and tests.

## Working Set / Blast Radius
~10 files, at the upper limit. If it grows, split the threads list and the search/switcher naming into a follow-up.

## Implementation notes
- `composeHandlers(...maps)` in `state/gatewayHandlers.js`: a frame type listed by several maps gets one handler that calls each in order. `useGateway` is unchanged (it still looks up one function per type).
- The open thread is a second `useChannelMessages({ threadOnly: true })` in App, with `channel = '~tN'`. In that mode it handles only its own thread's frames: no unread or mention counts, no notifications, and it doesn't send `focus` (the channel keeps its typing indicators). The channel's instance ignores replies in threads entirely for now, so thread replies don't count as unread or notify (that comes with following, P2-22c).
- A root message's `thread` summary is kept live by `thread_created` / `thread_updated` (reducer action `thread`); `threadsVersion` reloads an open Threads list.
- `ThreadPanel` sits to the right of the channel from `lg` up and fills the screen below that. Focus goes to its composer on open; Esc (or the close button) closes it and App gives focus back to the element it was opened from (the summary, or the message row when opened from the menu). Leaving the channel closes it silently.
- The root message is passed along when it's at hand (summary or menu); from the Threads list or a search result it's fetched with `?around=` and a 404 shows "Original message was deleted".
- Thread names show instead of `~tN` in the panel header, the Threads list and search results ("Thread name (#parent) · Server"). The quick switcher lists channels from `GET /spaces`, which never includes threads, so it needed no change. Notifications for thread replies are off until P2-22c, so no title change was needed there yet.

## Evidence (2026-10-17)
| Acceptance criterion | Evidence |
|---|---|
| Two handler maps for the same frame type both run | `state/gatewayHandlers.test.js`: both run, in order; the table object stays the same across fills |
| Create thread sends the right request and opens the panel | `CreateThreadDialog.test.jsx`: the name is prefilled from the message (cut like the server does) and `createThread('S','general',7,'Weekend plans')` is sent; the result is handed to `onCreated`, which App opens. A server error shows in the dialog |
| The summary renders and updates on `thread_updated` | `MessageList.test.jsx` "threads (P2-22b)": summary text and label, Create thread / Open thread menu items, and a re-render from "No replies yet" to "1 reply". `useChannelMessages.thread.test.js`: `thread_created` and `thread_updated` update the root message and bump `threadsVersion`; frames for another channel are ignored |
| The panel posts with `channel: '~tN'` | `useChannelMessages.thread.test.js`: the thread instance sends `{ op: 'message', channel: '~t7' }`, reads with `~t7`, sends no `focus`, ignores other channels' messages and the `unread` frame. `ThreadPanel.test.jsx`: Enter in the composer calls `onSend` |
| Esc returns focus to the summary | `App.test.jsx` "threads: …": clicking the summary opens the panel; Esc closes it and `document.activeElement` is the summary again. `ThreadPanel.test.jsx`: Esc and the close button call `onClose` |
| A search result in a thread opens the panel | `SearchOverlay.test.jsx`: the row reads "Weekend plans (#general) · S" (never `~t5`) and clicking calls `onOpenThread` instead of `onOpenChannel` |
| Full suite | `npx vitest run`: 50 files, 451 tests, all passing (the App smoke test included). `vite build` clean |
| Sandbox, two users (:3005, sandbox DB) | sandy (localhost) and bob (127.0.0.1), server "Tx Check" #general. bob posted a message, chose **Create thread** from its menu (the dialog was prefilled with "Who is up for a board game night on Fri…"), named it "Board game night": his panel opened with focus in the composer, and sandy's tab showed the summary "No replies yet" with no reload. bob's two replies made sandy's summary read "2 replies · last just now" live; neither reply appeared in #general. sandy opened it from the summary, replied, and bob's open panel showed it live (summary "3 replies"). Esc closed sandy's panel and focus returned to the summary. The **Threads** list showed both threads with counts, and opening one from there worked. Searching "Wingspan" listed both replies as "Board game night (#general) · Tx Check" and clicking one opened the thread. At 375×812 the panel filled the screen with no horizontal scroll. No new console errors |

## Discovered Work
- Typing indicators inside a thread: the server sends `typing` only to sockets whose gateway focus is that channel, and the thread instance doesn't take focus (it would steal the channel's). A small server change (a second, thread focus per socket) would enable them. Not needed for this unit.
- The "start of the conversation" block in `MessageList` is always shown at the top; for threads it now reads "The start of the thread". A `hideStart` prop would be cleaner if a third use appears.
