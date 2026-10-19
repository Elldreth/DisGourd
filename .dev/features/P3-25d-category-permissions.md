# P3-25d — Category permissions (copied to channels)

- **Unit Type:** Implementation (child of P3-25)
- **Phase:** 3
- **State:** REVIEW
- **Starting baseline:** main at 1ffd632 (#146 merged)
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
- [x] Server: category overrides saved / read (managers only); create-in-category copies; moving into a category replaces the overrides (and access follows: a hidden channel disappears for a member who can't see it); uncategorizing keeps them; Apply to all overwrites every channel in it.
- [x] Web: the category settings editor, the move-confirmation wording, and the Apply to all confirmation.
- [x] Sandbox: a private category; creating a channel in it hides that channel from a member without the role.

## Implementation notes
- **Migration v18:** `category_role_overrides`. GET /spaces categories carry `hasOverrides`.
- **A plain category leaves a channel's access alone.** Moving a channel into a category with no overrides keeps the channel's own (replacing them with "nothing" would quietly open a private channel). Only a category with its own access replaces them, and the app asks first ("#x will take Y's permissions, replacing its own"). Moving to the top keeps them; reordering within a category changes nothing.
- **"Apply to all channels"** saves the editor first, then copies onto the channels in that category the manager can see (hidden ones are never touched), and reports how many.
- **Routes** sit beside the channel overrides in `routes/roles.js` and use the same rules (owner / edit_server; roles below your own).
- **The dialog is ChannelSettingsDialog in a `category` mode:** the same role table; no topic, 18+, place or delete; "Apply to all channels in …" with an inline confirmation.

## Evidence (2026-10-18)
| Acceptance criterion | Evidence |
|---|---|
| Server | `category-permissions.test.js` (6): set and read by the owner; member 403; unknown role 400; non-list 400; unknown category 404; `hasOverrides` true / false. Creating "mods" in the private category copies @everyone deny + Staff allow: hidden from the member, seen by the Staff helper and the owner; "chat" in a plain category stays open. No syncing: changing the category later leaves mods private. Moving chat in → private; out to the top → still private; into a plain category → still private; a reorder within its category copies nothing (the channel's own Staff 1/0 kept). Apply to all: member 403; changed 1; mods visible again; a full copy (Staff post 0 → 1); unknown 404. Deleting the category removes its overrides, and channels keep theirs. All server suites: 358 |
| Web | `ChannelCategories.test.jsx` (10, 2 new): ⋯ → Permissions… opens "Text channels permissions" loading the category's access (@everyone view Deny), with no Topic or Delete; Staff Allow → Apply to all asks ("Their own settings are overwritten"), then saves and applies, shows "Applied to 2 channels.", and refreshes. Moving news into a plain category goes straight through; into one with access → "Move into Empty?" with "#news will take Empty’s permissions, replacing its own", nothing sent until Move. Web suites: 76 files, 643; `vite build` clean |
| Sandbox | Restarted on this branch (v18 on the sandbox copy). As sandy: server menu → Create category "Mods only" → Permissions… (@everyone, Admin, Mods listed) → @everyone view Deny → Save; + → "mod-talk": sandy sees it marked private (`private: true`, category 11, `hasOverrides` true); bob (a second tab) doesn't see mod-talk or the category. #history → settings → Category "Mods only" → "Move into Mods only? #history will take Mods only’s permissions, replacing its own."; Cancel left it in Text channels. mod-talk and Mods only were deleted afterwards; Tx Check is back to its two categories and 7 channels |
