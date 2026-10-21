# P14-00 — One invite link: sign up and join in one step

- **Unit Type:** Container (children P14-01 … P14-03)
- **Phase:** 14
- **State:** PLANNED
- **Effort:** M–L in total
- **Depends on:** P12-02 (confirmed email, "Require a confirmed email"), P13-01 (easy-to-type codes)
- **Requirement Source:** the owner, 2026-10-21. "Currently getting people into the disgourd server is difficult. You have to give them a url, then find the invite code buried in settings, then when they are joined to the system you have to go into another place in server settings to get them a link for inviting them to your server. It's a mess." And: "I'd like to create an invite link from my 'Den of Thieves' disgourd server and send it to them via email or copy/paste a link that they can click on which takes them first to create their Disgourd account but automatically gives them access to the Disgourd server that the invite was made from … once they're in Disgourd they should see the server in their server list and they would have already been added." The owner also wants it set up correctly for larger communities, and wants accounts verified by email.

## How it works today
- **The site** (the whole DisGourd install; site admins): the registration mode is `open`, `code` or `closed`, kept in `site_settings`. `REGISTRATION_MODE` in the environment only seeds it the first time. Sign-up codes are made in Site admin › General (`reg_codes`).
- **Servers** (any user can create one; their owners and admins): server invites from each server's invite dialog (`invites`; `POST /spaces/:name/invites` checks the server's "invite" permission). An invite link `/invite/<code>` survives the sign-in screen, then the Join dialog opens filled in. But `GET /invites/:code` needs sign-in, and in `code` mode a new person also needs a separate sign-up code.
- **Server invite codes** are `base64url` (mixed case, lookalikes), with the same phone-typing trouble P13-01 fixed for sign-up codes.

## Owner decisions (2026-10-21)
1. **One link.** A server invite link is also how a new person creates an account. Signed out, it opens "You're invited to <server> by <name>" with a sign-up form and no code field.
2. **Land in the server.** Creating the account joins the server at once (counting one use of the invite), and the server is in their list. With "Require a confirmed email" on, the confirm step comes first, and the server is already there when they're through. People who already have an account just join.
3. **Registration modes** become **Open** (anyone), **Invite only** (an invite link or a sign-up code; replaces "Code required") and **Closed** (nobody). Closed gets a switch, **"Invite links still let people sign up"**.
4. **"Who can bring in new people with their invites"**, a site setting: **Site admins only**, **Server owners and admins**, or **Anyone who can invite** (whoever the server's roles allow to create invites).
   - The owner's own setup: Anyone who can invite, plus "Require a confirmed email".
   - The default for a new install: Site admins only, the cautious choice for an instance whose owner hasn't chosen.
5. **Server invite codes** use the P13-01 style (`K7MPQ-X3HRT`): matching ignores case, spaces and dashes, and old codes keep working.
6. **"Email this invite"** in the invite dialog, now that the server can send mail.

## Shape
| Unit | What | Effort | Depends on |
|---|---|---|---|
| P14-01 | Server: invite-based sign-up and auto-join, the modes and settings, a public invite preview, easy invite codes | M | P12-02 |
| P14-02 | App: the invite landing page with sign-up, landing in the server, Site admin › General's new settings, clearer invite dialog | M | P14-01 |
| P14-03 | Email this invite: a button in the invite dialog, a template, limits | S | P14-01, P12-01 |

The build order is P14-01 → P14-02 → P14-03. P14-03's server half could ride along with P14-01.

## Security (why this is safe)
- **An invite creates an account only if** the mode allows it **and** the invite's creator passes the "who can bring in new people" setting, checked at sign-up time, as the creator's role is *now*. An invite from someone later demoted, suspended or removed stops creating accounts.
- **Every existing limit still applies:**
  - an invite's expiry and use limit;
  - the sign-up rate limit (5 per 15 minutes per IP);
  - the account cap (`MAX_ACCOUNTS`);
  - bans from that server;
  - P11-08's password rules;
  - "Require a confirmed email" (P12-02);
  - suspending accounts (P11-09).
- **The public preview shows only** the server's name, its icon, the inviter's username and a member count. It shows it only for a valid, unexpired invite, and it's rate-limited per IP (codes have about 8×10¹⁴ possibilities). An invalid code says "This invite is invalid or has expired", whatever the reason.
- **The registration code itself** isn't needed in the link, so it doesn't spread with it.
- **The remaining risk** is a link forwarded beyond the intended person; expiry, use limits and email confirmation cover it. The README says so in plain words, with the settings for a tight or an open community.

## Not in scope
Invites to the site without a server (sign-up codes stay for that). Invite tracking ("who joined with my link"). Vanity invite links. Approving each sign-up by hand.
