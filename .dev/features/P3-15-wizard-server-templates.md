# P3-15 — Server templates in the setup wizard

- **Unit Type:** Implementation
- **Phase:** 3 (follow-up found in P3-06)
- **State:** COMPLETE
- **Effort:** S
- **Depends on:** P3-06 (templates on the server and in the Add-a-server dialog), P3-07 (wizard)
- **Serialize with:** CreateServerDialog.jsx, SetupWizard.jsx units
- **Requirement Source:** Discovered Work in P3-06 (`P3-06-server-icon-templates.md`); user request 2026-10-17
- **Starting baseline:** `main` at 2a81456 (after #88)

## Scope
- Move the template list and its picker out of `CreateServerDialog.jsx` into one shared place (`serverTemplates.js` + `TemplatePicker.jsx`), so both screens show the same cards.
- Setup wizard, step 3 ("Create your first server"): show the picker under the name (Blank preselected) and send the choice with `api.createSpace(name, template)`.
- No server change: `POST /spaces` already takes `template` (P3-06).

## Acceptance criteria
- [x] The wizard's server step shows the same four template cards as the Add-a-server dialog, with Blank selected.
- [x] Choosing a template creates the first server with that template's channels (fresh install).
- [x] The Add-a-server dialog behaves as before (its tests still pass).

## Expected Areas of Change
New `web/src/serverTemplates.js`, new `web/src/components/TemplatePicker.jsx`, `CreateServerDialog.jsx`, `SetupWizard.jsx`, and their tests.

## Working Set / Blast Radius
~6 small files, client only.

## Evidence
| Acceptance criterion | Evidence |
|---|---|
| The wizard's server step shows the same four cards, Blank selected | `SetupWizard.test.jsx` (new test: values blank/friends/gaming/study, Blank checked, channel previews shown). Both screens render the one shared `TemplatePicker`. Fresh install (:3006): step 3 showed the four cards with Blank selected (screenshot). |
| Choosing a template creates the first server with its channels | Unit: `createSpace('Raid Night', 'gaming')`; the existing flow now sends `'blank'`. Fresh install: picked **Study** → "My Community" was created with general / resources / questions + 🔊 study-room, and the wizard moved on to step 4. |
| Add a server unchanged | All CreateServerDialog tests pass unchanged. |

Web 402 pass (1 new, 1 updated). Build clean. The throwaway :3006 server was stopped (its temp DB is recreated on each start).
