# P2-21a — Roles schema, seeded from the fixed tiers, with a resolver that agrees with today's checks

- **Unit Type:** Implementation (child of P2-21)
- **Phase:** 2
- **State:** COMPLETE (merged in #115, 2026-10-18)
- **Effort:** M
- **Depends on:** P1-01 (migrations), P1-06 (permission thresholds)
- **Serialize with:** `server/db/index.js`, `server/db/migrations.js`, `server/permissions.js`

## Decision carried in
Named permissions per role (the existing action names), stored as JSON; channels allow or deny a role to view or post.

## Scope
- **Migration 12:**
  - `roles(id, space_id → spaces CASCADE, name, color, position, permissions JSON, is_default, UNIQUE(space_id, name))`. Higher `position` = more senior. `@everyone` is the default role (position 0) every member has.
  - `member_roles(space_id, user_id, role_id)`: the extra roles a member holds (cascades with the membership and the role).
  - `channel_role_overrides(channel_id, role_id, view, post)`: `1` allow, `0` deny, `NULL` inherit.
  - **Seeding** for every existing server: `@everyone` gets the actions whose threshold is 1, `Admin` (position 1) the actions whose threshold is at most 2; members with the `admin` tier get `Admin`; each channel's `view_role` / `post_role` become overrides (`2` → deny `@everyone`, allow `Admin`; `3` → deny both). The owner (`spaces.owner_id`) is not a role: they bypass every check, as now.
- **Keeping the new tables truthful** while the old checks still run (P2-21b switches them): `syncSpaceRoles(spaceId)` re-derives the seeded roles, memberships and overrides from the tier data, and is called after a server is created, a member added or changed, the server permissions saved, a channel's access changed, or a channel or thread created. It leaves any custom roles and their overrides alone.
- **`resolvePermissions(spaceId, userId, channelId?)`** in `permissions.js`: `null` for a non-member; otherwise `{ owner, actions (Set), position, view, post }`. Owner: everything. Actions: the union of the member's roles' lists (plus `@everyone`). Channel access: `@everyone`'s override first, then the member's roles (an allow from any of their roles wins, else a deny from any, else inherit). Post implies view. `position` is the member's highest role position (owner: `Infinity`), for "strictly above" rules like kick and moderation.
- Nothing calls `resolvePermissions` in production yet; this unit proves it agrees with the old checks.

## Acceptance criteria
- [x] `server/tests/roles-schema.test.js`: on a fixture server (owner, two admins, three members; channels with every view/post combination used today, including a thread; custom server permissions) every member × action agrees between `resolvePermissions` and `canDo`, every member × channel agrees with `canViewChannel` / `canPostChannel`, rank ordering agrees with `roleRank`; the sync keeps agreeing after a promotion, a demotion, a permissions change, a channel access change and a new thread; a custom role with its own permissions and a channel allow works through the resolver; deleting a server or a member removes their rows.
- [x] `db-migrations.test.js` lists the new indexes; the seeding the migration runs for existing servers (`seedAllSpaceRoles`) is tested by deleting the seeded roles and rebuilding them (the migration itself can't be re-run on a fixture built with the current helpers, which already create the roles).
- [x] Sandbox: the sandbox DB upgrades to v12 and each server has `@everyone` and `Admin` with the right members and overrides.
- [x] Every existing server test passes unchanged (no behaviour change).

## Expected Areas of Change
`server/db/migrations.js`, `server/db/index.js`, `server/permissions.js`, new `server/tests/roles-schema.test.js`, `server/tests/db-migrations.test.js`.

## Working Set / Blast Radius
~5 files; no production behaviour changes. The risk is a seeding rule that disagrees with a threshold edge case, which the equivalence test is built to catch.

## Implementation notes
- `syncSpaceRoles(spaceId)` is a transaction: upserts `@everyone` and `Admin` (permissions only, so a renamed colour or custom role is untouched), rebuilds the Admin memberships from the `admin` tier, and writes or removes the two seeded roles' overrides per channel from `view_role` / `post_role` with one rule: for a role of rank *r* and a threshold *t*, `t > r` → deny, `t === r && r > 1` → allow, else inherit. Threads get the same treatment because they carry their parent's thresholds.
- It runs after `createSpaceWithDefaults`, `addMember` (admin), `setMemberRole`, `setSpacePermissions`, `setChannelPerms`, `createChannel` and `createThread`, and once for every server at start-up when the database was below v12 (`seedAllSpaceRoles`).
- The resolver reads `spaces.owner_id` for the owner, so an owner's tier text is never consulted. `position` for the owner is `Infinity`; for members it's their highest role's position (`@everyone` = 0), which reproduces the old member < admin < owner ordering.
- `DEFAULT_PERMISSIONS` is now exported (the resolver gives the owner every action by name).
- New helpers for later slices: `getRoles`, `getRole`, `createRole`, `updateRole`, `deleteRole` (never the default), `getMemberRoleIds`, `addMemberRole`, `removeMemberRole`, `getChannelOverrides`, `setChannelOverride` (`null`/`null` removes the row).

## Evidence (2026-10-18)
| Acceptance criterion | Evidence |
|---|---|
| Seeding mirrors the tiers | `roles-schema.test.js` "the seeded roles, memberships and overrides mirror the tiers": `@everyone` (0, default) and `Admin` (1); with the fixture's thresholds `@everyone` holds `manage_emoji`, `pin_messages` and `Admin` everything up to 2 but not `kick` (3); admins hold Admin, members nothing; overrides per channel for `1/1`, `1/2`, `2/2`, `2/3`, `3/3` |
| Resolver agrees with today's checks | "the resolver agrees with the old checks…": for every member × 9 actions (`canDo`), every member × 6 channels (`canViewChannel`/`canPostChannel`) and every ordered pair (`roleRank`); a non-member is `null`; the owner has everything and `Infinity` |
| Still agrees as things change | "it keeps agreeing as tiers, permissions, channel access and threads change": a promotion, a demotion, new server permissions, a channel made private, a thread in a private channel (closed, then opened with its parent) |
| Custom roles work through the resolver | "a custom role works…": `Mods` with its own actions and a channel allow into an owner-only channel (view yes, post no); an allow from one role beats a deny from another; a lone deny wins over inherit; the tier sync leaves custom roles and memberships alone; delete works |
| Migration seeding for existing servers | "seeding all servers rebuilds the tier roles": the seeded roles deleted and rebuilt by `seedAllSpaceRoles`, then agreement again (custom-role holders excluded, since the old checks can't know their roles) |
| Rows go with the member and the server | "rows go with the member and the server" (cascade through `space_members` and `spaces`) |
| Migrations test | `db-migrations.test.js` lists `idx_member_roles_member` and `idx_roles_space` |
| Full suite | `npx jest`: 28 suites, 264 tests, all passing; no existing test changed |
| Sandbox (sandbox DB only) | The sandbox DB upgraded from v11 to `user_version` 12 on start, and each of its four servers has `@everyone` (`["invite"]`, the default-1 action) and `Admin` (the eight default-2 actions); those servers have no admin-tier members and no private channels, so no memberships or overrides, which is what the tiers say |
