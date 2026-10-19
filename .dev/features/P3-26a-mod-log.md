# P3-26a — Moderation log

- **Unit Type:** Implementation (child of P3-26)
- **Phase:** 3
- **State:** READY
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

## Acceptance criteria
- [ ] Server: each action writes an entry with the right fields; message deletes by the author aren't logged; GET is permission-gated, paged and filterable; entries go when the server is deleted.
- [ ] Web: the menu item only for those allowed; entries are rendered readably; filter and paging.
- [ ] All suites pass; `vite build` is clean.
- [ ] Sandbox: a delete and a kick show up in the log.
