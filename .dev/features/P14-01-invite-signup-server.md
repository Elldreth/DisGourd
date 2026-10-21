# P14-01 — Server: sign up with an invite, auto-join, modes and settings, easy codes

- **Unit Type:** Implementation (child of P14-00)
- **Phase:** 14
- **State:** PLANNED
- **Effort:** M
- **Depends on:** P12-02
- **Requirement Source:** P14-00 owner decisions 1–5.

## Scope
- **Registration mode values:** `open`, `invite` and `closed`.
  - **`code` becomes `invite`:** an existing `code` setting reads as `invite` (no migration needed: `registrationMode()` maps it), and `REGISTRATION_MODE=code` keeps working.
  - **New site settings:** `closed_allows_invites` (`0`/`1`, default `0`) and `invites_create_accounts` (`site_admins` (default), `server_admins` or `inviters`).
- **When an invite can create an account** (one function, `inviteCanCreateAccount(invite)`):
  - **The mode:** `open` → yes; `invite` → yes; `closed` → only with `closed_allows_invites`.
  - **And its creator still exists and isn't suspended, and:**
    - **`site_admins`:** the creator is a site admin;
    - **`server_admins`:** the creator is the server's owner or holds a role with server-management rights (the same test as `canManage` in `routes/spaces.js`);
    - **`inviters`:** the creator still has the server's "invite" action.
- **`POST /register { …, invite }`:**
  - **When it applies:** with no sign-up code and the mode not `open`, a valid invite that passes the check above stands in for the code.
  - **Inside the account-creation transaction:** the invite is redeemed, so the user is added to the server and `uses` goes up by one. Expiry, use limit and bans are re-checked there.
  - **If the invite can't be redeemed** (used up meanwhile), the whole sign-up fails, with "This invite has been fully used".
  - **The answer is** `{ token, joined: '<server name>' }`. The server's members get `members_changed`.
  - **In `open` mode,** an invite is optional: given and valid, it still auto-joins.
  - **With "Require a confirmed email" on,** the address is required as usual; the join happens at sign-up, and the gate holds the person until it's confirmed.
- **`GET /invites/:code/preview`** (public; no sign-in):
  - **For a valid invite:** `{ space, icon, inviter, members, signUp: <bool> }`. `signUp` says whether this invite can create an account now; `register` uses the same function.
  - **Otherwise** 404 "This invite is invalid or has expired".
  - **Rate limit:** 30 per 15 minutes per IP (the shared limiter). Add `/invites` to `devProxy.js` if it's missing (it's there).
- **`GET /auth-info`** adds `registration` (now `invite`), plus `closedAllowsInvites`, so the sign-in screen knows whether to offer sign-up at all.
- **Easy server invite codes:**
  - `POST /spaces/:name/invites` uses `newRegCode()` from `auth/regCodes.js` (it could be renamed `newCode`).
  - `getInvite` / `redeemInvite` match with the same normalization as P13-01 (ignoring case, spaces and dashes; an exact match wins).
  - `/invite/<code>` links keep working for old codes.
- **Admin:** `GET`/`PUT /admin/registration` take and return `mode` (`open|invite|closed`), `closedAllowsInvites` and `invitesCreateAccounts`.

## Acceptance criteria
- [ ] AC-1: in `invite` mode, a signed-out person registers with a valid invite from a qualifying creator, gets a token, is a member of that server (the invite's uses +1), and no sign-up code is involved.
- [ ] AC-2: each `invites_create_accounts` value admits and refuses as specified, judged on the creator's role *now* (demote the creator → the same invite stops creating accounts but still lets existing users join).
- [ ] AC-3: `closed` refuses all sign-ups unless `closed_allows_invites` is on; then only qualifying invites work. `open` always works, and with an invite it auto-joins.
- [ ] AC-4: an expired, used-up or banned invite fails at sign-up, leaving no account behind (the transaction rolls back).
- [ ] AC-5: the preview is public, shows only the listed fields for a valid invite, the same 404 otherwise, and is rate-limited.
- [ ] AC-6: new invite codes are `XXXXX-XXXXX` (the easy alphabet); old codes and differently typed new codes both work.
- [ ] AC-7: a stored `code` mode reads as `invite`; both suites pass. Existing invite, registration and setup-code tests are updated, not weakened.

## Expected Areas of Change
`server/config.js` (`registrationMode`), `server/routes/auth.js` (register), `server/routes/invites.js` (preview), `server/routes/spaces.js` (codes), `server/routes/admin.js` (registration settings), `server/db/index.js` (invite lookup/redeem normalization, an atomic create-and-join), `server/auth/regCodes.js`, a new `server/auth/invitePolicy.js`; tests (`invite-signup.test.js` new; `api.test.js`, `invites` and `regcodes` tests updated).
