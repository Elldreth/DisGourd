# P11-09 — Instance safety: suspend accounts; who can DM me

- **Unit Type:** Implementation (child of P11-00)
- **Phase:** 11
- **State:** PLANNED (after P11-03 and P11-07; all three touch `server/gateway/`)
- **Effort:** M
- **Depends on:** P11-03; owner decision 2 in P11-00 (the DM default)
- **Serialize with:** P11-03, P11-07
- **Requirement Source:** P11-00 findings M7 and M9.

## Problem
- A site admin can ban an account from each server, but can't stop it signing in, DMing anyone, uploading, or joining through invites.
- Anyone with an account can DM or friend-request anyone on the instance by username (`server/gateway/dm.js:109-123`, `server/routes/social.js:134-147`).

## Scope
- **Suspend (site admins):**
  - A migration adds `users.suspended_at` (and an optional `suspended_reason`).
  - `GET /admin/users?q=` lists matches (username, created, last seen, suspended), and `PUT /admin/users/:username { suspended, reason? }` suspends or lifts.
  - Suspending bumps `token_version`, deletes sessions and closes sockets (`endStaleSessions`). `/login` and `verifyToken` refuse a suspended account with "This account is suspended".
  - A site admin can't suspend themself or the last site admin. Each action is logged to the console (there's no instance-level log yet).
  - **App:** a "People" section in the site-admin settings: search, a Suspend/Unsuspend button with a confirm and an optional reason.
- **Who can DM me:**
  - A user setting `dm_policy`: `friends_and_servers` (default, per the owner's decision) or `everyone`.
  - A new pair conversation (first DM) and a group add are refused unless the policy allows it, with the same neutral wording as blocking ("You can't message this person").
  - Existing conversations keep working.
  - The setting goes on the Privacy & safety page.
- **Friend requests:** at most 20 per day per sender.

## Acceptance criteria
- [ ] AC-1: a suspended user's open sockets close with `signed_out`; their token → 401; login → 403 with the message.
- [ ] AC-2: lifting the suspension lets them sign in again.
- [ ] AC-3: with the default policy, a stranger (no shared server, not a friend) can't start a DM or add the person to a group; someone who shares a server can.
- [ ] AC-4: with `everyone`, the stranger can.
- [ ] AC-5: the 21st friend request in a day → 429.
- [ ] AC-6: the People section passes axe (no serious issues); both suites pass.

## Expected Areas of Change
`server/db/migrations.js`, `server/db/index.js`, `server/routes/admin.js`, `server/routes/auth.js`, `server/auth/tokens.js`, `server/gateway/dm.js`, `server/routes/social.js`, web (site-admin settings, `PrivacySection.jsx`, api.js), tests.

## Not in scope
Deleting accounts and their data (a separate packet if wanted). An instance-wide moderation log.
