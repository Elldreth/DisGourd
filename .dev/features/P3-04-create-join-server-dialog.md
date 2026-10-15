# P3-04 — Create/Join server as a tabbed modal (replace the 56px inline input)

- **Unit Type:** Implementation (slice 1; icon and templates are P3-06)
- **Phase:** 3
- **State:** PLANNED (READY after P3-01)
- **Effort:** S
- **Depends on:** P3-01
- **Serialize with:** App.jsx units (small edit: `createSpace`/`joinServer` must rethrow so the dialog can show errors inline)
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 3 (`ServerRail.jsx:145`). Revalidated: the inline create form is at `ServerRail.jsx:114`, and the join form at `:148`.

## Scope
- New `web/src/components/CreateServerDialog.jsx`, built on Modal with tabs **Create** | **Join** (a proper `role="tablist"` with arrow keys):
  - **Create:** a name field (≤ 60 characters, with a live counter) and a primary button.
  - **Join:** accepts a raw code *or* a pasted invite URL. Extract the code from `/invite/<code>` or `?invite=` (check how InviteDialog formats links). It shows the invite preview (`api.previewInvite`: server name, member count, already-a-member) before the Join button.
  - Errors show inline in the dialog.
- ServerRail: the "+" and "Join" rail buttons open the dialog on the matching tab. Remove the inline forms.
- App.jsx: `createSpace` and `joinServer` return or rethrow errors instead of only setting the `loadError` toast.

## Acceptance criteria
- [ ] Keyboard-only: open the dialog, switch tabs with arrows, submit with Enter, and Esc closes it.
- [ ] A duplicate server name shows "A server with that name already exists" inline, and the dialog stays open.
- [ ] Pasting a full invite link works; an invalid code shows the server's error inline.
- [ ] On success, the dialog closes and the new server is selected.

## Expected Areas of Change
New `CreateServerDialog.jsx`, `ServerRail.jsx`, `App.jsx` (two functions, or `useSpaces.js` if P1-14 has landed).

## Working Set / Blast Radius
3–4 files.
