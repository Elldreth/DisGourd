# P5-04 — Server settings window and a short server menu

- **Unit Type:** Implementation (child of P5-00)
- **Phase:** 5
- **State:** COMPLETE (merged in #162, 2026-10-19)
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
- [x] AC-1: the server menu has at most five items for the owner; every action that was in it is reachable from Server settings.
- [x] AC-2: a member with only "Manage server emoji" sees Server settings with only the Emoji section; a member with no management permission sees no Server settings item.
- [x] AC-3: renaming, icon upload/reposition/remove, emoji add/remove, roles edit, image-generation save, unban and the mod log all still work (existing tests moved, same assertions; a sandbox walk of each).
- [x] AC-4: role permissions render in the five groups, in a fixed order, with every key in `PERMISSION_ACTIONS` present exactly once.
- [x] AC-5: Delete server is only in Overview's danger zone, owner only, behind the existing confirm.

## Expected Areas of Change
`components/server-settings/*` (new), `ChannelList.jsx` (menu), `RolesDialog.jsx`, `ModLogDialog.jsx`, `BansDialog.jsx`, `ServerEmojiDialog.jsx`, `ServerImagineDialog.jsx` (bodies extracted), `util.js` (permission groups), tests.

## Working Set / Blast Radius
About 12 files; the risk is losing an action in the move, covered by AC-1 and AC-3.

## Testing Strategy
Move each dialog's tests to its section first (green), then change the menu; add the permission-gating tests (AC-2) before building the gating.

## Out of Scope
Leave server (needs a route, discovered work); new server settings.

## Starting Baseline
Revision: `3caad5f` (main after #161). Web suite before: 85 files / 704 tests.

## Implementation notes
- `components/server-settings/`:
  - `ServerSettingsDialog.jsx`: the window, on `SettingsLayout`, with `Modal.Header` "Server settings" and the server's name as the subtitle, `md:max-w-5xl` so Roles' two panes fit.
  - `OverviewSection.jsx` (new): the icon (upload, reposition, remove, at once), the name (through the save bar), and a danger zone with Delete server for the owner.
  - The five old dialogs moved here as sections, without their windows: `RolesSection`, `EmojiSection`, `ImagineSection`, `ModLogSection`, `BansSection`.
- Sections and who sees them: Overview (can edit the server, or owner), Emoji (manage emoji), Roles (manage roles), Image generation (can edit and the instance reports /imagine), then a **Moderation** group with Moderation log (any moderation permission) and Bans (ban). These are the same checks the menu items used.
- Emoji, Moderation log and Bans load on their first visit, then stay mounted. The window doesn't fetch three lists the moment it opens.
- The server's Image generation section now uses a switch and the save bar, instead of Save/Cancel. A rename or an image-generation change makes Close ask "Discard changes?".
- "Saved" after a rename is kept by the window. A rename reloads the server list, and the section briefly remounts, which lost a local flag; I found this in the sandbox and fixed it.
- The server menu is now Invite people, Create channel, Create category, a separator and Server settings. The inline rename in the header and the hidden icon input are gone (both are in Overview now). `App` passes `serverIcon` instead of `hasIcon`.
- Role permissions use the new `PERMISSION_GROUPS` in `util.js`: Channels, Members, Messages, Server, Images. They stay checkboxes, since that's a checklist, not on/off settings.
- Wording: "server menu → Image generation" became "Server settings → Image generation" in the /imagine limit message (server and client), its tests and the site-admin Overview.
- Tests:
  - The moved dialogs' tests now import the sections. Assertions on the old window names ("Roles — S", "Bans — Tx", …) were dropped, because those windows no longer exist.
  - Tests that went through the menu now go through Server settings.
  - `polish.test` now checks that a separator sets Server settings apart and that Delete server isn't in the menu.
  - In ImagineSwitches, the server image settings test makes a change before saving, because of the save bar.
  - New `ServerSettings.test.jsx`: 7 tests.

## Discovered Work (not done here)
- Members still can't leave a server (needs a route; recorded in P5-00).

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | Test + sandbox | The owner's menu is exactly Invite people, Create channel, Create category, Server settings (`ServerSettings.test.jsx`; `shots/p5-04-server-menu.jpg`). Every old item is in the window: Overview (rename, icon, delete), Emoji, Roles, Image generation, Moderation log, Bans |
| AC-2 | Verified | Tests | Only manage_emoji → only the Emoji tab. No management permission → no Server settings item. Only delete_others_messages → only the Moderation log tab (`ModLogDialog.test.jsx`). An editor who isn't the owner gets Overview without the danger zone |
| AC-3 | Verified | Tests + sandbox | The moved tests pass with the same behaviour checks. Sandbox, as sandy in Tx Check: the image limit was saved as 99 (the server returned `ownLimit: 99`) and put back to 100. A rename to "Tx Renamed" updated the header and the window's subtitle, then I renamed it back. Emoji ("No custom emoji yet"), Bans ("Nobody is banned.") and the log (11 entries) loaded on their first visit. Roles shows its editor with grouped permissions (`shots/p5-04-roles*.jpg`) |
| AC-4 | Verified | Test + sandbox | `PERMISSION_GROUPS` covers every key in `PERMISSION_ACTIONS` exactly once, in the five groups. In the window, Pin messages appears under Messages |
| AC-5 | Verified | Tests + sandbox | Delete server isn't in the menu. It's in Overview's danger zone for the owner only, behind the same type-the-name confirm (`ConfirmDialog.test.jsx` now goes through Server settings). `shots/p5-04-overview.jpg` |
| Suites | Verified | Vitest, Jest, Vite | Web 86 files / 711 tests; server `imagine.test.js` 13/13 (the wording change); `vite build` clean |
| Phone | Verified | Sandbox at 375×812 | The section list, then Roles stacked (the role list above the editor), 375 px wide with nothing overflowing (`shots/p5-04-phone-roles.jpg`) |
