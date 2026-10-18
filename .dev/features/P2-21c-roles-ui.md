# P2-21c — Role management: the roles screen, member roles and channel overrides

- **Unit Type:** Implementation (child of P2-21)
- **Phase:** 2
- **State:** REVIEW
- **Effort:** M
- **Depends on:** P2-21b (every check reads the roles tables)
- **Starting baseline:** main at e37729a (P2-21b merged, #116)
- **Serialize with:** `server/db/index.js`, `server/routes/spaces.js`, `ChannelList.jsx`, `ChannelSettingsDialog.jsx`, `MemberList.jsx`, `useSpaces.js`

## Why
P2-21b made the roles tables decide everything, but nothing in the app can make or change a role yet: the screens still speak in the old fixed tiers (Everyone / Admins & owner / Owner only), and "Make admin" is the only way to give anyone more than the basics.

## Scope
- **Roles become the source of truth.** Live paths stop re-deriving the seeded roles from the tier columns, so an edit made on the roles screen sticks: creating a channel or a thread no longer re-syncs; a thread answers with its parent channel's overrides (resolved in `resolveAccess`, not copied). The legacy tier helpers and endpoints (`PUT /permissions`, channel `PATCH …/permissions`, member `PATCH {role}`) stay for compatibility, but write only what they name (the `@everyone` / `Admin` permissions, that channel's `@everyone` / `Admin` overrides, the `Admin` membership) instead of rebuilding everything. The full re-seed runs only for a new server and the v12 upgrade.
- **Roles API** (`server/routes/roles.js`, mounted inside the spaces route):
  - `GET /spaces/:s/roles` (any member): roles top to bottom with `id, name, color, position, isDefault, permissions, members` (usernames).
  - `POST /spaces/:s/roles` `{ name, color?, permissions? }` → a new role at the bottom (just above `@everyone`).
  - `PATCH /spaces/:s/roles/:id` `{ name?, color?, permissions? }`; `DELETE /spaces/:s/roles/:id`.
  - `PUT /spaces/:s/roles/order` `{ ids }` (bottom to top) — reorders the roles you manage within the positions they already hold.
  - `PUT` / `DELETE /spaces/:s/members/:u/roles/:id` — give or take a role.
  - `GET` / `PUT /spaces/:s/channels/:c/overrides` `{ overrides: [{ roleId, view, post }] }` (1 allow, 0 deny, null default).
  - Every change broadcasts `space_updated` (and `members_changed` for holders), so abilities and channel lists refresh live.
- **Hierarchy:** managing roles needs `manage_roles`; you can only edit, delete, reorder, give or take roles *strictly below* your own highest role (the owner: any). You can't grant a permission you don't hold. `@everyone` can't be deleted, renamed or moved. Channel overrides need the existing "manager" right (owner or `edit_server`) and follow the same rule per role (`@everyone` is always editable by a manager).
- **App:**
  - A **Roles** screen (server menu → Roles, for `manage_roles`) replaces the old Permissions dialog: the role list (highest first) with Move up / Move down buttons and Create role; for the selected role its name, colour (swatches + a colour picker), a checklist of permissions, and its members (add from a list, remove). Roles you can't manage are shown read-only with the reason.
  - The member menu's **Make admin / Remove admin** becomes **Roles…**, a checklist of the roles you may give.
  - **Channel settings** replace the tier selects with a table: one row per role, View and Post each Default / Allow / Deny (voice: View only).
  - The member list badge shows the member's highest role name (Owner for the owner) instead of the tier.

## Non-goals
- Role colours on names and grouping the member list by role (P2-21d).
- Drag-and-drop ordering (buttons are the accessible path; drag can come later).
- Removing the tier columns from the database.

## Acceptance criteria
- [x] Server `roles-api.test.js`: create / rename / recolour / change permissions / delete a role; reorder; give and take roles; channel overrides read and write and take effect (a private channel opens for a role holder); new roles land at the bottom.
- [x] Hierarchy: a non-owner with `manage_roles` can't edit, delete, reorder, give or take a role at or above their highest, can't grant a permission they lack, and can't touch `@everyone`'s name or position; non-managers get 403.
- [x] Roles stick: after giving bob a custom role and editing `Admin`'s permissions on the roles screen, creating a channel and starting a thread leave both intact; a thread inherits a role's allow on its parent.
- [x] Legacy endpoints still pass the existing suites unchanged.
- [x] Web tests: the Roles screen lists roles, creates, reorders with the buttons, toggles permissions and edits members, and disables roles you can't manage; the member Roles… checklist gives and takes a role; channel settings save per-role overrides; the badge shows the top role.
- [x] Sandbox (sandbox DB only): as sandy, create a "Mods" role on the Roles screen, give it to bob, allow it on a private channel; bob's open tab gains the channel without a reload; take the role and it goes.

## Expected Areas of Change
`server/db/index.js`, `server/routes/roles.js` (new), `server/routes/spaces.js`, `server/tests/roles-api.test.js` (new), `web/src/api.js`, `web/src/state/useSpaces.js`, `web/src/components/RolesDialog.jsx` (new), `MemberRolesDialog.jsx` (new), `ChannelSettingsDialog.jsx`, `ChannelList.jsx`, `MemberList.jsx`, `App.jsx`; `ServerPermissionsDialog.jsx` removed; tests.

## Working Set / Blast Radius
~14 files. Access itself is unchanged for anyone without custom roles; the risk is the legacy helpers' targeted writes drifting from the old full sync, which the existing suites and the P2-21a equivalence test cover.

## Implementation notes
- `db/index.js`: `applyTierPermissions`, `applyTierChannel` and `applyTierMember` replace the full `syncSpaceRoles` calls in `setSpacePermissions`, `setChannelPerms`, `setMemberRole` and `addMember`; they touch only `@everyone`, the role still named `Admin` (if it exists) and the one channel or member. `createChannel` seeds only a server that has no roles yet (servers made through the bare test helpers); `createThread` no longer copies anything, because `resolveAccess` maps a thread to its parent's overrides. `syncSpaceRolesByName` is gone.
- New helpers: `createRoleAtBottom` (shifts the others up one), `reorderRoles` (reassigns the positions the listed roles already hold, so nothing can cross the actor), `getRoleHolders`, `getMemberRolesMap`. Members in `GET /spaces/:s/members` carry `roles` (ids).
- `server/routes/roles.js` is called from the spaces route straight after membership and access are known (before the member PATCH/DELETE routes, which would otherwise match `/members/:u/roles/:id`). Unknown permission names are dropped before the "you can't grant what you don't hold" check. Role changes broadcast `members_changed` (clients reload members, roles and their servers); override changes broadcast `space_updated`.
- Web: `useSpaces` loads `roles` with the members and exposes `canManageRoles`, `setMemberHasRole`, `reloadRoles`; `RolesDialog` (server menu → Roles) replaces `ServerPermissionsDialog` (deleted); `MemberRolesDialog` opens from the member menu; `ChannelSettingsDialog` loads and saves overrides; `Icon` gains `chevronUp`.

## Evidence (2026-10-18)
| Acceptance criterion | Evidence |
|---|---|
| Roles API | `roles-api.test.js` (11): any member reads the roles highest first with holders; the owner creates (lands at position 1, Admin moves up; duplicate 409, `@everyone` 400, bad colour 400, unknown permission names dropped), renames / recolours / changes permissions, deletes; `@everyone` keeps its name and can't be deleted; reorder (partial list 400; full list swaps); give and take (members carry `roles`; abilities follow; `@everyone` 400; unknown member 404); overrides read and written, a deny on `@everyone` plus an allow on Moderators opens `vault` to bob (200) and not cara (403); non-managers 403; unknown role 400; unknown channel 404 |
| Hierarchy | Same file, a `Managers` role (manage_roles, kick, pin) between Moderators and Admin: editing Admin or their own role 403, deleting Admin 403, editing Moderators 200, a new role lands below them; granting `edit_server` or adding `delete_channel` 403, removing a held permission 200; reordering with Admin included 400, only theirs 200; giving Admin 403, giving Helpers to cara and themselves 200, taking from a member above (cara as admin, the owner) 403; overrides need `edit_server` (403 → 200 once granted), an Admin override 403, `@everyone` 200 |
| Roles stick | Same file: after Admin's permissions were set to `kick` on the API, creating a channel and starting a thread left Admin at `['kick']` and bob's Moderators intact; the thread in `vault` answered bob 200 and cara 403 (its parent's overrides) |
| Legacy endpoints unchanged | Server: 30 suites, 280 tests (269 before + 11 new); no existing test edited |
| Web | `RolesDialog.test.jsx` (11): list order and initial selection; Create role; Move up/down sends bottom to top and disables the ends; editing name, colour (radio) and permissions then Save; `@everyone` read-only name, no colour, no delete; add and remove members; Delete asks first; a manager sees roles at/above them read-only, can't tick permissions they lack, may add only members below them or themselves; channel settings load overrides, lock roles above you and save the editable rows; voice shows only See & join; the member list badge shows Owner / the top role, and Roles… gives a role (and is absent for a member above you). Whole suite: 63 files, 540 tests; `vite build` clean |
| Sandbox (sandbox DB only) | As sandy on Tx Check: server menu → Roles opened the screen (Admin, @everyone); Create role made "New role" below Admin; renamed to Mods, picked blue, ticked Pin messages, saved; added bob from the member picker (his badge became MODS). bob, signed in on a second origin, had no `staff`. `staff` settings showed @everyone Deny/Deny and Admin Allow/Allow (the seeded tiers); setting Mods to Allow/Allow and saving made `staff` appear in bob's open tab without a reload. Member menu → bob → Roles… showed Admin (unticked) and Mods (ticked); unticking it removed `staff` from bob's tab and the badge from the list |
