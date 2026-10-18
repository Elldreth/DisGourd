# P3-20a — Channel topics

- **Unit Type:** Implementation (child of P3-20)
- **Phase:** 3
- **State:** COMPLETE (merged #129)
- **Effort:** M
- **Depends on:** none (uses the channel PATCH route from P2-20a)
- **Starting baseline:** main at 691724d
- **Serialize with:** `server/db/migrations.js`, `server/routes/spaces.js`, `ChatPanel.jsx`, `ChannelSettingsDialog.jsx`

## Why
UX review F7: "Nothing tells a newcomer what `#made-offline` or `#history` is for."

## Scope
- **Migration v14:** `channels.topic TEXT`.
- **Server:**
  - `PATCH /spaces/:s/channels/:c` accepts `{ topic }` alongside `{ nsfw }`, either or both. Managers only, as now.
  - A topic is plain text, trimmed, at most 300 characters, line breaks kept; empty clears it. Threads: 404.
  - The change broadcasts `space_updated`, and `GET /spaces` returns `channelMeta[c].topic`.
- **App:**
  - **Channel settings** gets a **Topic** box (text and voice channels) with a character count, saved with the dialog's Save, and only when it changed.
  - **Chat header:** after the channel name, the topic on one line, truncated, in a muted colour. It's a button: clicking it (or Enter) expands to the full text under the header (`aria-expanded`), and Esc or clicking again collapses it. Links in it are clickable. Hidden on phones under 400 px wide, where the header has no room; the welcome card still shows it.
  - **The channel's welcome card** ("Welcome to #channel") shows the topic instead of "This is the start of the channel. Say hello!" when there is one.

## Acceptance criteria
- [x] Server test: a manager sets, changes and clears a topic (300 kept, 301 refused, trimmed, empty → null); a member can't (403); a thread is 404; `GET /spaces` carries it; `space_updated` is broadcast; nsfw and topic can be sent together or alone.
- [x] Web tests: Channel settings saves the topic only when changed, with the count; the header shows the topic and expands and collapses it (mouse and keyboard); the welcome card uses it; no topic means no header button.
- [x] All suites pass; `vite build` is clean.
- [x] Sandbox: set a topic on Tx Check #general; it shows in the header for bob without a reload.

## Expected Areas of Change
`server/db/migrations.js`, `server/db/index.js`, `server/routes/spaces.js`, `server/tests/channel-topics.test.js` (new), `server/tests/db-migrations.test.js` (if needed); `web/src/api.js`, `ChannelSettingsDialog.jsx`, `ChatPanel.jsx`, `MessageList.jsx` (welcome text via props), `App.jsx`, tests.

## Implementation notes
- The PATCH route now refuses a body with neither field ("Nothing to change"), and returns only the fields it changed. Threads and unknown channels are checked first (404), so `nsfw` on a thread is now 404 rather than silently doing nothing.
- The header button carries `aria-label="Topic: <first line>"`. A visually hidden "Topic: " prefix lost its trailing space in the accessible name ("Topic:Say hi!").
- The expanded topic goes through `renderMarkdown`, so links, emoji and formatting work; the collapsed line is plain text (its first line).

## Evidence (2026-10-18)
| Acceptance criterion | Evidence |
|---|---|
| Server | `channel-topics.test.js` (3): set (trimmed, line breaks kept), 300 kept, 301 refused, blank clears to null; `GET /spaces` carries it; members get `space_updated`. A member gets 403; an empty body, "Nothing to change"; a non-string, "The topic must be text"; an unknown channel and a thread, 404. nsfw + topic together, or nsfw alone (the topic stays). `api.test.js`: `channelMeta` gains `topic: null` |
| Web | `ChannelTopics.test.jsx` (3): Channel settings shows the topic with "9/300" and saves it only when changed (trimmed); the header button shows the first line, expands to the full topic with a working link, and closes on Esc, a second click, or a channel switch; the welcome card shows the topic; with no topic, no button and the usual welcome |
| Suites | Web: 70 files, 591 tests. Server: 34 suites, 316 tests. `vite build` clean |
| Sandbox | As sandy: Tx Check #general → Channel settings → Topic "Say hi and introduce yourself. Testing notes go in #history." → Save. Bob's open tab (#general) showed it in the header at once ("Topic: Say hi…" button), with no reload |
