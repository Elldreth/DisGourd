# P14-03 — "Email this invite"

- **Unit Type:** Implementation (child of P14-00)
- **Phase:** 14
- **State:** REVIEW (AC-4 is the owner's live check)
- **Starting baseline:** main after #237
- **Effort:** S
- **Depends on:** P14-01, P12-01
- **Requirement Source:** P14-00 owner decision 6 ("send it to them via email or copy/paste a link").

## Scope
- **`POST /spaces/:name/invites/:code/email { to }`:**
  - **Who:** anyone who may create invites there, and whose invite it is (or a server manager).
  - **Email must be on;** otherwise 409.
  - **Limits:** 10 an hour per sender (on top of the mailer's per-recipient and daily limits). An address the mailer refuses gets a plain message.
- **Template `serverInvite`:**
  - **Subject:** "<inviter> invited you to <server> on <site>".
  - **Body:** one paragraph and a **"Join <server>"** button to `PUBLIC_URL/invite/<code>`, plus "This invite expires on <date>" or "doesn't expire". Mentioning that a new person can create an account follows the same policy as the preview.
  - **No message text from the sender** in this version: it would make the server a way to send arbitrary text to any address.
- **Invite dialog:** below the link, **"Email this invite"**, an address box and Send. "Sent to f…@gmail.com" on success. Hidden when email is off.

## As built
- **`POST /spaces/:name/invites/:code/email { to }`** (in `routes/spaces.js`):
  - **Who:** you need the server's `invite` action, and you must have made the invite or be a server manager (owner or `edit_server`). Otherwise 403.
  - **The invite:** it must belong to this server (else 404) and still work (expired or used up gives 410, "Make a new one").
  - **Email** must be set up (else 409), and the address must look valid (else 400).
  - **Limits:** 10 an hour per sender, on top of the mailer's daily and per-recipient limits (each 429 with a plain message).
  - **The answer:** 202 `{ sent: true, to }`.
- **Template `serverInvite`:**
  - **Subject:** "<inviter> invited you to <server> on <site>".
  - **Body:** a heading, then one paragraph that follows `inviteCanCreateAccount` ("…If you don't have an account yet, the link lets you create one…" or "Sign in with your account, and the link adds you to …"), then the expiry ("expires on <date>", UTC, or "doesn't expire").
  - **The button:** "Join <server>" → `PUBLIC_URL/invite/<code>`.
  - **No sender text.** Everything is escaped.
- **`InviteDialog.jsx`:** "Email this invite", an address box with Send, shown only when `/auth-info` says `email: true`. Answers "Sent to …" or the server's message. New `api.emailInvite(space, code, to)`.

## Acceptance criteria
- [x] AC-1: the email has the right subject, button link and expiry line; values are escaped.
- [x] AC-2: only someone allowed (the invite's creator or a server manager) can send it; others get 403.
- [x] AC-3: the per-sender limit and the mailer's limits hold. Email off → 409, and the button is hidden.
- [ ] AC-4: live: an invite emailed from the owner's server arrives in an inbox, and its button opens the landing page (P14-02).

## Expected Areas of Change
`server/routes/spaces.js` (or `routes/invites.js`), `server/mail/templates.js`, `web/src/components/InviteDialog.jsx`, `api.js`; tests.

## Evidence (2026-10-21)
| Criterion | Evidence |
|---|---|
| AC-1 | `invite-email.test.js`: the subject "owner invited you to Den on DisGourd"; the text has `Join Den: https://chat.example.com/invite/<code>`, "This invite expires on <Month d, yyyy>." and the new-account line (the site admin's invite); the HTML link matches. A never-expiring invite from a member: "This invite doesn't expire." and the sign-in line. The template escapes `&`, `"`, `<b>` and the link's `&` |
| AC-2 | Someone else's invite → 403; the server's owner can email a member's invite → 202; another server's invite → 404 |
| AC-3 | Used up → 410; a bad address → 400; email off → 409 "This server can't send email right now" (and `/auth-info` `email: false`); with limits on, the 11th in an hour → 429. `inviteLanding.test.jsx`: Send → "Sent to friend@example.org." with the trimmed address; the limit message shows; the box is hidden while email is off; every control is named |
| Suites | Server 653 (2 Linux-only skipped), web 878; `vite build` clean |
| Sandbox | A throwaway copy of the sandbox DB on :3015, with a test-only transport printing each email. As sandy: Smoke Test's server menu → Invite → the dialog showed `5DBCH-3ZRRQ`, "New people can create an account with this link." and **Email this invite**. An address, then Send → "Sent to newfriend@example.org.". The log had the email: "sandy invited you to Smoke Test on DisGourd", the new-account paragraph, "This invite expires on October 28, 2026.", and "Join Smoke Test: http://localhost:3015/invite/5DBCH-3ZRRQ". The temporary entry and DB were removed |
| AC-4 | Open: on the live server, email an invite from Den of Thieves to an inbox, then open its button → the landing page (P14-02) |
