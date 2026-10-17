# P3-06 — Server icon + starter templates at creation

- **Unit Type:** Implementation (slice 2 of the create-server dialog)
- **Phase:** 3 — "proper modal with tabs (name, icon, template)"
- **State:** COMPLETE
- **Effort:** S–M
- **Depends on:** P3-04, P1-06 (`createSpaceWithDefaults` creates the template channels atomically)
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 3

## Scope
- `POST /spaces { name, template }`. `template` comes from a server-side whitelist:
  - `blank`: #general
  - `friends`: #general, #memes, #media, 🔊 Lounge
  - `gaming`: #general, #lfg, #clips, 🔊 Squad 1, 🔊 Squad 2
  - `study`: #general, #resources, #questions, 🔊 Study room
  - An unknown template falls back to `blank`.
- Create tab: template cards, plus an optional icon picked via the existing ImageCropper. After creation, upload the icon and `PATCH` it (reuse `saveServerIcon` logic).

## Acceptance criteria
- [x] Server test: each template creates exactly its channels in one transaction, and an unknown template gives `blank`.
- [x] Manual: create with "gaming" and an icon, and the rail shows the icon while the channels match.

## Expected Areas of Change
`server/routes/spaces.js`, `server/db/index.js` (template table constant), `CreateServerDialog.jsx`, a server test.

## Working Set / Blast Radius
~4 files.

## Open questions
- The template channel sets above are a planner proposal. FLAG for human taste.

## Evidence
Baseline: main after #87 (P2-12). Branch `claude/p3-06-server-templates`.

| Acceptance criterion | Evidence |
|---|---|
| Server test: each template creates exactly its channels in one transaction; unknown gives blank | `server/tests/templates.test.js`: blank, friends, gaming and study each create exactly their text and voice channels, in order, both in the POST response and in GET /spaces. `casino`, a missing template and `__proto__` all give blank. A refused create (name taken) leaves the channel count unchanged. Server 181 pass. |
| Manual: create with "gaming" and an icon; the rail shows the icon and the channels match | Sandbox (:3005), the real dialog and real cropper. A generated PNG was handed to the dialog's file input via `DataTransfer` (the pane can't drive the OS picker); framed with the cropper's Save; Gaming chosen; Create. Result: "P306 Raid Night" selected; the rail `<img>` is the uploaded icon; `iconOriginal` and `iconCrop` are saved (re-frame works); channels general / lfg / clips + squad-1 / squad-2. The screenshot shows the G icon in the rail. The throwaway server was deleted after. |

Web 401 pass (3 new and 1 updated in CreateServerDialog.test.jsx; the cropper is stubbed there because jsdom has no canvas). Build clean.

### Notes
- Template channel names are stored normalized (`squad-1`, `study-room`), the same as a user-made channel would be. **The sets are the planner's proposal; still open for your taste.**
- The client's template cards are a preview list; the server's `SERVER_TEMPLATES` decides. An unknown key from any client gives blank.
- The icon is uploaded after the server exists (the original and the framed image, then a PATCH). If only the icon fails, the server is kept and a message says to set the icon from the server menu (retrying the create would hit "name already exists").
- The setup wizard's first server still uses blank (it sends no template).

## Discovered Work (not done)
- Offer the templates in the setup wizard's "first server" step too. → done in P3-15.
