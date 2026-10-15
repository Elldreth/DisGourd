# P3-07 — Setup wizard: explain registration modes, end on the invite link, surface errors

- **Unit Type:** Implementation
- **Phase:** 3
- **State:** READY
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
- [ ] On a fresh install (empty DB), the wizard completes all steps, and the finish screen shows a working invite link: a second browser joins with it.
- [ ] Choosing "closed": `/auth-info` returns `registration: 'closed'`.
- [ ] If creating the server fails (simulated by a name over 60 characters, or the server stopped), the error shows inline and the user can retry or skip.

## Expected Areas of Change
`web/src/components/SetupWizard.jsx` only. It uses existing `api.js` functions.

## Working Set / Blast Radius
1 file, plus read-only use of `api.js` and `AuthShell.jsx`.
