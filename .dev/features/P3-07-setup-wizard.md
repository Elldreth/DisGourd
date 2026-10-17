# P3-07 — Setup wizard: explain registration modes, end on the invite link, surface errors

- **Unit Type:** Implementation
- **Phase:** 3
- **State:** REVIEW
- **Effort:** S
- **Depends on:** none
- **Serialize with:** none (SetupWizard.jsx is only used here)
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 3. Revalidated: `SetupWizard.jsx:26` has `await api.createSpace(name).catch(() => {})`, which swallows errors. Registration modes are only mentioned in a hint at `:99`.

## Scope
1. Account step: unchanged.
2. **"Who can join?"** step: three radio cards for open / invite code / closed. Each has a one-line explanation and a recommendation ("Closed + server invites" for friend groups). Save with `api.setRegistrationMode`. The first account is a site admin, so this is allowed. If the env pins the mode (`REGISTRATION_MODE`), say so: env seeds the DB on first run only, and the DB is authoritative afterwards.
3. First-server step (optional, as today), with errors shown inline instead of swallowed.
4. **Finish** step: if a server was created, mint an invite (`api.createInvite`) and show the link with a Copy button ("Send this to your friends"). If the mode is `code`, offer "Create a registration code" (`api.createRegCode`) and show it too. Then "Open DisGourd".

## Acceptance criteria
- [x] On a fresh install (empty DB), the wizard completes all steps, and the finish screen shows a working invite link: a second browser joins with it.
- [x] Choosing "closed": `/auth-info` returns `registration: 'closed'`.
- [x] If creating the server fails (simulated by a name over 60 characters, or the server stopped), the error shows inline and the user can retry or skip.

## Expected Areas of Change
`web/src/components/SetupWizard.jsx` only. It uses existing `api.js` functions.

## Working Set / Blast Radius
1 file, plus read-only use of `api.js` and `AuthShell.jsx`.

## Evidence
Baseline: main after P3-13 (#83). Branch `claude/p3-07-setup-wizard`.

Sandbox method: a new local launch config, "app-fresh" (:3006), starts the real server on its **own empty temp DB**, deleted at each start, so the shared sandbox DB was untouched. The wizard ran twice on fresh installs. A second browser is the 127.0.0.1:3006 origin (separate storage).

| Acceptance criterion | Evidence |
|---|---|
| Fresh install completes all steps; the finish screen shows a working invite, and a second browser joins with it | `SetupWizard.test.jsx` "the whole way". Sandbox run 2: account → **Invite code** → server "Book Club" → "Create a registration code". The finish screen's message had the address, a real registration code and a real invite code. The second browser registered with that code, opened Join a server, pasted the invite, saw the preview "Book Club · 1 member", pressed Enter, and landed in Book Club with both users in the member list. |
| Choosing "closed": `/auth-info` returns `registration: 'closed'` | Unit test (`setRegistrationMode('closed')`). Sandbox run 1: picked Closed → Continue → `GET /auth-info` = `{"registration":"closed","setup":false}`. |
| Server creation fails: error inline, retry or skip | Unit test (rejection, then retry succeeds). Sandbox run 1: a 61-character name showed the server's own "Server name must be 60 characters or fewer" inline, and the wizard stayed on step 3. "Skip for now" went on to step 4, and "Open DisGourd" opened the app. |

Web tests: 381 pass (7 new). Build clean.

### Corrections to the packet's assumptions
- **"Closed + server invites" is not a working recommendation here.** A server invite needs an existing account, and closed registration refuses every new account (`routes/auth.js`). So the wizard recommends **Invite code** for friend groups, and Closed says plainly that no one else can sign up. If closed is chosen with a server, the finish screen warns that only existing accounts can use the invite.
- **There is no invite *link* route in the app** (no `/invite/<code>` page). Rather than show a URL that looks like it auto-joins, the finish screen gives a copyable "Message for your friends": the address, step 1 (sign up, with the registration code when there is one) and step 2 (Join a server, paste the invite).

### Behaviour notes
- The account is signed in after step 1 (the token is stored), but the app only opens on "Open DisGourd". Reloading mid-wizard lands in the app; everything set so far is kept, and the rest is in Settings.
- Step 2 preselects the server's current mode. If it isn't the default 'open', or `REGISTRATION_CODE` is set, it explains that `REGISTRATION_MODE`/`REGISTRATION_CODE` only seeded the first run and that this choice wins. An unchanged choice isn't re-saved.
- The server name field shows a 0/60 counter but doesn't hard-limit, so the server's own message is what you see.

## Discovered Work (not done)
- **Invite deep link:** handle `?invite=<code>` (or `/invite/<code>`) on load. After sign-in, open the Add a server dialog on Join, prefilled. Then the wizard, InviteDialog and this message could share a real link.
