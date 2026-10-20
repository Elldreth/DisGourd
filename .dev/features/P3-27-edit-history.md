# P3-27 — Message edit history

- **Unit Type:** Implementation
- **Phase:** 3
- **State:** COMPLETE (merged in #157, 2026-10-19)
- **Starting baseline:** main at 24cc47a (#156 merged)
- **Effort:** M
- **Depends on:** none
- **Requirement Source:** the user, 2026-10-18 ("message edit history"). Design agreed with the user on 2026-10-19:
  - **Who sees it:** anyone who can see the message. Clicking "(edited)" shows the earlier versions.
  - **DMs too:** either person in the DM can see them.
  - **How many:** every version, kept until the message is deleted.
  - **On delete:** the history goes with the message. The moderation log already keeps an excerpt when a moderator deletes someone else's message.

## Today (main at #155)
- **Channels and threads:** the `edit` op → `db.editMessage` overwrites `messages.content` and sets `edited_at`; viewers get `message_update`.
- **DMs:** `dm_edit` → `db.editDm` overwrites `dm_messages.content`; both people get `dm_update`.
- **The app** shows "(edited)" next to the time (MessageList). The old text is gone.

## Scope
- **Migration v24:** `message_versions(id, message_id → messages ON DELETE CASCADE, content, written_at)` and `dm_message_versions(id, message_id → dm_messages ON DELETE CASCADE, content, written_at)`, each indexed on (message_id, id).
  - Before an edit overwrites the text, the old text is saved with the time it was written: the old `edited_at`, or the message's `created_at` for the original.
  - An edit to the same text saves nothing.
  - Both the save and the overwrite happen in one transaction.
- **Routes:**
  - **`GET /spaces/:s/channels/:c/messages/:id/versions`:** for anyone who can view the channel (threads included).
  - **`GET /dms/:user/messages/:id/versions`:** for the two people in the DM.
  - Both return `{ versions: [{ content, writtenAt }], current: { content, editedAt } }`, oldest first, with 404 for a message that isn't there or that you can't see.
- **App:**
  - "(edited)" becomes a button (channels, threads, DMs) with a tooltip of the edit time. It opens an "Edit history" dialog: the current text first, marked "Now", then each earlier version newest first, each with its time and rendered like a message (markdown, mentions, emoji).
  - A message edited before this feature has no saved versions, so the dialog says "Earlier versions weren't kept for this message."
  - Dialog stays open across a `message_update` (it reloads).
- **Not in scope:**
  - showing what changed between versions (a diff);
  - versions of attachments (edits change the text only);
  - a moderation-log entry for edits.

## As built
- **Saving:** `editMessage` / `editDm` are now transactions. They read the old text (author-checked), save it as a version unless the text is unchanged, then overwrite. A version's time is the old `edited_at`, else `created_at` (or the legacy `timestamp` for very old channel rows).
- **The channel route** sits before the general "GET messages" route, which would otherwise catch it. A member who can't see the channel gets 404; a non-member gets the server's usual 403.
- **The dialog** is opened by `MessageList` when a panel passes `loadVersions(m)` (ChatPanel, ThreadPanel, DmPanel).
  - "(edited)" is a button whose tooltip says when it was edited.
  - The original version is labelled "Original".
  - The dialog reloads when the message's `editedAt` changes.

## Acceptance criteria
- [x] Server: an edit saves the old text with the right time (original → created_at; later → the previous edited_at); a same-text edit saves nothing; GET returns them oldest first with the current text for viewers, and 404 for people who can't see the channel or aren't in the DM; deleting the message (or the channel / server) removes its versions; DMs the same.
- [x] Web: "(edited)" opens the dialog; versions newest first under "Now", rendered as messages; the "weren't kept" text for old edits; DMs too.
- [x] All suites pass; `vite build` is clean.
- [x] Sandbox: bob edits a message twice; sandy opens its history and sees all three versions; a DM edit shows its history to both.

## Evidence (2026-10-19)
| Acceptance criterion | Evidence |
|---|---|
| Server | `edit-history.test.js` (7):<br>• **Saving:** two edits → `[first draft @ created_at, second draft @ first edited_at]` plus the current text, read by another member; a same-text edit and a never-edited message → `versions: []`; someone else's edit attempt saves nothing.<br>• **Access:** an owner-only channel → 404 for a member and 403 for a non-member; the wrong channel or an unknown id → 404.<br>• **Threads:** a thread message has history.<br>• **Deleting** a message removes its versions.<br>• **DMs:** both people see two versions; others get 404; deleting the DM removes them.<br>Channel and server deletion rely on the same cascade (messages → versions). Server suites: 42 files, 402 |
| Web | `EditHistory.test.jsx` (4): "(edited)" calls `loadVersions(m)` and opens "Edit history — bob" with Now (markdown rendered), then "second draft", then "Original · … first draft"; Close closes it; empty versions → "Earlier versions weren’t kept for this message."; a new `editedAt` reloads it; a load error shows; without a loader it stays plain text. Web suites: 81 files, 678; `vite build` clean |
| Sandbox (:3005, restarted on this branch) | A script as bob posted "Game night is on Thursday at 7" in Tx Check #general and edited it to "…Friday at 7", then to "…**Friday at 8** — bring snacks!". Sandy's tab → (edited) → "Edit history — bob" showed Now (bold rendered), "Friday at 7" and "Original · Thursday at 7". An older message edited on 2026-10-16 showed "Earlier versions weren’t kept for this message." Bob's DM to sandy, "are you coming?", was edited to "…on Friday?". Bob's DM view → (edited) showed Now and the Original; sandy's GET returned the same version |
