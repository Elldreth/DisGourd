# P14-02 — App: the invite landing page, landing in the server, the new settings

- **Unit Type:** Implementation (child of P14-00)
- **Phase:** 14
- **State:** PLANNED
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

## Acceptance criteria
- [ ] AC-1: signed out, an invite link shows the server, the inviter and the sign-up form; signing up lands in that server, with no Join dialog.
- [ ] AC-2: a link whose invite can't create accounts offers sign-in only and says why; signing in then joins and opens the server.
- [ ] AC-3: signed in, the link joins and opens the server (or opens it if already a member). Banned and invalid say so.
- [ ] AC-4: with "Require a confirmed email" on: sign up → the confirm step → confirm → the server is open.
- [ ] AC-5: the General page's modes, the Closed switch and "Who can bring in new people" save and reload. The invite dialog's line matches the policy.
- [ ] AC-6: Vitest covers each screen and state; every control is named in words; both suites pass; the sandbox walk covers AC-1–4 with two browsers.

## Expected Areas of Change
`web/src/App.jsx`, `web/src/inviteLink.js`, a new `web/src/components/InviteLanding.jsx`, `Login.jsx`, `ServerRail.jsx` (the Join prefill path), `RegistrationAdmin.jsx`, `InviteDialog.jsx`, `api.js`; tests.
