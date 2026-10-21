# P13-04 — An address nobody confirmed doesn't block the person it belongs to

- **Unit Type:** Implementation
- **Phase:** 13 (small fixes found on the live server)
- **State:** REVIEW
- **Effort:** S
- **Depends on:** P12-02
- **Starting baseline:** main after #238
- **Requirement Source:** the owner, 2026-10-21, testing P14 invites live. Signing up with their second Gmail address was refused ("That username or email can't be used"). A read-only query showed the phone test account `Test` held that address, **unconfirmed**. Their words: "Yes, fix it: at sign-up, an address another account never confirmed gives way to the new account."

## Problem
`POST /register` refused any address another account had (`getUserByEmail`), confirmed or not. Anyone could "squat" a friend's address by signing up with it first and never confirming it. P12-02 already lets an unconfirmed claim give way when someone *confirms* the address, but sign-up, and adding an address while email is off, didn't follow the same rule.

## As built
- **Sign-up only refuses a confirmed address** (`emailConfirmedElsewhere`), still with the one L6 message, "That username or email can't be used", so the form reveals nothing.
- **Inside the account-creation transaction,** `releaseUnconfirmedEmail(email)` takes the address off any account that never confirmed it, before the insert. It logs `[email] an unconfirmed address at …@<domain> was taken off user <id>`. If someone confirms the address between the check and the insert, the confirmed row isn't touched; the unique index then refuses the insert, which answers with the same 409.
- **`POST /me/email` while email is off** (no confirmation possible) follows the same rule: another account's unconfirmed claim gives way, instead of answering "can't be used".
- **Unchanged:**
  - a confirmed address is never taken;
  - with email on, changing an address still waits for the link (P12-02);
  - whoever confirms an address first owns it.

## Acceptance criteria
- [x] AC-1: sign-up with an address another account holds unconfirmed succeeds (in any case), and the other account's address is cleared.
- [x] AC-2: sign-up with an address another account has **confirmed** is refused with the same message as a taken username, and nothing changes.
- [x] AC-3: adding an address while email is off takes it from an account that never confirmed it.
- [x] AC-4: both suites pass. Tests that meant "a taken address" now confirm that address first (`low-severity-sweep`, `usernames-nocase`), rather than relying on the old any-claim rule.

## Evidence (2026-10-21)
| Criterion | Evidence |
|---|---|
| AC-1 | `email-addresses.test.js` "P13-04 … at sign-up": `squat` registers `owner2@example.com` unconfirmed; `realowner` registers `OWNER2@example.com` → 201, holding it; `squat`'s email is now null |
| AC-2 | Once `realowner`'s address is confirmed, `third` with `owner2@example.com` → 409 "That username or email can't be used"; `third` doesn't exist, and `realowner` keeps it |
| AC-3 | "P13-04 … email is off": `holder` registered `held@example.com` unconfirmed; `taker` adds it with their password → 200 `{ email: 'held@example.com', emailVerified: false }`; `holder`'s email is null |
| AC-4 | Server 655 (2 Linux-only skipped), web 878. The L6 and case-insensitivity tests now mark the address confirmed before checking the refusal |

## For the owner's live case
After deploying, the second Gmail address can sign up for a new account at once: the `Test` account loses it, because it was never confirmed. To keep it on `Test`, confirm it there first.
