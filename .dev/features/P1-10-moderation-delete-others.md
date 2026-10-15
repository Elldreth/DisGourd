# P1-10 — Moderation: wire up `delete_others_messages`

- **Unit Type:** Implementation
- **Phase:** 1 — "Moderation"
- **State:** PLANNED
- **Effort:** S
- **Depends on:** P3-05 (the message action menu, so "Delete" for moderators lands in the new accessible menu instead of the hover-only toolbar)
- **Soft-depends on:** P1-05 (`gateway/chat.js`); otherwise edit the `case 'delete'` branch in `server.js`
- **Serialize with:** db/index.js units, MessageList/MessageActions units
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 1. The permission is defined in `DEFAULT_PERMISSIONS` (default rank 2) and shown in the permissions dialog, but nothing enforces it.

## Current state (revalidated)
`db.deleteMessage(id, authorId)` deletes only when `author_id = ?`. The gateway `delete` op never checks `canDo(..., 'delete_others_messages')`. The client shows Delete only when `mine`.

## Scope
- `permissions.js` (or inline before the split): `canModerateMessage(space, channel, actorId, authorId)` is true when the actor can view the channel, `canDo(space, role, 'delete_others_messages')` holds, and the author's rank in that space is *strictly lower* than the actor's (or the author has left the server or been deleted). The owner can always delete.
- db: `deleteMessageById(id)` (unconditional; the caller authorises).
- Gateway `delete`: authors can still delete their own; otherwise use `canModerateMessage`. The broadcast is unchanged.
- `GET /spaces` already returns `permissions` and `role`. The client computes `canModerate` and passes it down. MessageActions shows "Delete" on others' messages when allowed, styled as danger.

## Acceptance criteria
- [ ] New `server/tests/moderation.test.js`:
  - [ ] An admin deletes a member's message (OK; all viewers get `message_delete`).
  - [ ] A member can't delete another member's message.
  - [ ] An admin can't delete an owner's or another admin's message.
  - [ ] The owner deletes an admin's message (OK).
  - [ ] Once the owner raises the `delete_others_messages` threshold to 3, admins can't delete.
  - [ ] A moderator who can't view a private channel can't delete there.
- [ ] Manual: the moderator sees Delete on eligible messages only.

## Expected Areas of Change
`server/permissions.js`, `server/db/index.js`, `server/gateway/chat.js`, `web/src/App.jsx` or the spaces hook (compute `canModerate`), `web/src/components/ChatPanel.jsx`, `web/src/components/MessageActions.jsx` (from P3-05), and the new test.

## Assumptions
- ASSUMPTION: rank hierarchy applies (you can't moderate equals or superiors), matching the existing kick rule. Flag for human.
- Non-goal: audit log and moderator-delete notices ("deleted by a moderator").
