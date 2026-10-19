# P3-26a — Moderation log

- **Unit Type:** Implementation (child of P3-26)
- **Phase:** 3
- **State:** REVIEW
- **Starting baseline:** main at df928ba (#150, #151 merged)
- **Effort:** M
- **Depends on:** none (P3-26 design agreed)

## Scope
- **Migration:** `mod_log(id, space_id → spaces ON DELETE CASCADE, actor_id, actor_name, target_id, target_name, action, reason, details TEXT (JSON), created_at)` with index (space_id, created_at).
- **`db.logModAction(spaceId, { actorId, targetId, action, reason, details })`** stores the names at the time.
- **Written from today's actions:**
  - `message_delete` (someone else's message: channel, excerpt);
  - `kick`;
  - `role_add` / `role_remove` (role name);
  - `channel_access` (channel, which roles changed);
  - `category_access` and `channel_settings` (18+ / topic) are optional extras if cheap.
- **`GET /spaces/:s/mod-log?before=<id>&action=&user=`** returns 50 per page, newest first. It needs ban_members, timeout_members, kick, delete_others_messages or manage_roles (owner always).
- **App:** "Moderation log" in the server menu for those people. A dialog lists the entries ("**sandy** deleted a message by **bob** in #general: "…" · 3:42 PM"), with an action filter and a "Load older" button.

## As built
- **Migration v20:** `mod_log` as above, indexed on (space_id, id); `getMessageLocation` now also returns the message's content (for the excerpt).
- **Logged:** `message_delete` (someone else's: channel, excerpt up to 100 characters), `kick`, `role_add` / `role_remove` (only when it changed something), `channel_access` and `category_access` (each changed role's new view / post). Channel settings (18+ / topic) aren't logged yet; slow mode will be, in P3-26d.
- **GET `/spaces/:s/mod-log`:** `{ entries: [{ id, actor, target, action, reason, details, createdAt }], more }`; `user` matches the person as actor or target; an unknown user gives an empty page.
- **App:** "Moderation log" in the server menu (owner, or any of the five permissions). The dialog has Action and Person filters, "Load older", and an error line.

## Acceptance criteria
- [x] Server: each action writes an entry with the right fields; message deletes by the author aren't logged; GET is permission-gated, paged and filterable; entries go when the server is deleted.
- [x] Web: the menu item only for those allowed; entries are rendered readably; filter and paging.
- [x] All suites pass; `vite build` is clean.
- [x] Sandbox: a delete and a kick show up in the log.

## Evidence (2026-10-19)
| Acceptance criterion | Evidence |
|---|---|
| Server | `mod-log.test.js` (8): an admin's delete of a 205-character message → `message_delete`, admin → member, `#general`, a 100-character excerpt; deleting your own → no entry; kick → `kick`; give / take "Helpers" → `role_add` / `role_remove` with the role name, a no-op take not logged; channel and category overrides → `channel_access` / `category_access` with `{ role, view, post }`; a member → 403, an admin → 200, a member with only "Remove members" → 200; `?action=kick`, `?user=member2`, `?user=nobody` → empty; 60 entries → 50 + `more`, then 10 via `before`; deleting the server removes its entries. Server suites: 38 files, 372 |
| Web | `ModLogDialog.test.jsx` (4): the five kinds read as sentences (with excerpt and Reason), Load older asks with `before` = the last id and appends, the filters re-ask, the empty-filter text, the error line; the menu item hidden for a member with only `invite`, shown for `delete_others_messages` and for the owner, and it opens the dialog. Web suites: 77 files, 654; `vite build` clean |
| Sandbox (:3005, restarted on this branch) | In Tx Check: bob posted a spam line, sandy deleted it, sandy removed cara (cara then rejoined with a new invite). Sandy → server menu → Moderation log shows "sandy removed cara from the server · Today · 04:52 PM" above "sandy deleted a message by bob in #general: “Buy cheap gourds at gourd-deals dot example, limited time!”". Bob's GET → 403 |
