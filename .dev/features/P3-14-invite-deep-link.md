# P3-14 — Invite deep link

- **Unit Type:** Implementation
- **Phase:** 3 (follow-up found in P3-07)
- **State:** COMPLETE
- **Effort:** S
- **Depends on:** none (P3-04 Join dialog is merged)
- **Serialize with:** CreateServerDialog.jsx, ServerRail.jsx, InviteDialog.jsx, App.jsx units
- **Requirement Source:** Discovered Work in P3-07 (`P3-07-setup-wizard.md`)
- **Starting baseline:** `main` at 6a8c456 (main merged in again after P3-07, #84, landed)

## Scope
- Opening the app at `/invite/<code>` or `/?invite=<code>` remembers the code (sessionStorage, so it survives the sign-in or registration screen and a reload).
- Once signed in, the "Add a server" dialog (owned by ServerRail) opens on the Join tab with the code filled in, so the invite preview shows at once. Enter joins.
- The URL is then cleaned with `history.replaceState` and the remembered code is cleared.
- InviteDialog shows a copyable link (`<origin>/invite/<code>`) alongside the code.
- The setup wizard's finish message (FinishStep) leads with the invite link, and keeps the code as a fallback.
- The server already serves `index.html` for unknown paths, so `/invite/<code>` needs no server change (the API lives under `/invites/`).

## Non-goals
- No change to how invites are created, previewed or redeemed.

## Acceptance criteria
- [x] `inviteLink(code)` builds `<origin>/invite/<code>`; `readInviteFromLocation` reads both `/invite/<code>` and `?invite=<code>`.
- [x] A code in the URL is remembered before sign-in, survives until signed in, and is cleared (storage + URL) once the dialog has opened.
- [x] Signed in with a remembered code: the Add a server dialog opens on Join, prefilled, and the preview is requested straight away.
- [x] InviteDialog shows the link with its own Copy button, as well as the code.
- [x] The setup wizard's message for friends contains the invite link (and the code), not "paste this invite".
- [x] Sandbox: a signed-out friend (second origin 127.0.0.1; run on :3007, see notes) opens the link, signs in or registers, lands in the prefilled Join dialog and joins with Enter.

## Expected Areas of Change
`web/src/inviteLink.js` (new), `App.jsx`, `ServerRail.jsx`, `CreateServerDialog.jsx`, `InviteDialog.jsx`, `SetupWizard.jsx`, tests.

## Working Set / Blast Radius
7 files, all client side.

## Evidence
| Check | Result |
|---|---|
| `inviteLink.test.js` (+5): link format and encoding; reads `/invite/<code>` and `?invite=`; remembered across a URL change; nothing pending by default; clearing forgets it and cleans the URL (keeps other params and the hash) | pass (failed first: module missing) |
| `CreateServerDialog.test.jsx` (+1): `initialCode` fills the Join box, focuses it, previews at once; submit joins | pass (failed first) |
| `ServerRail.test.jsx` (+2, new): a pending invite opens Join prefilled and calls `onInviteOpened` once; none, no dialog | pass (failed first) |
| `InviteDialog.test.jsx` (+1, new): link and code shown, Copy link / Copy code copy the right text | pass (failed first) |
| `App.test.jsx` (+2): signed out at `/invite/abc123` -> sign-in screen; then signed in -> Join open, prefilled, previewed, URL `/`, storage empty, no console errors. Already signed in at `?invite=` -> same | pass (failed first) |
| `SetupWizard.test.jsx` (+2 assertions): the friends' message contains `<origin>/invite/INV123` and no "paste this invite" | pass (failed first) |
| Full suite / build (after merging main) | web 392/392, build ok |
| Sandbox (owner, localhost): InviteDialog shows `http://localhost:3007/invite/<code>` and the code, two Copy buttons | pass |
| Sandbox (friend, 127.0.0.1, signed out): opened `/invite/<code>`, code stored, sign-in screen; signed in as bob -> URL `/`, storage empty, Join dialog with the code, focused, preview "Smoke Test, 1 member"; Enter -> joined, Smoke Test selected | pass |
| Sandbox (friend, registering): signed out, opened `/?invite=<code>`, registered a new user -> same prefilled dialog ("2 members"); Enter -> joined (Members 3); no console errors; reload -> no dialog | pass |

## Implementation notes
- `web/src/inviteLink.js`: `inviteLink`, `readInviteFromLocation`, `capturePendingInvite` (URL first, else sessionStorage `disgourd.pendingInvite`), `clearPendingInvite` (storage + `history.replaceState`).
- `App` captures the code on first render and passes it to `ServerRail`; `ServerRail` opens `CreateServerDialog` (new `initialCode` prop) on Join and calls `onInviteOpened`, which clears it. The dialog is keyed by code so a new invite remounts it.
- The sandbox check ran on port 3007 against a fresh copy of the sandbox DB, because another session's sandbox server already held 3005. Same test users; never the real DB.

## Not verified
- The Copy buttons write to the clipboard in a real browser (the unit test mocks `copyText`; the copy helper itself is unchanged).
- The wizard's new message in a browser: covered by the unit test only. The link it contains is the same deep link checked in the sandbox above.
- Behind a reverse proxy with a path prefix: links assume the app is at the origin root, as the rest of the app does.

## Discovered Work (not done)
- **Vite dev proxy misses `/invites`:** `web/vite.config.js` `apiPaths` doesn't include `/invites`, so invite preview and join fail under `npm run dev` (5173). Production (Node serving `web/dist`) is unaffected.
