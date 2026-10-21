# P14-03 — "Email this invite"

- **Unit Type:** Implementation (child of P14-00)
- **Phase:** 14
- **State:** PLANNED
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

## Acceptance criteria
- [ ] AC-1: the email has the right subject, button link and expiry line; values are escaped.
- [ ] AC-2: only someone allowed (the invite's creator or a server manager) can send it; others get 403.
- [ ] AC-3: the per-sender limit and the mailer's limits hold. Email off → 409, and the button is hidden.
- [ ] AC-4: live: an invite emailed from the owner's server arrives in an inbox, and its button opens the landing page (P14-02).

## Expected Areas of Change
`server/routes/spaces.js` (or `routes/invites.js`), `server/mail/templates.js`, `web/src/components/InviteDialog.jsx`, `api.js`; tests.
