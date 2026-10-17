# P2-22b — Thread panel and summaries (client), with composable gateway handlers

- **Unit Type:** Implementation (child of P2-22)
- **Phase:** 2
- **State:** PLANNED (READY after P2-22a)
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
- [ ] Web tests:
  - two handler maps for the same frame type both run
  - Create thread sends the right request and opens the panel
  - the summary renders and updates on `thread_updated`
  - the panel posts with `channel: '~tN'`
  - Esc returns focus to the summary
  - a search result in a thread opens the panel
- [ ] Sandbox, two users:
  - start a thread from a message; the other user sees the summary appear and its reply count go up live
  - replies in the thread don't show in the parent channel
  - the thread works on a phone-width viewport
- [ ] No regressions in channel chat (the existing App smoke test plus the full suite).

## Expected Areas of Change
`state/gatewayHandlers.js`, `App.jsx`, `ChatPanel.jsx`, `MessageList.jsx`, new `ThreadPanel.jsx`, `ThreadsList.jsx` and `CreateThreadDialog.jsx`, `api.js`, `notify.js` (title), `SearchOverlay.jsx`, `QuickSwitcher` items, and tests.

## Working Set / Blast Radius
~10 files, at the upper limit. If it grows, split the threads list and the search/switcher naming into a follow-up.
