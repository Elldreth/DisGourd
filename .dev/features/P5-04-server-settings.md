# P5-04 — Server settings window and a short server menu

- **Unit Type:** Implementation (child of P5-00)
- **Phase:** 5
- **State:** PLANNED (needs P5-02; owner decision 1)
- **Effort:** L
- **Depends on:** P5-02 (kit)
- **Serialize with:** anything editing `ChannelList.jsx` (server menu), `RolesDialog.jsx`, `ModLogDialog.jsx`, `BansDialog.jsx`, `ServerEmojiDialog.jsx`, `ServerImagineDialog.jsx`
- **Requirement Source:** `design/settings-review-2026-10/REVIEW.md` V1, V2 (server side), V3, V4.

## Scope
- One **Server settings** window (the P5-02 layout) with sections, each shown only with its permission, as the menu items are today:
  - Overview: name (rename), icon (upload, reposition, remove), danger zone with Delete server (owner).
  - Emoji: today's `ServerEmojiDialog` content.
  - Roles: today's `RolesDialog` content; permissions grouped as Channels, Members, Messages, Server, Images.
  - Image generation: allow /imagine here; images per day with "Using the site default (60)" when blank.
  - Moderation: two tabs, Moderation log and Bans.
- The existing dialogs' bodies become section components; the dialogs themselves go away.
- Server menu shrinks to: Invite people, Create channel, Create category, a divider, Server settings (shown when you can manage any section).

## Acceptance criteria
- [ ] AC-1: the server menu has at most five items for the owner; every action that was in it is reachable from Server settings.
- [ ] AC-2: a member with only "Manage server emoji" sees Server settings with only the Emoji section; a member with no management permission sees no Server settings item.
- [ ] AC-3: renaming, icon upload/reposition/remove, emoji add/remove, roles edit, image-generation save, unban and the mod log all still work (existing tests moved, same assertions; a sandbox walk of each).
- [ ] AC-4: role permissions render in the five groups, in a fixed order, with every key in `PERMISSION_ACTIONS` present exactly once.
- [ ] AC-5: Delete server is only in Overview's danger zone, owner only, behind the existing confirm.

## Expected Areas of Change
`components/server-settings/*` (new), `ChannelList.jsx` (menu), `RolesDialog.jsx`, `ModLogDialog.jsx`, `BansDialog.jsx`, `ServerEmojiDialog.jsx`, `ServerImagineDialog.jsx` (bodies extracted), `util.js` (permission groups), tests.

## Working Set / Blast Radius
About 12 files; the risk is losing an action in the move, covered by AC-1 and AC-3.

## Testing Strategy
Move each dialog's tests to its section first (green), then change the menu; add the permission-gating tests (AC-2) before building the gating.

## Out of Scope
Leave server (needs a route, discovered work); new server settings.

## Starting Baseline
To be recorded at activation.
