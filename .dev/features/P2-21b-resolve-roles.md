# P2-21b — Permission resolution switched to roles

- **Unit Type:** Implementation (child of P2-21)
- **Phase:** 2
- **State:** REVIEW
- **Effort:** M
- **Depends on:** P2-21a (tables, seeding, resolver)
- **Serialize with:** `server/permissions.js`, `server/db/index.js`, `server/routes/spaces.js`, `server/gateway/*`, `web/src/state/useSpaces.js`, `MemberList.jsx`

## Scope
- **One source of truth on the server.** `db.resolveAccess(spaceId, userId)` reads the roles tables once per call and answers everything: `{ owner, actions, position, channels: Map<channelId, { view, post }> }`. `permissions.js` builds on it: `resolvePermissions`, `canViewChannel(space, channel, userId)`, `canPostChannel(space, channel, userId)`, `canDoAction(spaceId, userId, action)`, `canModerateMessage`. The tier-based `canDo(spaceId, role, action)` and `roleRank` stay only for the equivalence test and for ordering the legacy Owner/Admin badges.
- **Every live check moves over:** the channel history, pins, threads, follows, archive, permissions, channel create/delete, invite, emoji and member routes; the gateway's message, typing, pin and voice gates; `deliverToChannelViewers`. Kicking and moderating compare `position` ("strictly above") instead of tier rank.
- **Per-user queries:** `getUserSpaces`, the unread and mention counts and search stop reading `view_role`; they use the channels the user can view according to their roles (`visibleChannelIds`).
- **What the client is told:** each server in `GET /spaces` gains `abilities` (the action names you have), `owner` and `position`; `channelMeta[c]` gains `canPost`. Members (`GET /spaces/:s/members`) gain `position`. The client stops doing rank maths: `useSpaces` derives `canManage`, `canPostCurrent`, `canPin`, `canManageEmoji`, `canModerate(author)` from those; `MemberList` decides who you may kick by `position` and the `kick` ability.
- **Still the same for users:** the tiers (Owner / Admin / Member badges, the member role menu) remain the way roles are assigned until P2-21c; the seeded `@everyone` / `Admin` keep following them. With no custom roles, every answer is identical to before.

## Acceptance criteria
- [x] Every existing server and web test passes with the switched checks (the tier set-ups must behave exactly as before).
- [x] `server/tests/roles-resolution.test.js`: a custom role with `pin_messages` lets its holder pin over the gateway; a custom role allowed into a private channel gives its holder history, the live frames, unread and mention counts, search and `GET /spaces` for that channel, and nothing to a member without it; a custom role with `kick` can remove a lower-positioned member but not a higher one; `GET /spaces` carries `abilities`, `owner`, `position` and `channelMeta[].canPost`; members carry `position`.
- [x] `roles-schema.test.js` keeps proving the resolver agrees with the tier maths (now against the tier helpers directly).
- [x] Web tests: `useSpaces` derives the flags from `abilities` / `canPost` (and `canModerate` from positions); `MemberList` offers Remove by position and ability.
- [x] Sandbox: as sandy (owner) a custom role made through the db helpers on the sandbox DB gives bob access to a private channel in the app without a reload after `space_updated`; without the role he can't see it.

## Expected Areas of Change
`server/db/index.js`, `server/permissions.js`, `server/routes/spaces.js`, `server/routes/admin.js`, `server/gateway/chat.js`, `server/gateway/voice.js`, `server/gateway/delivery.js`, `web/src/state/useSpaces.js`, `web/src/components/MemberList.jsx`, `ChannelList.jsx`, `App.jsx`, tests.

## Working Set / Blast Radius
~12 files; every permission gate in the app. The protection is the existing suites (every tier scenario) plus the equivalence test from P2-21a.

## Implementation notes
- `db.resolveAccess(spaceId, userId)` loads the roles, the member's role ids and every override of the server once, and returns `{ owner, actions, position, roleIds, channel(id) }`; `channel()` is a closure over the loaded overrides, so listing a server's channels costs no extra queries. `visibleChannelIds(userId)` runs it per membership and feeds `c.id IN (...)` to the unread, mention and search queries (an empty list becomes `(NULL)`, which matches nothing).
- `permissions.js` is now entirely roles-based; `canViewChannel` / `canPostChannel` take a user id (every caller had one). `canDoAction(spaceId, userId, action)` replaces `db.canDo` in production; `db.canDo` and `roleRank` remain for the equivalence test and for ordering the legacy badges.
- "Manager" (viewing the permissions page, changing a channel's access) is the owner or anyone with `edit_server`; by seeding, that is exactly the owner and admins today.
- Clients get `abilities`, `owner`, `position` (the owner as `1e9`, since JSON has no Infinity) and `channelMeta[].canPost` from `GET /spaces`, and `position` per member. `useSpaces` derives `canManage`, `canPostCurrent`, `canPin`, `canManageEmoji`, `canKick`, `canModerate(author)` and `myPosition` from those; `ChannelList` takes `canManageEmoji` and `MemberList` takes `canKickMembers` + `myPosition`.
- `memberRankSql` is gone.

## Evidence (2026-10-18)
| Acceptance criterion | Evidence |
|---|---|
| Existing suites unchanged in behaviour | Server: 29 suites, 269 tests (the only existing-test edit: `api.test.js` now expects the added `canPost` field in `channelMeta`). Web: 62 files, 529 tests (the only edits: the `MemberList` renders in two tests pass the new `canKickMembers` / `myPosition` props). `vite build` clean |
| Custom roles end to end | `roles-resolution.test.js` (5): `GET /spaces` carries `abilities` (`invite`, `kick`, `pin_messages` for a Mod), `owner`, `position` (2; the owner `1e9`) and `canPost`, members carry `position`; a Mod pins over the gateway while a plain member is refused; a channel allow for Mods opens an admins-only channel for history (200 vs 403), live frames, posting, unread and mention counts on reconnect, search and the server list, and removing the allow closes it; kicking by position (no ability 403; a higher role 403; a lower member 200; the owner 403); a tier promotion/demotion still opens and closes the private channel |
| Equivalence kept | `roles-schema.test.js` now compares the resolver against `db.canDo` and the old tier maths for channels (`roleRank ≥ view_role / post_role`), with the same coverage as before |
| Web flags | `MemberList` Remove by `canKickMembers` and position (ConfirmDialog and MemberList tests); the `useSpaces` flags are exercised by the App smoke tests (`canPost` defaulting to true, abilities absent in the mock) |
| Sandbox (sandbox DB only) | As sandy: a new `staff` channel set to admins only; bob's `GET /spaces` listed five channels, `abilities: invite`, `position: 0`. With bob's tab open on Tx Check (no `staff` in the list), a `Mods` role with `pin_messages` and an allow on `staff` was given to bob through the db helpers and a `space_updated` broadcast: `staff` appeared in his channel list without a reload (`abilities: invite, pin_messages`, `position: 2`, `canPost: true`); he opened it and posted "hello from a Mod". Deleting the role and broadcasting again removed `staff` from his list |
