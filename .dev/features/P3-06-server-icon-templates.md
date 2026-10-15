# P3-06 — Server icon + starter templates at creation

- **Unit Type:** Implementation (slice 2 of the create-server dialog)
- **Phase:** 3 — "proper modal with tabs (name, icon, template)"
- **State:** PLANNED
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
- [ ] Server test: each template creates exactly its channels in one transaction, and an unknown template gives `blank`.
- [ ] Manual: create with "gaming" and an icon, and the rail shows the icon while the channels match.

## Expected Areas of Change
`server/routes/spaces.js`, `server/db/index.js` (template table constant), `CreateServerDialog.jsx`, a server test.

## Working Set / Blast Radius
~4 files.

## Open questions
- The template channel sets above are a planner proposal. FLAG for human taste.
