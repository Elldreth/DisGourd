# P3-27 — Message edit history

- **Unit Type:** Implementation
- **Phase:** 3
- **State:** READY
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

## Acceptance criteria
- [ ] Server: an edit saves the old text with the right time (original → created_at; later → the previous edited_at); a same-text edit saves nothing; GET returns them oldest first with the current text for viewers, and 404 for people who can't see the channel or aren't in the DM; deleting the message (or the channel / server) removes its versions; DMs the same.
- [ ] Web: "(edited)" opens the dialog; versions newest first under "Now", rendered as messages; the "weren't kept" text for old edits; DMs too.
- [ ] All suites pass; `vite build` is clean.
- [ ] Sandbox: bob edits a message twice; sandy opens its history and sees all three versions; a DM edit shows its history to both.
