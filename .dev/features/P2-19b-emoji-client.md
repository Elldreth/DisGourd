# P2-19b — Custom server emoji in the app: `:name:` rendering, picker tab, reactions, settings

- **Unit Type:** Implementation (child of P2-19)
- **Phase:** 2
- **State:** COMPLETE (merged in #111, 2026-10-18)
- **Effort:** M
- **Depends on:** P2-19a (API and `emoji` in `GET /spaces`), P2-01 (markdown), P2-06/P2-07 (picker, any-emoji reactions)
- **Serialize with:** `markdown.jsx`, `EmojiPicker.jsx`, `MessageList.jsx`, `MessageActions.jsx`, `ChannelList.jsx`, `server/gateway/chat.js`

## Scope
- **In messages:** `:name:` renders as a 22px `<img alt=":name:" title=":name:">` when the *current* server has an emoji by that name; otherwise it stays text. Only the current server's emoji (`activeSpace.emoji`); DMs and other servers' names stay text (cross-server use is a non-goal).
- **Picker:** a **Server** section (and a tab icon) listing the server's emoji, searchable by name. Picking one in the composer inserts `:name:`.
- **Reactions:** a custom emoji reaction is the token `<:name:id>`. The server's `react` op accepts it when that id exists in the message's server with that name; otherwise the frame is ignored. The reaction chip shows the image (or `:name:` if the emoji was deleted since).
- **Settings:** a **Server emoji** dialog from the server menu (people with `manage_emoji`): the list with image, name and who added it, a Delete per row, and an Add form (file + name, name defaults to the file name). Uploads go through `/uploads`, then `POST …/emoji`. Errors (name taken, too big, cap) show inline. `space_updated` refreshes the list live.
- **Live:** `space_updated` already reloads the servers, which carry `emoji`, so new emoji render as soon as they're added.

## Acceptance criteria
- [x] Server test: a `<:name:id>` reaction is accepted when it exists in the message's server; a wrong id, a wrong name, or another server's emoji is ignored; the chip data round-trips in history.
- [x] Web tests: `:name:` renders an image only for a known name (text otherwise, and in DMs); the picker's Server section lists the emoji and picking inserts `:name:` (composer) or sends `<:name:id>` (reactions); a reaction chip shows the image; the emoji dialog lists, deletes and adds (upload → add) and shows an error.
- [x] Sandbox: add an emoji from the dialog, use it in a message and as a reaction, see it render for a second user live; delete it and see the reaction chip fall back to text.
- [x] No regressions: both suites, the App smoke test.

## Expected Areas of Change
`web/src/markdown.jsx`, `web/src/emoji.js`, `EmojiPicker.jsx`, `MessageActions.jsx`, `MessageList.jsx`, `ThreadPanel.jsx`, `ChatPanel.jsx`, `ChannelList.jsx`, new `ServerEmojiDialog.jsx`, `api.js`, `App.jsx`; `server/validate.js`, `server/gateway/chat.js`, `server/db/index.js`; tests.

## Working Set / Blast Radius
~12 files, at the upper limit but each change is small. Rendering is purely additive (a new inline token), and the reaction token is validated server-side so a bad token can never be stored.

## Implementation notes
- `renderMarkdown(text, { emoji })` takes a `Map` of name → url; `:name:` becomes a 22px `<img alt=":name:">` only when the map has the name, and never inside code. `emojiLookup(list)` builds the map from a server's `emoji` list.
- `EmojiPicker` takes `custom` ([{ id, name, url }]) and shows a **Server** section (plus a tab button) after Recent; search covers them by name. It now calls `onPick(emoji, item)`; a custom item is `':name:'` with `item.reaction = '<:name:id>'`. Custom picks aren't added to the browser's Recent list (that list is shared across servers).
- `ReactionPicker` passes `custom` through and sends `item.reaction` for a custom pick; `MessageList` takes `emoji` and renders reaction chips through `parseEmojiToken`: the image when the id still exists, `:name:` otherwise (so a deleted emoji never breaks a chip). The chip's accessible name is `:name:`.
- Server: `parseReactionEmoji` accepts `<:name:id>`; the `react` op then checks `db.spaceHasEmoji(space, id, name)` for the message's server and ignores the frame otherwise.
- `ServerEmojiDialog` (from the server menu, for `manage_emoji`): the list with image, `:name:` and who added it, a Delete per row, and an Add form (file + name; the name is suggested from the file name). Client-side checks mirror the server's (type, 256 KB, name shape); server errors show inline. `space_updated` reloads the servers, whose `emoji` list feeds every renderer live.

## Evidence (2026-10-17)
| Acceptance criterion | Evidence |
|---|---|
| Server: `<:name:id>` reactions | `emoji.test.js` "a custom emoji reacts as <:name:id>…": accepted for the server's own emoji (frame and history carry the token); a wrong id, a wrong name, another server's emoji and a malformed token produce no frame. `reactions.test.js` unchanged (14) |
| `:name:` rendering | `markdown.test.jsx` "custom server emoji": image only for a known name, text otherwise, text without a server (DMs), text inside code. `MessageList.test.jsx`: `:name:` in a message renders the image |
| Picker Server section and picks | `EmojiPicker.test.jsx`: a Server group with the option, the image, `onPick(':party_gourd:', { reaction: '<:party_gourd:7>' })`, not added to Recent, found by search |
| Reaction chips | `MessageList.test.jsx`: the chip shows the image with the `:name: 2, you reacted` label; a deleted emoji's chip reads `:old_one:` |
| Emoji dialog | `ServerEmojiDialog.test.jsx`: name suggestion from a file name; lists with "added by"; Delete calls the API and updates; Add uploads then adds under the edited name and clears the form; a too-large file, a wrong type and a server refusal show an error |
| Full suites | Server: 25 suites, 250 tests. Web: 59 files, 514 tests. `vite build` clean. App smoke test passes |
| Sandbox (:3005, sandbox DB only) | sandy (localhost, owner of "Tx Check") and bob (127.0.0.1). A 32×32 PNG was uploaded and added as `:gourd:` through the API (the dialog's file picker needs the OS dialog, which the browser pane can't drive; the Add form is covered by its unit test). sandy posted "Custom emoji test :gourd: and an unknown :nope:": both tabs rendered a 22px image for `:gourd:` and left `:nope:` as text. bob opened Add reaction → More reactions: the picker showed a **Server** tab and the `:gourd:` option; picking it put an image chip ":gourd: 1" on both tabs live. sandy opened the server menu → **Server emoji**: the dialog listed `:gourd:` "added by sandy"; Delete emptied the list, and both tabs fell back live to the text `:gourd:` in the message and on the chip. No console errors |
