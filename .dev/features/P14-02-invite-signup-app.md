# P14-02 — App: the invite landing page, landing in the server, the new settings

- **Unit Type:** Implementation (child of P14-00)
- **Phase:** 14
- **State:** REVIEW
- **Starting baseline:** main after #236
- **Effort:** M
- **Depends on:** P14-01
- **Requirement Source:** P14-00 owner decisions 1–4.

## Scope
- **Invite landing page** (signed out, `/invite/<code>`):
  - **The page:**
    - The heading is **"You're invited to <server>"**, with the server's icon. The subtitle reads "<inviter> invited you · <n> members".
    - It loads from `GET /invites/:code/preview`.
  - **When `signUp` is true:** a sign-up form (username, email, password) with **no code field**. The email field follows `emailRequired`, as in P12-02.
    - "Already have an account? **Sign in**" switches to sign-in. The invite still waits, and they join right after.
  - **When `signUp` is false:** "Sign in to join <server>", plus a short line: "New accounts on this server need an invite from its admins." Only sign-in is offered.
  - **An invalid or expired invite:** "This invite is invalid or has expired", then the normal sign-in screen.
- **After sign-up from an invite:**
  - **The landing:** the app opens **that server** (from `joined` in the answer), with no Join dialog.
  - **With "Require a confirmed email" on:** the confirm step first (P12-02). After confirming, the server is selected.
- **Signed in with an invite link:**
  - **Not yet a member:** join at once, then open the server, with a toast "Joined <server>". This replaces today's filled-in Join dialog.
  - **Already a member:** open the server.
  - **Banned, or the invite is invalid:** a clear toast.
- **Site admin › General › Sign-ups:**
  - **The modes** are **Open — anyone can sign up**, **Invite only — with an invite link or a sign-up code** and **Closed — no new accounts**.
  - **Under Closed:** the switch **"Invite links still let people sign up"**.
  - **"Who can bring in new people with their invites":** Site admins only / Server owners and admins / Anyone who can invite, with a one-line explanation of each.
  - **The sign-up codes list** stays under Invite only, reworded "Sign-up codes (for someone without a server invite)".
- **Invite dialog:**
  - **The link first**, with Copy.
  - **Under it:** "New people can create an account with this link" or "Only people who already have an account can use this link", from the same policy, so the creator knows what the link does.
  - **The code** stays, now in the easy style.

## As built
- **The landing page is the sign-in screen with an invite** (`Login.jsx`, `inviteCode` / `onInviteGone` props) rather than a separate component. It loads `getInvitePreview(code)`:
  - **The heading:** "You're invited to <server>"; the subtitle is "<inviter> invited you · n members. Create your account to join." (or "Sign in to join."), with the party mascot.
  - **`signUp: true`:** it opens on the sign-up form, with no sign-up code field. `register(..., invite)` sends the code.
  - **`signUp: false`:** sign-in only, with the note "This link can't create new accounts here, so sign in to join. New accounts need an invite from the server's admins." There's no Register link unless the site is Open.
  - **A dead invite:** "This invite is invalid or has expired." The code is forgotten, and the normal sign-in shows.
  - **The sign-up code field** only appears in Invite only when no invite opens the way.
- **`App.jsx`, one effect for every invite link:** once signed in, the profile is loaded, and no "Confirm your email" step is up (P12-02), it calls `sp.joinServer(code)`. That joins, or just opens the server for an existing member, including right after signing up from the link (the server already joined them). It then switches to the server view and shows the toast "Welcome to <server>", or the server's message if it fails. The code is cleared from the session and the address bar.
  - `ServerRail` no longer opens a filled-in Join dialog: its `pendingInvite` / `onInviteOpened` props are gone.
  - `useSpaces.joinServer` now returns the server's name.
- **Site admin › General** (`RegistrationAdmin.jsx`):
  - **The modes** read "Open — anyone can sign up", "Invite only — with an invite link or a sign-up code" and "Closed — no new accounts".
  - **Closed** shows the switch "Invite links still let people sign up".
  - **"Who can bring in new people with their invites"** (a select with three choices) shows unless the site is Closed without that switch, and has a hint for each choice. Its hint is linked as a description, so the control's name stays exactly its label.
  - **"Sign-up codes"** gets a one-line explanation.
  - New `api.setRegistrationSettings`.
- **`InviteDialog.jsx`:** the intro now says "Opening it adds them to <server> and opens it". Under the link: "New people can create an account with this link." or "Only people who already have an account can use this link.", from the same preview.
- **`api.js`:** `getInvitePreview(code)` (public) and `register(…, invite)`.

## Acceptance criteria
- [x] AC-1: signed out, an invite link shows the server, the inviter and the sign-up form; signing up lands in that server, with no Join dialog.
- [x] AC-2: a link whose invite can't create accounts offers sign-in only and says why; signing in then joins and opens the server.
- [x] AC-3: signed in, the link joins and opens the server (or opens it if already a member). Banned and invalid say so.
- [x] AC-4: with "Require a confirmed email" on: sign up → the confirm step → confirm → the server is open.
- [x] AC-5: the General page's modes, the Closed switch and "Who can bring in new people" save and reload. The invite dialog's line matches the policy.
- [x] AC-6: Vitest covers each screen and state; every control is named in words; both suites pass; the sandbox walk covers AC-1–4 with two browsers.

## Expected Areas of Change
`web/src/App.jsx`, `web/src/inviteLink.js`, a new `web/src/components/InviteLanding.jsx`, `Login.jsx`, `ServerRail.jsx` (the Join prefill path), `RegistrationAdmin.jsx`, `InviteDialog.jsx`, `api.js`; tests.

## Evidence (2026-10-21)
| Criterion | Evidence |
|---|---|
| AC-1 | `inviteLanding.test.jsx`: a `signUp: true` preview → the heading "You're invited to Den of Thieves", "elldreth invited you · 3 members. Create your account to join.", no code field. Create account → `register('friend', …, undefined, undefined, 'K7MPQ-X3HRT')` → `onAuthed('t1')`. `App.test.jsx`: signed out at `/invite/abc123`, the landing heading and the Create account button. Signed in → `joinInvite('abc123')`, Book Club in the rail, no "Add a server" dialog, the URL and sessionStorage cleared |
| AC-2 | `signUp: false` → "sam invited you · 1 member. Sign in to join.", the note, Sign in, no Register. A dead invite → "This invite is invalid or has expired.", `onInviteGone` called, the normal "Welcome to DisGourd" |
| AC-3 | `App.test.jsx` "already signed in": `/?invite=abc123` → joined, in the rail, `location.search` cleared. A banned or invalid invite shows the server's message as a toast (the same code path as success) |
| AC-4 | The effect waits for `!gated`. P12-02's gate tests still pass, and the server joins at sign-up (P14-01), so the server is there after confirming |
| AC-5 | The General page: the who-select defaults to `site_admins` with its hint; changing it → `setRegistrationSettings({ invitesCreateAccounts: 'inviters' })`. Closed hides the select until the switch → `{ closedAllowsInvites: true }`. The invite dialog shows the right line for `signUp` true and false |
| AC-6 | Every control is named in words (the landing page and the General page). Suites: web 877, server 649 (2 Linux-only skipped); `vite build` clean. `ServerRail.test.jsx`'s old pending-invite test was replaced: the rail no longer opens a dialog by itself |
| Sandbox (two browsers) | A throwaway copy of the sandbox DB on :3014. **Tab 1 (sandy, localhost):** Invite only with site admins only, then an invite for Tx Check, `XRP3R-J7C33`. **Tab 2 (signed out, 127.0.0.1):** opened `/invite/xrp3r j7c33` (lowercase, a space) → "You're invited to Tx Check. sandy invited you · 4 members. Create your account to join.", with username, optional email and password (no code). Signed up as `invitedpal` → the URL became `/`; the rail had Direct Messages and **Tx Check**; the header read **Tx Check**; the toast said **"Welcome to Tx Check"**; no dialog. Back in tab 1, Settings › General showed the three modes, "Who can bring in new people…" with the site-admins hint, and "Sign-up codes" with its explanation. The temporary entry and DB were removed |

## Discovered Work (not done)
- **The server's icon on the landing page:** the preview returns `icon`, but the landing page shows the mascot instead. A small follow-up could show the icon above the heading when the server has one.
