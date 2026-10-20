# P7-01 — Setup wizard: the invite link first, with "Copy link"

- **Unit Type:** Implementation
- **Phase:** 7 (UX review follow-ups)
- **State:** REVIEW
- **Effort:** S
- **Depends on:** none
- **Serialize with:** none
- **Requirement Source:** `design/UX-REVIEW-2026-10.md` F3; recorded as a follow-up in `P4-00` ("Follow-ups recorded, not planned").

## Scope
In the setup wizard's last step ("You're all set", `FinishStep` in `web/src/components/SetupWizard.jsx`), when an invite was made:
- **First:** the invite link (`inviteLink(invite, address)`) in its own read-only field, with a primary "Copy link" button (it shows "Copied").
- **One line under it:** "Invites never expire; make more from the server menu." That's true: the setup invite is created with no expiry and no use limit (`db.createInvite(..., null, null)`).
- **Below that, as the secondary option:** the existing friendly message and "Copy message".
- When there is no invite, nothing changes.

## Acceptance criteria
- [x] AC-1: with an invite, the link field shows the full link and comes before the message. "Copy link" copies exactly the link and says "Copied".
- [x] AC-2: the "never expire" line is shown with the link. "Copy message" still copies the whole message.
- [x] AC-3: without an invite, the step looks as it does today.
- [x] AC-4: a web test in `SetupWizard.test.jsx` (or a new `WizardInvite.test.jsx`) covers AC-1 to AC-3. The suite stays green.
- [x] AC-5: a sandbox check on `app-fresh` (:3006, a fresh install every start), with a screenshot of the last step.

## Expected Areas of Change
`web/src/components/SetupWizard.jsx`, plus a test.

## Out of Scope
Invite expiry options and a list of invites.

## Starting Baseline
Revision: `ee16b7e` (main after #168; #169 was still open and touches nothing here).

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | Vitest `SetupWizard.test.jsx` + sandbox | The link field shows `<origin>/invite/<code>` above the message. "Copy link" writes exactly the link and turns to "Copied" (`design/p6-actions/shots/p7-01-copied.png`). |
| AC-2 | Verified | Vitest + sandbox | The never-expire line is shown. "Copy message" writes the whole message, and "Copy link" goes back to its label. |
| AC-3 | Verified | Vitest | With the invite failing, there's no link, message, note or Copy link; "Open DisGourd" is still there. |
| AC-4 | Verified | Vitest, Vite | Two new tests; the existing walkthrough updated for the new label. Web 94 files / 743 tests green. `vite build` clean. |
| AC-5 | Verified | Sandbox: a fresh install on :3008 (a temp DB, this branch's code; the shared :3006 untouched) | Made the admin, kept Invite code, created "Book Club". The last step at desktop (`p7-01-finish-desktop.jpg`) and at 375×812 (`p7-01-finish-phone.jpg`). No console errors. |
