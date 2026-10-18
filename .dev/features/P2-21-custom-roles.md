# P2-21 — Custom roles with colours and a permission matrix (Container, L)

- **Unit Type:** Container
- **Phase:** 2, rank 13
- **State:** PLANNED (P2-21a, P2-21b, P2-21c COMPLETE; P2-21d ACTIVE; child packets written as each starts)
- **Effort:** L
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 2 #13

## Current state (revalidated)
There are three fixed tiers (member=1, admin=2, owner=3), stored as `space_members.role` text. Server action thresholds are a JSON blob in `spaces.permissions`. Per-channel `view_role` and `post_role` hold rank integers. Rank comparison is hard-coded in `db/index.js` (`roleRank`, `memberRankSql`) and in the client (`util.js` `ROLE_RANK`).

## Why decompose (two or more High dimensions)
It touches the data model, the authorisation logic across every gate, and a complex UI. It needs migrating existing servers without access regressions.

## Children (sketch — author full packets after P1 completes)
| ID | Title | Depends on | Acceptance (summary) |
|---|---|---|---|
| P2-21a | Roles schema + migration from tiers | P1-01, P1-06 | Tables `roles(id, space_id, name, color, position, permissions bitset)` and `member_roles`. Existing tiers become seeded roles (`@everyone`, Admin, plus the owner flag). Channel gates move to per-role overrides. A migration test asserts identical access before and after for a fixture server. |
| P2-21b | Permission resolution in `permissions.js` | P2-21a, P1-05 | A single `resolvePermissions(spaceId, userId, channelId?)` replaces `canDo`, `roleRank` and the SQL rank CASE. The 0.3 private-channel and role test suites pass unchanged. |
| P2-21c | Role management UI (create, reorder, colour, permission matrix) | P2-21b, P3-01 | Role hierarchy enforced: you can't edit roles at or above your highest. Keyboard-accessible matrix. |
| P2-21d | Role colours in names and member-list grouping | P2-21c | Author names take the colour of their highest coloured role. Contrast-checked against both themes. |

## Decisions (user, 2026-10-18)
| Question | Decision |
|---|---|
| Permission model | **Named permissions per role.** Each role carries a list of named actions it allows (the existing action names: `create_channel`, `delete_channel`, `invite`, `kick`, `edit_server`, `delete_others_messages`, `pin_messages`, `manage_emoji`, `manage_roles`), and a channel can allow or deny a role to view or post. Stored as names (JSON), not a bit field. |
| Start | Now, as four PRs in the order a → b → c → d. |
