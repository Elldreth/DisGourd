# P11-02 — Role hierarchy on the legacy member-tier route

- **Unit Type:** Implementation (child of P11-00)
- **Phase:** 11
- **State:** REVIEW (build order 3 in P11-00)
- **Effort:** S
- **Depends on:** none
- **Serialize with:** none
- **Requirement Source:** P11-00 finding H1.

## Problem
`PATCH /spaces/:s/members/:u { role: 'admin' | 'member' }` (`server/routes/spaces.js:179-188`) checks only `manage_roles`. Through `applyTierMember` (`server/db/index.js:336-342`) it adds or removes the seeded Admin role, with none of the hierarchy rules in `server/routes/roles.js:132-149`. A "Mods" member holding `manage_roles` can make themself Admin, or take Admin away from someone above them. Reproduced in `.dev/security/p11-00-proof.js`.

## Scope
- The web app doesn't call this route; it uses `PUT/DELETE /members/:u/roles/:id` (`web/src/api.js:280`). **Remove the PATCH route** (it answers 404 like any unknown path).
- If a server test or tool still needs it, keep it but apply the roles rules: the Admin role must sit below the actor's highest role (unless they're the owner), and the target must be below the actor or be the actor.
- Log it to the moderation log like `role_add` / `role_remove`.

## Acceptance criteria
- [x] AC-1: a member whose highest role holds `manage_roles` but sits below Admin can't gain Admin through any route (403 or 404).
- [x] AC-2: they can't remove Admin from someone at or above them.
- [x] AC-3: the owner can still give and take Admin through the roles route.
- [x] AC-4: the web suites pass unchanged (nothing in the app used the route).

## As built
- **The route is removed** from `server/routes/spaces.js`. `PATCH /spaces/:s/members/:u` now falls through to the spaces router's 404. Nothing in `web/src` called it (checked: the only member PATCH-style changes go through `/members/:u/roles/:id`, `/timeout`, and `DELETE` for kicks).
- **No logging change was needed:** the roles route already logs `role_add` / `role_remove`.
- **`db.setMemberRole`** stays: ownership transfer and some tests use it.
- **Tests:**
  - `api.test.js` gave Admin through the old route; it now uses `PUT /members/tara/roles/<Admin id>` and checks the member's `roles`.
  - A new regression test is at the end of `roles-api.test.js`.

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | Jest `roles-api.test.js` + sandbox | The new test failed before the fix (`PATCH /members/mgr { role: 'admin' }` → 200), and passes after: 404; `PUT /members/mgr/roles/<Admin>` → 403; mgr has no Admin role and no `ban_members`. Sandbox :3005 (Tx Check): a temporary "P11-02 Mods" role with `manage_roles` was given to bob; his legacy PATCH → 404, roles route → 403 "You can only give or take roles below your own", no Admin. The role was then deleted, and bob's roles were back to what they were |
| AC-2 | Verified | Jest | `PATCH /members/cara { role: 'member' }` → 404; `DELETE /members/cara/roles/<Admin>` → 403; cara keeps Admin |
| AC-3 | Verified | Jest | The owner's `PUT` and `DELETE /members/bob/roles/<Admin>` → 200 both ways |
| AC-4 | Verified | Vitest | Web 106 files / 841 tests, no changes in `web/` |
| Suites | Verified | Jest | Server 56 suites / 506 tests |

## Not in scope
Any other change to the roles model.
