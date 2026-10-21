# P11-09 — Instance safety: suspend accounts; who can DM me

- **Unit Type:** Implementation (child of P11-00)
- **Phase:** 11
- **State:** REVIEW (build order 11)
- **Starting baseline:** main at 1615bc5 (#225 merged)
- **Effort:** M
- **Depends on:** P11-03; owner decision 2 in P11-00 (the DM default): **decided 2026-10-21, "Friends + shared servers"**
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
- [x] AC-1: a suspended user's open sockets close with `signed_out`; their token → 401; login → 403 with the message.
- [x] AC-2: lifting the suspension lets them sign in again.
- [x] AC-3: with the default policy, a stranger (no shared server, not a friend) can't start a DM or add the person to a group; someone who shares a server can.
- [x] AC-4: with `everyone`, the stranger can.
- [x] AC-5: the 21st friend request in a day → 429.
- [x] AC-6: the People section passes axe (no serious issues); both suites pass.

## As built
- **Migration v33:** `users.suspended_at`, `users.suspended_reason`, and `users.dm_policy` (default `'friends_and_servers'`, so every existing account gets the owner's default).
- **Suspending (`server/db/index.js`, `server/routes/admin.js`):**
  - `setSuspended` sets or clears the flag. Suspending also deletes the account's sessions and bumps `token_version`.
  - `getTokenVersion` returns null for a suspended account. So `verifyToken` refuses its tokens everywhere (HTTP, the socket's auth frame, the old `?token=`) and `createToken` can't help it.
  - `/login` answers 403 "This account is suspended", but only after the right password; a wrong one is still "Invalid credentials".
  - `GET /admin/users?q=` (site admins) finds accounts by name, any case, bots left out, 25 at most. Each comes with `siteAdmin`, `suspended`, `suspendedAt`, `suspendedReason` and `lastSeenAt` (the latest session). Accounts have no created date, so it isn't shown.
  - `PUT /admin/users/:username { suspended, reason? }` refuses yourself, and the last site admin who can still sign in. The reason is at most 200 characters.
  - On suspend, every open socket gets `signed_out` with reason `suspended` and closes (4001). The sign-in page then says "This account has been suspended by a site admin."
  - Each change is logged to the console: `[admin] sandy suspended cara (reason: …)`.
- **Who can DM me (`server/gateway/dm.js`, `/me`):**
  - `db.canStartDm(from, to)`: friends or a shared server (the old `canAddToGroup`), or `to` allows `everyone`.
  - A first DM to someone is refused with the blocking wording, "You can't message this person" (code `NOT_ALLOWED`), and no empty conversation is left behind. An existing pair keeps working whatever either person's setting.
  - Group create and add use the same check. The refusal is now "You can't add <name>", the same words as blocking; it was "You can only add people you share a server with or are friends with (not <name>)".
  - `GET /me` returns `dmPolicy`, and `PATCH /me { dmPolicy }` accepts `friends_and_servers` or `everyone`.
- **Friend requests (`server/routes/social.js`):** 20 a day per sender (`rateLimitOk`, so on in production and off in tests unless switched on). The 21st gets 429 "You’ve sent a lot of friend requests today. Try again tomorrow."
- **Web:**
  - Settings › Site admin › **People** (`PeopleAdmin.jsx`): search; each row shows the name, a "Site admin" chip, a "Suspended · <reason>" chip and when they were last seen. The button is Suspend (a confirm with an optional reason) or Lift suspension (a confirm). Your own row says "You" and has no button.
  - Privacy & safety › **Who can message you** (`settings/DmPolicySection.jsx`): two radio choices, saved at once, put back if the save fails.
  - `ConfirmDialog` takes `children` (for the reason box).
- **README:** two lines in Security notes.
- **Older tests:** four suites had two strangers start a DM. dm-conversations, dm-unread and dm-groups now give the pair a shared server. In api.test.js the recipient allows everyone (its search test needs pete outside oscar's server). The dm-groups refusal check uses the new wording.

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | Jest `instance-safety.test.js`; sandbox | Test: tess's open socket gets `{ type: 'signed_out', reason: 'suspended' }` and closes with 4001; her token → 401 on `/me`; login → 403 "This account is suspended"; a wrong password is still 401. Sandbox: suspending cara from People turned her "last seen" into "Not signed in lately" (sessions gone), and `/login` as cara → 403 with the message |
| AC-2 | Verified | Jest; sandbox | Lifting it: login → 200 and the new token works. Sandbox: Lift suspension, then cara's login → 200 |
| AC-3 | Verified | Jest | Default `friends_and_servers` on `/me`. Stranger sol → mia: refused with "You can't message this person", no pair created. admin (shares a server) → mia: delivered. Group create with mia and tess by sol: "You can't add mia" |
| AC-4 | Verified | Jest; sandbox | mia on `everyone`: sol's DM is delivered, and still works after mia switches back. With mia on `everyone`, sol's group still fails on tess ("You can't add tess"); with both on `everyone` it's created. Sandbox: switching the setting both ways saved (`/me` showed `everyone`, then `friends_and_servers`) |
| AC-5 | Verified | Jest | With rate limits on, 20 requests → 201 each; the 21st → 429 with the message |
| AC-6 | Verified | axe-core 4.10.2; Jest, Vitest | axe on the Settings dialog, no violations: People (search results, a suspended row, the Suspend dialog with its reason box) and Privacy & safety, in dark and light. axe was loaded from a copy in `web/dist` for the check (the CSP blocks a CDN), then removed. Server 67 suites / 580 tests; web 110 files / 855 tests; `vite build` clean |
| Permissions | Verified | Jest | A member gets 403 on both admin routes. Refused: yourself (400), unknown (404), a non-boolean (400). A second site admin could suspend the first while one active admin remained |

## Discovered Work (not done here)
- **An instance-wide moderation log:** suspensions only go to the console today.
- **Group DMs don't count as a connection:** two people in the same group, with no shared server and not friends, can't start a 1-to-1 under the default. That's as decided ("friends + shared servers"); revisit if people ask.
- **Account created date:** the users table has none, so People shows "last seen" instead. Adding it needs a migration and only helps new accounts.

## Expected Areas of Change
`server/db/migrations.js`, `server/db/index.js`, `server/routes/admin.js`, `server/routes/auth.js`, `server/auth/tokens.js`, `server/gateway/dm.js`, `server/routes/social.js`, web (site-admin settings, `PrivacySection.jsx`, api.js), tests.

## Not in scope
Deleting accounts and their data (a separate packet if wanted). An instance-wide moderation log.
