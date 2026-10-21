# P11-02 — Role hierarchy on the legacy member-tier route

- **Unit Type:** Implementation (child of P11-00)
- **Phase:** 11
- **State:** READY
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
- [ ] AC-1: a member whose highest role holds `manage_roles` but sits below Admin can't gain Admin through any route (403 or 404).
- [ ] AC-2: they can't remove Admin from someone at or above them.
- [ ] AC-3: the owner can still give and take Admin through the roles route.
- [ ] AC-4: the web suites pass unchanged (nothing in the app used the route).

## Expected Areas of Change
`server/routes/spaces.js`, maybe `server/db/index.js` (`setMemberRole` stays for the transfer flow and tests), the tests that used the PATCH (`grep -rn "members/.*PATCH\|'PATCH', .*members" server/tests`), and a new regression test in `server/tests/roles-api.test.js`.

## Not in scope
Any other change to the roles model.
