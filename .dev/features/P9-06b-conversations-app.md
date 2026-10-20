# P9-06b — Conversations in the app

- **Unit Type:** Implementation (child of P9-06)
- **Phase:** 9
- **State:** COMPLETE (#192)
- **Starting baseline:** main at 56c54ad (#191 merged)
- **Effort:** M
- **Depends on:** P9-06a

## Scope
No visible change. The app keys DMs by conversation id, ready for groups.

- **`useDms`:**
  - `current`, `unread`, `typing` and paging keys are conversation ids.
  - Conversations come from GET /dms with their `members`.
  - Send, read, focus and typing use `conversation`. Incoming frames are matched by `conversation`.
  - `open(username)` still works: it finds the pair, or opens a not-yet-created one that the first message creates. The server answers with the conversation id on the first send, as `dm` frames do.
  - The new-message divider counts messages not written by me.
- **Elsewhere in the app:**
  - `App` and `useSpaces` save `{ dm: conversationId }`. An old saved username is still restored by looking it up.
  - The switcher key is `d:<conversationId>`.
  - Search results open `conversationId`.
  - In `notify.js`, "this DM is open" means the same conversation; the tag and click open the conversation.
  - Push data and the service worker's click open the conversation, with `data.dm` as the fallback for older pushes.
- **`DmSidebar` and `DmPanel`:** rows and the header read from the conversation (for a pair, the other member). Same look as today.
- **Server cleanup:** once the app no longer uses the old username paths and ops, P9-06c may drop them. Note it, don't do it here.

## As built
- **Keys:** a conversation is keyed `c:<id>`. One you're starting with someone you've never messaged is `@<username>` until its first message: the `dm` frame names the conversation, and the key switches to it (also when the list reloads and contains the pair).
  - `convKey`, `frameKey` and `target(key)` live in `useDms`. `target(key)` turns a key into the ops' `{ conversation }`, or `{ with }` / `{ to }` for a placeholder.
- **`useDms`:**
  - `current`, `unread`, typing matches and paging keys use the key.
  - Conversations carry `key`; a placeholder row is `{ key: '@name', id: null, kind: 'pair', username }`.
  - New: `currentConversation`.
  - `select(key)` also takes `@name`, or a bare username (a view saved before P9-06b), and opens that pair.
  - `dm_read` is only sent when there's a message to mark.
- **`api.js`:** `getDmMessages`, `getDmVersions` and `hideDmPreview` take a key (`dmPath`: `/dms/c/:id` or `/dms/:username`).
- **Elsewhere:**
  - `App` saves and restores the key. A push or `?open=` with `conversation` opens it, and `data.dm` remains the fallback.
  - Search opens the hit's `conversationId`, and the switcher uses `d:<key>`.
  - `DmSidebar` rows use `key`.
  - `DmPanel` gets `conversationKey` (for the API and its reset) and `username` (to display).
  - `notify.js` exports `dmKeyOf(frame)`, used for "is it open", the tag and the click.
  - `sw.js` tags `dm:c:<id>`, or `dm:@<name>` for older pushes.
- **Server cleanup** (dropping the username paths) is left for P9-06c, as planned.

## Acceptance criteria
- [x] **Web:** the `useDms` tests run on conversation ids (frames, unread, typing, paging, opening by username). The tests for restoring the saved view, the switcher, search, notifications and push clicks pass with conversation ids.
- [x] **All suites pass;** `vite build` is clean.
- [x] **Sandbox:** DMs look and work the same as before, across a reload and from a notification click. A new DM with someone you haven't messaged works.

## Evidence (2026-10-20)
| Acceptance criterion | Evidence |
|---|---|
| Web | `useDms.test.js` (+1):<br>• `dm_unread` and a frame for another conversation count under `c:7`. Opening `c:7` focuses, loads (`getDmMessages('c:7')`), sends, types and reads by `conversation: 7`.<br>• Typing from conversation 8 doesn't show.<br>• `open('cara')` → `@cara`: focus `with`, send `to`. Her first `dm` frame (conversation 9) switches to `c:9` and refocuses, and it isn't counted unread.<br>**Updated tests** (now keyed by conversation):<br>• Listing / restore: `select('bob')` (a bare username) finds the pair `c:7`.<br>• notify: the open DM by key, a different conversation still notifies, an old frame matches by sender.<br>• sw: `dm:c:7`, and `dm:@bob` for a push without a conversation.<br>• DmSidebar (a11y), peopleItems (keys), and the search result hit. |
| All suites | Web 102 files, 802. `vite build` clean. Server unchanged since #191 |
| Sandbox (:3005; server at v30) | **Sandy's tab:**<br>• The reload restored a DM saved before this change (a bare username) and re-saved it as `c:1`. Bob's DM shows its history.<br>• In cara's DM, bob (script, by conversation id) typed and sent. Typing didn't show there; bob's row showed "1 unread"; opening it cleared the count and showed the New line.<br>• Sandy's reply reached bob's script with `dm_typing` and `dm` for conversation 1.<br>• `/?open={"dm":"cara","conversation":2}` opened cara's DM (from bob's).<br>**Bob's tab** (signed in with the sandbox test account; a sandbox user "dee" was added to Tx Check for a fresh pair):<br>• The old saved "cara" restored as `c:3`.<br>• New message → dee opened the `@dee` placeholder: header "dee", "Message @dee", saved `@dee`.<br>• The first message created conversation 4. The key and the saved view became `c:4`, and the message showed once in the chat and in the sidebar.<br>**Old build still works:** that tab was first on the old cached build and still started bob↔cara (conversation 3) through the old username paths, so an app tab that hasn't reloaded keeps working against the new server |
