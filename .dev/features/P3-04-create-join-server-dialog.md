# P3-04 — Create/Join server as a tabbed modal (replace the 56px inline input)

- **Unit Type:** Implementation (slice 1; icon and templates are P3-06)
- **Phase:** 3
- **State:** COMPLETE
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
- [x] Keyboard-only: open the dialog, switch tabs with arrows, submit with Enter, and Esc closes it.
- [x] A duplicate server name shows "A server with that name already exists" inline, and the dialog stays open.
- [x] Pasting a full invite link works; an invalid code shows the server's error inline.
- [x] On success, the dialog closes and the new server is selected.

## Expected Areas of Change
New `CreateServerDialog.jsx`, `ServerRail.jsx`, `App.jsx` (two functions, or `useSpaces.js` if P1-14 has landed).

## Working Set / Blast Radius
3–4 files.

## Evidence
Baseline: main at a8b7e94 (after P3-09). Branch `claude/p3-04-create-join-dialog`.

| Acceptance criterion | Evidence |
|---|---|
| Keyboard-only: open, arrows switch tabs, Enter submits, Esc closes | `CreateServerDialog.test.jsx` (tabs + arrow keys). Sandbox: focused "+", Enter opened "Add a server" with focus in the name field; Shift+Tab to the Create tab, ArrowRight selected Join; Tab into the field; Esc closed it and focus went back to "+". |
| Duplicate name shows inline, dialog stays open | Test "a server error shows in the dialog". Sandbox: "Tx Check" + Enter showed "A server with that name already exists" in the dialog, which stayed open. |
| Pasted invite link works; invalid code shows the server error inline | Tests for `extractInviteCode`, the preview, and the invalid code. Sandbox: `http://localhost:3005/invite/notreal` showed "This invite is invalid or has expired". A second user pasted `http://localhost:3005/invite/<code>`, saw "P304 Temp · 1 member", pressed Enter and joined. |
| Success closes the dialog and selects the server | Test "Enter submits … success closes". Sandbox: creating "P304 Temp" and joining it both closed the dialog with P304 Temp selected. The throwaway server was deleted afterwards. |

Web tests: 345 pass (8 new). Build clean.

### Notes
- `createSpace` and `joinServer` in `state/useSpaces.js` now throw instead of setting the page error, so the dialog shows the message. They have no other callers.
- The dialog lives in ServerRail (it owns which tab is open), so App.jsx did not need to change.
- The Join button reads "Open" when you're already a member of that server.
