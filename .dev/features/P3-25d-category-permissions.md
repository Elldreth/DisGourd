# P3-25d — Category permissions (copied to channels)

- **Unit Type:** Implementation (child of P3-25)
- **Phase:** 3
- **State:** PLANNED (READY once P3-25a merges; independent of b and c except for where the button lives)
- **Effort:** M
- **Depends on:** P3-25a (P3-25b for the UI entry point)

## Scope
- **Storage:** `category_role_overrides(category_id → channel_categories ON DELETE CASCADE, role_id, view, post)`, in the same shape as `channel_role_overrides`.
- **Category settings** (from the category's ⋯ menu): the same per-role "can see / can post" editor as ChannelSettingsDialog, reusing its component. A note explains that channels created in or moved into the category start with these, and that existing channels aren't changed.
- **Copying, with no syncing afterwards:**
  - creating a channel in a category copies the category's overrides onto it;
  - a layout change that moves a channel into a different category replaces the channel's overrides with a copy of the new category's (stated in the move confirmation when the category has any);
  - moving to uncategorized keeps the channel's own.
- **The ⋯ menu offers "Apply to all channels in this category"** as an explicit, confirmed action, for when the owner does want everything changed.
- **Live:** channel visibility changes reach members as they do today for channel permission edits.

## Acceptance criteria
- [ ] Server: category overrides saved / read (managers only); create-in-category copies; moving into a category replaces the overrides (and access follows: a hidden channel disappears for a member who can't see it); uncategorizing keeps them; Apply to all overwrites every channel in it.
- [ ] Web: the category settings editor, the move-confirmation wording, and the Apply to all confirmation.
- [ ] Sandbox: a private category; creating a channel in it hides that channel from a member without the role.
