# P14-01 — Server: sign up with an invite, auto-join, modes and settings, easy codes

- **Unit Type:** Implementation (child of P14-00)
- **Phase:** 14
- **State:** REVIEW
- **Starting baseline:** main after #235
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

## As built
- **`server/auth/invitePolicy.js`:**
  - `inviteCanCreateAccount(invite)`: a usable invite (not expired or used up), **and** a mode that allows invites (open or invite, or closed with `closed_allows_invites`), **and** a creator who qualifies now.
  - **A creator qualifies** if they exist, aren't suspended and aren't a bot, plus:
    - `site_admins`: `site_admin` is set;
    - `server_admins`: they own the server, or hold `edit_server` through `resolveAccess`;
    - `inviters`: they hold the `invite` action.
  - Also exports `whoCanBringIn` (default `site_admins`), `closedAllowsInvites` and `modeAllowsInvites`.
- **`config.js`:** `code` reads as `invite`, from the environment and from the stored setting. `REGISTRATION_CODE` alone implies `invite`.
- **`POST /register`:**
  - **An optional `invite`:**
    - **Unknown** → 404; **expired** → 410; **used up** → 410. All checked before anything else, and never for the first account.
    - **When `inviteCanCreateAccount`,** the mode and code checks are skipped.
    - **Otherwise** the usual mode rules apply. In Open mode the invite only joins. In Invite only or Closed, a non-qualifying invite gets 403: "This invite can't be used to create an account here. Ask the server's admins, or sign in if you already have an account."
  - **Joining happens in the account-creation transaction:** `insertUserTx` calls `redeemInvite(invite.code, newUserId)`. Anything but `joined` throws `invite-<reason>`, so no account is created (410/403/404 after that).
  - **The answer** adds `joined: <server>`. The server's members get `members_changed`.
- **`GET /invites/:code/preview`** (public, 30 per 15 minutes per address): `{ space, icon, inviter, members, signUp }` for a usable invite, otherwise the same 404 "This invite is invalid or has expired". Uses a new `db.getSpaceCard`.
- **Easy codes:**
  - `POST /spaces/:name/invites` uses `newRegCode()` (`XXXXX-XXXXX`); `crypto` is gone from `routes/spaces.js`.
  - `db.getInvite` matches `replace(upper(code), '-', '')` against the normalized input, an exact match first (then `rowid` DESC). `redeemInvite` updates by the stored code.
  - Old mixed-case codes still work, however they're typed.
- **`/admin/registration`:**
  - `GET` adds `closedAllowsInvites` and `invitesCreateAccounts`.
  - `PUT` takes any of `mode` (open, invite, closed, or `code` as an alias), `closedAllowsInvites` (a boolean) and `invitesCreateAccounts` (one of `WHO`). It validates each and returns all three.
- **`/auth-info`** adds `closedAllowsInvites`.
- **App compatibility until P14-02:** the General page's option is `invite` ("Invite only — with an invite link or a sign-up code"), and Login shows the code field for `invite` (or `code`). The setup wizard still sends `code`, which the server maps.

## Acceptance criteria
- [x] AC-1: in `invite` mode, a signed-out person registers with a valid invite from a qualifying creator, gets a token, is a member of that server (the invite's uses +1), and no sign-up code is involved.
- [x] AC-2: each `invites_create_accounts` value admits and refuses as specified, judged on the creator's role *now* (demote the creator → the same invite stops creating accounts but still lets existing users join).
- [x] AC-3: `closed` refuses all sign-ups unless `closed_allows_invites` is on; then only qualifying invites work. `open` always works, and with an invite it auto-joins.
- [x] AC-4: an expired, used-up or banned invite fails at sign-up, leaving no account behind (the transaction rolls back).
- [x] AC-5: the preview is public, shows only the listed fields for a valid invite, the same 404 otherwise, and is rate-limited.
- [x] AC-6: new invite codes are `XXXXX-XXXXX` (the easy alphabet); old codes and differently typed new codes both work.
- [x] AC-7: a stored `code` mode reads as `invite`; both suites pass. Existing invite, registration and setup-code tests are updated, not weakened.

## Expected Areas of Change
`server/config.js` (`registrationMode`), `server/routes/auth.js` (register), `server/routes/invites.js` (preview), `server/routes/spaces.js` (codes), `server/routes/admin.js` (registration settings), `server/db/index.js` (invite lookup/redeem normalization, an atomic create-and-join), `server/auth/regCodes.js`, a new `server/auth/invitePolicy.js`; tests (`invite-signup.test.js` new; `api.test.js`, `invites` and `regcodes` tests updated).

## Evidence (2026-10-21)
| Criterion | Evidence |
|---|---|
| AC-1 | `invite-signup.test.js`: in Invite only mode (default policy), the site admin's invite: register with `invite` and no code → 201 `{ token, joined: 'Den' }`, a member of Den, uses 1 |
| AC-2 | `site_admins`: a regular server owner's invite → 403 with the message, uses 0, but an existing user can still join with it. `server_admins`: the owner's invite → 201; a member's → 403. `inviters`: the member's → 201. A site admin's invite → `signUp: true`; after `setSiteAdmin(false)` → `signUp: false`, and register → 403. A suspended creator → 403 |
| AC-3 | Closed: no invite → "Registration is closed on this server."; with an invite → 403. With `closedAllowsInvites` → the invite gives 201, still 403 without one, and `/auth-info` says so. Open: a non-qualifying invite still joins (`joined: 'Sams Place'`), and no invite → 201 |
| AC-4 | Used up → 410 "This invite has been fully used"; expired → 410; unknown → 404. The user count changed by exactly the one success. A race (used up before the insert): `createUserRedeemingCode({ inviteCode })` → `{ error: 'invite-exhausted' }`, and user `racer` doesn't exist |
| AC-5 | The preview's keys are exactly `icon, inviter, members, signUp, space`. An unknown or used-up invite gets the same 404. With limits on, the 31st request in 15 minutes → 429 |
| AC-6 | A new code matches `^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$`. Lowercase, a space instead of the dash, and no dash all work, for the preview and for sign-up. An old-style `aB3x-Q9_kZ1m` works exactly and as `AB3XQ9_KZ1M`, and signs up |
| AC-7 | A stored `code` reads as `invite` in `/auth-info`. `PUT { mode: 'code' }` stores `invite`. Bad values → 400; a non-admin → 403. Updated, not weakened: `api.test.js` (the mode is now `invite`) and `setup-code.test.js` (`closedAllowsInvites` in `/auth-info`). Suites: server 649 (2 Linux-only skipped), web 873; `vite build` clean |
| Sandbox | A throwaway copy of the sandbox DB on :3013 (mode was `open`). As sandy: PUT mode `invite` and `site_admins` → an invite for "Smoke Test" (`FU9VW-68MYQ`). Signed out: the preview by the **lowercase** code → `{ space: 'Smoke Test', inviter: 'sandy', members: 1, signUp: true }`. Register `linkfriend` with the invite → 201 `joined: 'Smoke Test'`, and its `/spaces` list is `['Smoke Test']`. Register without an invite → 403. The temporary entry and DB were removed |
