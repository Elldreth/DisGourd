# DisGourd feature packets: index

Source: `design/IMPROVEMENT-PLAN.md`. Every item was revalidated against `main` (935fd85) on 2026-10-15.
States: **READY** means the dependencies are satisfied and it can start now. **PLANNED** means it's waiting on dependencies. Nothing is BLOCKED on external input except the open questions flagged in P1-15 and P2-20.

## Already done (dropped from the packets)
- **Phase 0, all of 0.1–0.8.** Includes `PRAGMA foreign_keys` plus orphan cleanup, the size limits (JSON 64 KB, WS 256 KB, message 4,000 characters, crop sanitised), async scrypt, and the `canView` delivery helper.
- **Phase 3 "Contrast fails WCAG AA."** Fixed by the Neon Calabash retheme: white on `brand #7444F0` is 5.5:1, and `gray-500 #9A90C2` on `ink-700` is 5.8:1 (re-computed).
- **Phase 3 "Inter is declared but never loaded."** Fixed: `@fontsource-variable/inter` and Space Grotesk are imported in `web/src/index.css`.
- **Phase 4 direction and logo.** Done (out of scope here).
- **Partly done:** the PWA manifest and icons exist (P2-18 adds the service worker). Speaking detection exists in `voice.js` (P3-13 surfaces it on video tiles).

## New issues found during revalidation
- **P1-11:** the `dm_unread` frame sends `{other}` but the client reads `c.with`, so DM unread badges are lost on every load and reconnect.
- **P1-06:** registration-code `max_uses` and `MAX_ACCOUNTS` can be overrun. There's an `await hashPassword` between the check and the increment, and a duplicate-username race leaks SQLite error text.

## Units

| ID | Title | Phase | State | Effort | Depends on | Main files |
|---|---|---|---|---|---|---|
| P1-01 | Versioned migrations + pragmas + indexes | 1 | COMPLETE | M | none | db/index.js, db/migrations.js (new) |
| P1-02 | Server split 1/4: core modules | 1 | COMPLETE | M | none | server.js, config.js, auth/*, http/util.js, validate.js, permissions.js, gateway/delivery.js |
| P1-03 | Server split 2/4: auth/admin/social routes | 1 | COMPLETE | M | P1-02 | server.js, routes/{index,auth,admin,social}.js |
| P1-04 | Server split 3/4: spaces/invites/uploads/static | 1 | COMPLETE | M | P1-03 | server.js, routes/{spaces,invites,uploads}.js, static.js, http/handler.js |
| P1-05 | Server split 4/4: gateway | 1 | COMPLETE | M | P1-04 | server.js, gateway/{index,router,chat,dm,voice}.js |
| P1-06 | Transactions (space create, msg+mentions, invite, registration) | 1 | COMPLETE | S–M | P1-03, P1-04, P1-05 | db/index.js, routes/*, gateway/chat.js |
| P1-07 | Cursor pagination API (`before`) | 1 | COMPLETE | S | none (soft P1-01) | db/index.js, server.js (2 handlers) |
| P1-08 | Load older messages UI | 1 | COMPLETE | M | P1-07, P1-12 | MessageList.jsx, api.js, state hooks |
| P1-09 | Reconnect resync | 1 | COMPLETE | S–M | P1-05, P1-08, P1-14 | gateway/index.js, state hooks, useSocket.js |
| P1-10 | Moderation: delete_others_messages | 1 | COMPLETE | S | P3-05 (soft P1-05) | permissions.js, db/index.js, gateway/chat.js, MessageActions.jsx |
| P1-11 | Fix dm_unread key mismatch | 1 | COMPLETE | S | none | server.js (1 line) |
| P1-12 | App split 1/3: channel-message hook | 1 | COMPLETE | M | none (after P1-11) | App.jsx, state/useChannelMessages.js |
| P1-13 | App split 2/3: DM hook | 1 | COMPLETE | S–M | P1-12 | App.jsx, state/useDms.js |
| P1-14 | App split 3/3: spaces + voice hooks | 1 | COMPLETE | M | P1-13 | App.jsx, state/useSpaces.js, state/useVoiceCall.js |
| P1-15 | Docker: non-root, HEALTHCHECK, npm ci | 1 | COMPLETE | S | none | Dockerfile, docker-compose.yml, README.md |
| P1-16 | Nightly VACUUM INTO backups | 1 | COMPLETE | S | none | backup.js (new), server.js (boot), README.md |
| P1-17 | GitHub Actions CI | 1 | COMPLETE | S | none | .github/workflows/ci.yml |
| P1-18 | Bump Vite | 1 | COMPLETE | S | none | web/package.json, vite.config.js |
| P1-19 | Web test harness (Vitest) | 1 | COMPLETE | S | P1-18 | web/package.json, vite.config.js |
| P1-20 | Voice rejoin after reconnect | 1 | COMPLETE | S–M | P1-09 | voice.js, useVoiceCall.js, gateway/voice.js |
| P1-21 | Tailwind 4 + theme as CSS variables (absorbs P2-16) | 1 | COMPLETE | M | P1-18 | index.css, vite.config.js, package.json, class renames |
| P2-01 | Markdown core | 2 | COMPLETE | S–M | P1-19 | markdown.jsx (new), MessageList.jsx, index.css |
| P2-02 | Syntax highlighting (lazy) | 2 | COMPLETE | S | P2-01 | markdown.jsx, highlight.js (new), index.css |
| P2-03 | Tab title + favicon badge | 2 | COMPLETE | S | none | attention.js (new), App.jsx (+2 lines) |
| P2-04 | Desktop notifications + sounds | 2 | COMPLETE | S–M | P1-13 | notify.js (new), sounds.js, audio.js, ProfileDialog.jsx |
| P2-05 | New-messages divider + jump | 2 | COMPLETE | S–M | P1-08 | db/index.js, MessageList.jsx, useChannelMessages.js |
| P2-06 | Emoji picker in composer | 2 | COMPLETE | S–M | none | EmojiPicker.jsx (new), emoji.js (new), Composer.jsx, web/package.json |
| P2-07 | Any emoji as reaction | 2 | COMPLETE | S | P2-06, P3-05 | MessageActions.jsx |
| P2-08 | Drag-drop + paste upload | 2 | COMPLETE | S | none | Composer.jsx, ChatPanel.jsx, DmPanel.jsx |
| P2-09 | Replies in channels | 2 | COMPLETE | M | P1-01, P1-05, P3-05 | migrations.js, db/index.js, gateway/chat.js, Composer/MessageList |
| P2-10 | Replies in DMs + jump (`around`) | 2 | COMPLETE | S–M | P2-09, P1-08, P1-13 | db/index.js, gateway/dm.js, routes, MessageList |
| P2-11 | SSRF-safe fetcher + OG parser | 2 | COMPLETE | M | none | net/safeFetch.js (new), integrations/unfurl.js (new) |
| P2-12 | Link previews end-to-end | 2 | COMPLETE | M | P2-11, P1-01, P1-05 (soft P2-01) | linkPreviews.js (new), migrations.js, gateway, Embed.jsx (new) |
| P2-13 | Pins | 2 | COMPLETE | M | P1-01, P1-04, P1-05, P3-05 | migrations.js, gateway/chat.js, routes/spaces.js, PinsPanel.jsx (new) |
| P2-14 | DND / invisible presence | 2 | COMPLETE | S–M | P1-01, P1-05 | migrations.js, gateway/delivery.js, routes/auth.js, UserFooter/Avatar/MemberList |
| P2-15 | Custom status text | 2 | COMPLETE | S | P2-14 | same as P2-14 |
| P2-16 | Theme tokens → CSS vars (done in P1-21) | 2 | COMPLETE | S | none | index.css (@theme) |
| P2-17 | Light theme + picker | 2 | COMPLETE | M | P2-16 | index.css, theme.js (new), index.html, ~12 components |
| P2-18 | PWA + Web Push (Container: a, b) | 2 | PLANNED | M | see packet | sw.js, static.js, push |
| P2-19 | Custom server emoji (Container: a, b) | 2 | PLANNED | M | see packet | migrations, routes/spaces, markdown, picker |
| P2-20 | /imagine via kie.ai (Container: a, b, c) | 2 | PLANNED | M+ | see packet | integrations/kie.js, bot user |
| P2-21 | Custom roles (Container: a–d) | 2 | PLANNED | L | see packet | permissions.js, migrations, UI |
| P2-22 | Threads (Container) | 2 | PLANNED | L | P2-10 | TBD after P2-10 |
| P2-23 | Link-preview image proxy | 2 | COMPLETE | S–M | P2-11, P2-12 | net/imageProxy.js (new), net/safeFetch.js, routes, linkPreviews.js, Embed.jsx |
| P3-01 | Modal primitive + simple dialogs | 3 | COMPLETE | S–M | none | Modal.jsx (new), Invite/ChannelSettings/ServerPermissions dialogs |
| P3-02 | Remaining overlays → Modal | 3 | COMPLETE | S–M | P3-01 | ProfileDialog, ImageCropper, SearchOverlay, Lightbox |
| P3-03 | Icon-button labels sweep | 3 | COMPLETE | S–M | P3-02, P3-05 | IconButton.jsx (new), ~12 components (exclusive) |
| P3-04 | Create/Join server dialog | 3 | COMPLETE | S | P3-01 | CreateServerDialog.jsx (new), ServerRail.jsx, App.jsx |
| P3-05 | Accessible message actions | 3 | COMPLETE | M | none | MessageList.jsx, MessageActions.jsx (new) |
| P3-06 | Server icon + templates at creation | 3 | COMPLETE | S–M | P3-04, P1-06 | routes/spaces.js, CreateServerDialog.jsx |
| P3-07 | Setup wizard improvements | 3 | COMPLETE | S | none | SetupWizard.jsx |
| P3-08 | In-app confirm (kick, delete server) | 3 | COMPLETE | S | P3-01 | ConfirmDialog.jsx (new), MemberList.jsx, ChannelList.jsx |
| P3-09 | Undo toast for message delete | 3 | COMPLETE | S–M | P3-05 | Toasts.jsx (new), App.jsx, MessageActions.jsx |
| P3-10 | Mobile member-list drawer | 3 | COMPLETE | S | none | ChatPanel.jsx, MemberList.jsx, App.jsx |
| P3-11 | Ctrl+K switcher + Alt+↑/↓ | 3 | COMPLETE | S–M | P3-01 (soft P1-14) | QuickSwitcher.jsx (new), shortcuts.js (new), App.jsx |
| P3-12 | ↑ edits last message | 3 | COMPLETE | S | P3-05 | Composer.jsx, MessageList.jsx |
| P3-13 | Voice stage: speaking ring, spotlight, fullscreen | 3 | COMPLETE | S–M | none | VideoStage.jsx, voice.js |
| P3-14 | Invite deep link (`/invite/<code>`) | 3 | COMPLETE | S | none (follow-up to P3-07) | inviteLink.js (new), App.jsx, ServerRail.jsx, CreateServerDialog.jsx, InviteDialog.jsx, SetupWizard.jsx |
| P3-15 | Server templates in the setup wizard | 3 | COMPLETE | S | P3-06, P3-07 | serverTemplates.js (new), TemplatePicker.jsx (new), SetupWizard.jsx, CreateServerDialog.jsx |

## Dependency map (hard dependencies)

```
Server split:   P1-02 -> P1-03 -> P1-04 -> P1-05
                                  |        |
                         P1-06 <--+--------+   (also needs P1-03)
Migrations:     P1-01 --+--> P2-09 -> P2-10 -> P2-22 (threads)
                        +--> P2-12 <- P2-11
                        +--> P2-13, P2-14 -> P2-15, P2-18b, P2-19a, P2-20a, P2-21a
                        (each of those also needs P1-05; P2-13 and P2-19a need P1-04)
History:        P1-07 -> P1-08 -> P2-05
                         P1-08 -> P1-09, P2-10
App split:      P1-11 -> P1-12 -> P1-13 -> P1-14 -> P1-09
                         P1-12 -> P1-08;  P1-13 -> P2-04, P2-10
Tooling:        P1-18 -> P1-19 -> P2-01 -> P2-02;  P2-01 -> P2-19b
Message menu:   P3-05 -> P1-10, P2-07, P2-09, P2-13, P3-09, P3-12, P3-03
Dialogs:        P3-01 -> P3-02 -> P3-03;  P3-01 -> P3-04 -> P3-06 (also needs P1-06), P3-08, P3-11
Theme:          P2-16 -> P2-17
Emoji:          P2-06 -> P2-07, P2-19b
```

## Hot files (serialize: never run two units that edit the same one at once)

| File | Units |
|---|---|
| `server/server.js` | P1-02, P1-03, P1-04, P1-05, P1-07, P1-11, P1-16 |
| `server/db/index.js` | P1-01, P1-06, P1-07, P1-10, P2-05, P2-09+ |
| `web/src/App.jsx` | P1-11, P1-12, P1-13, P1-14, P2-03, P3-04, P3-09, P3-10, P3-11 |
| `web/src/components/MessageList.jsx` | P3-05, P2-01, P1-08, P2-05, P2-09, P3-12 |
| `web/src/components/Composer.jsx` | P2-06, P2-08, P2-09, P3-12 |
| `web/package.json` + lock | P1-18, P1-19, P2-02, P2-06 |
| `web/src/index.css` (theme now lives here) | P2-16, P2-01, P2-02, P2-17 |
| `README.md` / `docker-compose.yml` | P1-15, P1-16 |

**Rule used for states:** features that add *new* server modules (replies, previews, pins, status) hard-depend on the split and on migrations. Small edits to existing handlers (P1-07, P1-11, P1-16) are READY, but must not run *concurrently* with a split unit.

**Testing convention:** every server unit adds its *own* `server/tests/<topic>.test.js` instead of editing `api.test.js`. Jest isolates modules per file, and `:memory:` DBs keep the files independent. That keeps parallel units from conflicting on the 1,000-line shared test file.

## Recommended order (lanes)

Units inside a lane run **sequentially**, because they share hot files. Different lanes can run **in parallel**. Where a unit needs another lane's output, it's marked with `⟵`.

| Lane | Sequence |
|---|---|
| **A. Backend** (server.js, db, routes, gateway) | P1-11 → **P1-02** → P1-03 → P1-04 → P1-05 → P1-07 → P1-06 → P1-16 → P1-10 (server part ⟵ P3-05) → P2-09 (⟵ P3-05) → P2-12 (⟵ P2-11) → P2-14 → P2-15 → P2-13 → P2-10 → containers P2-18 → P2-19 → P2-20 → P2-21 → P2-22 |
| **A′. DB baseline** | P1-01, run alongside P1-02, then merge back into lane A |
| **B. Client state** (App.jsx, state/*) | P1-12 → P1-13 → P1-14 → P2-03 → P1-08 (⟵ P1-07) → P2-04 → P1-09 (⟵ P1-05) → P3-10 → P3-04 (⟵ P3-01) → P3-11 → P3-09 (⟵ P3-05) |
| **C. Message UI** (MessageList, MessageActions, Composer) | P3-05 → P2-08 → P2-06 (⟵ P1-19, for package.json ordering) → P2-01 (⟵ P1-19) → P2-02 → P2-07 → P3-12 → P2-05 (⟵ P1-08) |
| **D. Dialogs** | P3-01 → P3-02 → P3-08 → P3-06 (⟵ P3-04, P1-06) → P3-03 (last, exclusive) |
| **E. Tooling and infra** | P1-17 → P1-18 → P1-19, plus P1-15 at any time (it serializes with P1-16 on README/compose) |
| **F. Independent** | P2-11, P3-13, P3-07, P2-16 → (later, in a quiet window) P2-17 |

Lanes B and C both touch MessageList in P1-08 and P2-05. Never run those two at the same time as another lane-C unit.

## Open questions flagged for the human
- P1-01: fail fast on a migration error at boot (a behaviour change)?
- P1-10: moderators can delete only lower-ranked authors' messages (assumed)?
- P1-12/P1-19: hooks + useReducer (no store library), and Vitest (assumed)?
- ~~P1-15: UID/GID for Unraid volumes (99:100?), plus a one-time chown needed.~~ 99:100 (2026-10-17); chown documented in the README.
- ~~P2-12: proxy og:images to hide viewer IPs (v1 assumes no)?~~ Yes, built in P2-23 (2026-10-17).
- P2-18: iOS install requirement for push; push message previews?
- P2-20: kie.ai models, endpoints, cost, quota defaults, NSFW policy (unknown; do not invent).
- P2-21: bitset permissions versus named thresholds. P2-22: thread model.
- ~~P3-06: the template channel sets.~~ Approved as proposed (2026-10-17).
