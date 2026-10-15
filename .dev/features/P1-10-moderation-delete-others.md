# P1-10 — Moderation: wire up `delete_others_messages`

- **Unit Type:** Implementation
- **Phase:** 1 — "Moderation"
- **State:** COMPLETE (merged in Elldreth/DisGourd#50)
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
- [x] New `server/tests/moderation.test.js`:
  - [x] An admin deletes a member's message (OK; all viewers get `message_delete`).
  - [x] A member can't delete another member's message.
  - [x] An admin can't delete an owner's or another admin's message.
  - [x] The owner deletes an admin's message (OK).
  - [x] Once the owner raises the `delete_others_messages` threshold to 3, admins can't delete.
  - [x] A moderator who can't view a private channel can't delete there.
- [x] Manual: the moderator sees Delete on eligible messages only.

## Expected Areas of Change
`server/permissions.js`, `server/db/index.js`, `server/gateway/chat.js`, `web/src/App.jsx` or the spaces hook (compute `canModerate`), `web/src/components/ChatPanel.jsx`, `web/src/components/MessageActions.jsx` (from P3-05), and the new test.

## Assumptions
- ASSUMPTION (kept, not overridden by the user): rank hierarchy applies. You can't moderate equals or superiors, matching the existing kick rule.
- Non-goal: audit log and moderator-delete notices ("deleted by a moderator").

## Activation
- Activated 2026-10-15 on branch `claude/p1-10-moderator-delete`, cut from main @ 534e82e (after P3-05 merged).
- Baseline: 57/57 server tests passing (6 suites).

## Implementation notes
- `getMessageLocation` now also returns `authorId`. Existing callers ignore the extra field.
- `canModerateMessage(space, channel, actorId, authorId)` lives in `permissions.js`. An author who left the server, or whose account is gone, ranks 0.
- Gateway `delete`: the author's own message goes through `db.deleteMessage(id, userId)` (author-scoped, as before). Anyone else's needs `canModerateMessage`, then `deleteMessageById`.
- Client: `App.jsx` computes `canModerate(author)` from the space's `permissions.delete_others_messages`, my rank, and the author's role in the members list. `MessageList` turns that into a per-row `canDelete`. It feeds the existing Delete action, the toolbar button and the Delete key. The confirm text names the author for others' messages. DMs pass no `canModerate`, so others' DMs never show Delete.
- The client check only hides or shows the button. The server enforces.

## Verification (AC → evidence)
| AC | Evidence |
|---|---|
| Admin deletes member's message; viewers notified | `moderation.test.js`: the message is gone, and another member received `message_delete`. |
| Member can't delete member's | Message still present. |
| Admin can't delete owner's / other admin's | Both still present. |
| Owner deletes admin's | Gone. |
| Threshold 3 stops admins | With `delete_others_messages: 3`, the admin is refused and the owner succeeds. |
| No delete where you can't view | An admin is refused in the owners-only channel. The owner succeeds. |
| (extra) authors; departed authors | Authors still delete their own messages. Messages from someone who left can be moderated. |
| Suite | 7 suites, 65/65. ESLint: clean. |
| Manual: Delete only on eligible messages | Sandbox, as owner sandy: bob's server message menu shows Add reaction / Copy / **Delete** (no Edit). Deleting asked "Delete this message from bob?" and removed it. In the DM with bob, his messages show Copy only. |
