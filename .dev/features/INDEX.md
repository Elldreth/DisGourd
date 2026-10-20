# DisGourd feature packets: index

Source: `design/IMPROVEMENT-PLAN.md`. Every item was revalidated against `main` (935fd85) on 2026-10-15.
States: **READY** means the dependencies are satisfied and it can start now. **PLANNED** means it's waiting on dependencies. Nothing is BLOCKED on external input.

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
| P2-18 | PWA + Web Push (Container: a, b) | 2 | COMPLETE | M | see packet | sw.js, static.js, push |
| P2-18a | Service worker + installable shell | 2 | COMPLETE | S–M | P1-04 | web/public/sw.js (new), offline.html (new), static.js, main.jsx, Toasts |
| P2-18b | Web Push for mentions and DMs while no socket is open | 2 | COMPLETE | M | P2-18a, P2-04, P2-14 | push routes, push_subscriptions, NotificationSettings |
| P2-19 | Custom server emoji (Container: a, b) | 2 | COMPLETE | M | see packet | migrations, routes/spaces, markdown, picker |
| P2-19a | Custom emoji: storage + management API | 2 | COMPLETE | S–M | P1-01, P1-04 | migrations, db, routes/spaces, routes/uploads |
| P2-19b | Custom emoji: `:name:` rendering, picker tab, reactions, settings | 2 | COMPLETE | M | P2-19a | markdown.jsx, EmojiPicker, MessageList, ChannelSettingsDialog/ServerSettings, gateway react op |
| P2-20 | /imagine with two engines, local ComfyUI or kie.ai (Container: a–d) | 2 | COMPLETE | L | P2-21 | server/imagine/*, bot user, admin page, Composer |
| P2-20a | Imagine core: bot user, settings, permission, limits, job runner, fake engine | 2 | COMPLETE | M | P2-21 | migrations, db, server/imagine/*, gateway, admin + spaces routes |
| P2-20b | ComfyUI engine + Image generation settings section | 2 | COMPLETE | M | P2-20a | server/imagine/engines/comfyui.js, admin routes, ImagineAdmin |
| P2-20c | kie.ai engine: model catalogue, real prices, monthly credit cap | 2 | COMPLETE | M | P2-20a, b, d | server/imagine/engines/kie.js, admin routes, ImagineAdmin, ImaginePanel |
| P2-20d | /imagine in chat: panel, server + 18+ switches, bot badge | 2 | COMPLETE | M | P2-20a, P2-20b | Composer, ImaginePanel, ServerImagineDialog, ChannelSettingsDialog, MessageList |
| P2-21 | Custom roles (Container: a–d) | 2 | COMPLETE | L | see packet | permissions.js, migrations, UI |
| P2-21a | Roles schema seeded from tiers + a resolver that agrees with today's checks | 2 | COMPLETE | M | P1-01, P1-06 | migrations, db, permissions.js |
| P2-21b | Permission resolution switched to roles | 2 | COMPLETE | M | P2-21a | permissions.js, db queries, routes, gateway |
| P2-21c | Role management UI (create, reorder, colour, permission matrix) | 2 | COMPLETE | M | P2-21b | routes, RolesDialog (new), ChannelSettingsDialog |
| P2-21d | Role colours in names and member-list grouping | 2 | COMPLETE | S | P2-21c | MessageList, MemberList, Avatar |
| P2-22 | Threads (Container: a–d) | 2 | COMPLETE | L | P2-10, P2-13 | see children |
| P2-22a | Thread data model + server API | 2 | COMPLETE | M | P2-22 decisions | db, gateway/chat.js, routes/spaces.js |
| P2-22b | Thread panel + summaries, composable gateway handlers | 2 | COMPLETE | M | P2-22a | gatewayHandlers.js, App.jsx, ThreadPanel.jsx (new) |
| P2-22c | Thread follows, unread, notifications | 2 | COMPLETE | M | P2-22a, P2-22b | db unread queries, notify.js, ThreadPanel.jsx |
| P2-22d | Auto-archive threads after 7 quiet days | 2 | COMPLETE | S | P2-22a | gateway/index.js, routes/spaces.js |
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
| P3-16 | Two small follow-ups: typing in threads, server view after create/join | 3 | COMPLETE | S | P2-22b, P1-14 | gateway/chat.js, useChannelMessages.js, App.jsx |
| P3-15 | Server templates in the setup wizard | 3 | COMPLETE | S | P3-06, P3-07 | serverTemplates.js (new), TemplatePicker.jsx (new), SetupWizard.jsx, CreateServerDialog.jsx |
| P3-17 | Dev server forwards every API path (`/me`, `/dms`, `/search`, `/invites`) | 3 | COMPLETE | S | none | vite.config.js, devProxy.js (new) |
| P3-18 | Channel list shield follows the role overrides | 3 | COMPLETE | S | P2-21c | db/index.js (getUserSpaces), ChannelList.jsx |
| P3-19 | The "new version" notice stays clear of the composer | 3 | COMPLETE | S | P2-18a, P3-09 | Toasts.jsx, App.jsx |
| P3-20 | Smoothness batch (Container: a–c) | 3 | COMPLETE | M | see packet | see children |
| P3-20a | Channel topics | 3 | COMPLETE | M | none | migrations, routes/spaces.js, ChatPanel, ChannelSettingsDialog |
| P3-20b | Small fixes: first server from the empty screen, DM divider, offline contrast, link underline | 3 | COMPLETE | S–M | none | ChatPanel, ServerRail, useDms, MemberList, index.css |
| P3-20c | Hide preview (authors and moderators remove link cards) | 3 | COMPLETE | S–M | none | migrations, linkPreviews.js, routes, Embed, MessageList |
| P3-21 | Say where the /imagine daily limit comes from | 3 | COMPLETE | S | P2-20 | server/imagine/index.js, ImaginePanel, ImagineAdmin, ServerImagineDialog |
| P3-22 | The channel gear no longer covers the 18+ tag | 3 | COMPLETE | XS | P2-20d | ChannelList.jsx |
| P3-23 | /imagine Retry and Variations | 3 | COMPLETE | S–M | P2-20, P3-21 | server/imagine/index.js, db (job by message), MessageList, ChatPanel |
| P3-24 | ComfyUI models that aren't single checkpoint files | 3 | COMPLETE | M | P2-20b | engines/comfyui.js, ImagineAdmin |
| P3-25 | Channel categories (Container: a–d) | 3 | COMPLETE | L | P2-21, P3-15 | see children |
| P3-25a | Categories: data and API (v17, layout route, live event, templates) | 3 | COMPLETE | M | none | migrations, db/index.js, routes/spaces.js, templates |
| P3-25b | Categories in the channel list (collapse, manage, keyboard moves) | 3 | COMPLETE | M | P3-25a | ChannelList.jsx, CategoryDialog |
| P3-25c | Drag and drop channels and categories | 3 | COMPLETE | S–M | P3-25b | ChannelList.jsx, drag hook |
| P3-25d | Category permissions, copied to channels | 3 | COMPLETE | M | P3-25a (b for UI) | migrations, roles, ChannelSettingsDialog |
| P3-26 | Moderation tools (Container: a–d) | 3 | COMPLETE | L | P2-21, P1-10 | see children |
| P3-26a | Moderation log | 3 | COMPLETE | M | none | migrations, db, routes, ModLogDialog |
| P3-26b | Ban (with message clean-up, Bans list, invite refusal) | 3 | COMPLETE | M | P3-26a | migrations, routes, invites, member menu, BansDialog |
| P3-26c | Timeout (posting, reacting, voice blocked; auto-lift); calls end on ban / removal | 3 | COMPLETE | M | P3-26a | migrations, chat / imagine / voice checks, Composer |
| P3-26d | Slow mode per channel | 3 | COMPLETE | S–M | P3-26a | migrations, chat gateway, ChannelSettingsDialog, Composer |
| P3-27 | Message edit history (channels, threads and DMs; anyone who sees the message) | 3 | COMPLETE | M | none | migrations, db, chat + dm gateway, routes, MessageList, EditHistoryDialog |
| P3-28 | ComfyUI hires fix (High quality: upscale model + light repaint) | 3 | COMPLETE | S–M | P3-24 | engines/comfyui.js, ImagineAdmin |
| P3-29 | Upscale button on /imagine images (model only or tiled repaint) | 3 | COMPLETE | M | P3-23, P3-24, P3-28 | migrations, imagine/index.js, runner, engines/comfyui.js, ImagineAgain, ImagineAdmin |
| P3-30 | Image viewer: right-click to save, real size, Download | 3 | COMPLETE | S | none | MessageList (row events), Lightbox, Icon |
| P3-31 | ComfyUI advanced settings: sampler, CFG, steps, negative, face detailer | 3 | COMPLETE | M | P3-24, P3-28, P3-29 | engines/comfyui.js, ImagineAdmin |
| P3-32 | Update notice behind dialogs; date/time image names | 3 | COMPLETE | XS | P3-19, P2-20 | Toasts.jsx, imagine/runner.js |
| P3-33 | Passes for the face detailer and tiled upscale; missing-node fallbacks | 3 | COMPLETE | S–M | P3-29, P3-31 | engines/comfyui.js, runner.js, ImagineAdmin |
| P3-34 | Custom ComfyUI workflows with placeholders | 3 | COMPLETE | M | P3-24–P3-33 | engines/comfyui.js, imagine/index.js, routes/admin.js, ImagineAdmin |
| P3-35 | Anima models (ComfyUI split-model family) | 3 | COMPLETE | S–M | P3-24 | engines/comfyui.js, ImagineAdmin |
| P3-36 | img2img: Subtle / Strong Variations, start from your own image (Container: a–b) | 3 | COMPLETE | M–L | P3-23–P3-34 | see children |
| P3-36a | Subtle / Strong Variations (img2img) and a stronger face detailer | 3 | COMPLETE | M | P3-36 | migrations, imagine/index.js, runner, engines/comfyui.js, ImagineAgain |
| P3-36b | Start /imagine from your own image; image-to-image custom workflow | 3 | COMPLETE | M | P3-36a | ImaginePanel, Composer, imagine/index.js, ImagineAdmin |
| P4-00 | "Shine" polish round (Container: 01–07) | 4 | COMPLETE | 3 M + 4 S | none | see children; source design/UX-REVIEW-2026-10.md |
| P4-01 | Phone touch targets and header | 4 | COMPLETE | M | none | index.css, IconButton.jsx, ChatPanel.jsx, ChannelList.jsx, DmSidebar.jsx, MessageList.jsx, Composer.jsx, ThreadPanel.jsx |
| P4-02 | Settings with section navigation | 4 | COMPLETE | M | none | ProfileDialog.jsx, AudioSettings.jsx, NotificationSettings.jsx, AppearanceSettings.jsx, RegistrationAdmin.jsx |
| P4-03 | Empty states with flat illustrations | 4 | COMPLETE | M | none | EmptyState.jsx (new), design/empty-states/*, ~10 components |
| P4-04 | New message from the DM view | 4 | COMPLETE | S | none (soft P4-03) | DmSidebar.jsx, QuickSwitcher.jsx, App.jsx, shortcuts.js |
| P4-05 | Calmer link previews | 4 | COMPLETE | S | none | Embed.jsx |
| P4-06 | Hierarchy and a11y polish (10 small items) | 4 | COMPLETE | S | none | ServerRail.jsx, ChannelList.jsx, MessageList.jsx, MessageActions.jsx, AuthShell.jsx, ThreadPanel.jsx, AudioSettings.jsx, Gourd.jsx |
| P4-07 | Thread panel on phones: back + hardware back | 4 | COMPLETE | S | none | overlayHistory.js (new), ThreadPanel.jsx, App.jsx, MemberList.jsx |
| P5-00 | Settings and menus round 2 (Container: 01–06) | 5 | COMPLETE | 2 S, 2 M, 2 L | none (map agreed 2026-10-19) | see children; source design/settings-review-2026-10/REVIEW.md |
| P5-01 | Quick fixes: image overflow, member menu dismissal | 5 | COMPLETE | S | none | MessageList/Attachment, MemberList.jsx |
| P5-02 | Settings kit and your settings | 5 | COMPLETE | M | P5-01 (order) | components/settings/* (new), ProfileDialog.jsx, UserFooter.jsx, Modal.jsx |
| P5-03 | Site admin: General and Image generation pages | 5 | COMPLETE | L | P5-02 | components/admin/imagine/* (new), ImagineAdmin.jsx, RegistrationAdmin.jsx |
| P5-04 | Server settings window and a short server menu | 5 | COMPLETE | L | P5-02 | components/server-settings/* (new), ChannelList.jsx, Roles/ModLog/Bans/Emoji/ServerImagine dialogs |
| P5-05 | Channel settings tabs and member menu header | 5 | COMPLETE | M | P5-02, P5-01 | ChannelSettingsDialog.jsx, MemberList.jsx |
| P5-06 | Sound set, image-generation art, shorter voice warning | 5 | COMPLETE | M | P5-03 (art only) | sounds.js, web/public/sounds/*, ChannelList.jsx |
| P6-01 | Leave server | 6 | COMPLETE | S | none | routes/spaces.js, db/index.js, useSpaces.js, ChannelList.jsx |
| P6-02 | Change password (signs out other devices; migration v25) | 6 | COMPLETE | M | none | routes/auth.js, auth/tokens.js, gateway, ProfileDialog.jsx, ChangePasswordDialog.jsx (new) |
| P6-03 | Rename channel | 6 | COMPLETE | M | none (after P6-01: shared files) | routes/spaces.js, db/index.js, gateway/voice.js, useSpaces.js, ChannelSettingsDialog.jsx, ModLogSection.jsx |
| P6-04 | Leftovers: server rename keeps calls, countdowns follow renames, duplicate CSS | 6 | COMPLETE | S | P6-03 | gateway/voice.js, routes/spaces.js, voice.js, useVoiceCall.js, slowmode.js, App.jsx, index.css |
| P7-01 | Setup wizard: the invite link first, with "Copy link" | 7 | COMPLETE | S | none | setup wizard |
| P7-02 | Keyboard shortcuts sheet (Ctrl+/) and hints in tooltips | 7 | COMPLETE | S | none | shortcuts, status menu |
| P7-03 | Pins and Threads open beside the chat | 7 | COMPLETE | M | none | ChatPanel, PinsPanel, ThreadsList |
| P7-04 | Phones: full visible height, a gap above the home bar | 7 | COMPLETE | S | none | index.css, App layout |
| P7-05 | Small fixes: kie.ai spend on the overview, dev-server font note, closing old questions | 7 | COMPLETE | S | none | imagine/index.js, OverviewPage.jsx, INDEX |

## Dependency map (hard dependencies)

```
Server split:   P1-02 -> P1-03 -> P1-04 -> P1-05
                                  |        |
                         P1-06 <--+--------+   (also needs P1-03)
Migrations:     P1-01 --+--> P2-09 -> P2-10 -> P2-22a -> P2-22b -> P2-22c;  P2-22a -> P2-22d
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
| **G. Shine (Phase 4 polish, one at a time: shared files)** | P4-01 → P4-02 → P4-03 → P4-04 → P4-05 → P4-06 → P4-07 (order is the review's priority; the user picks the first) |
| **H. Settings round 2 (one at a time: shared files)** | P5-01 → P5-02 → P5-03 → P5-04 → P5-05 → P5-06 (the owner agreed the map and all five recommendations on 2026-10-19) |
| **I. Missing actions (Phase 6)** | P6-01 → P6-03 (shared files); P6-02 alongside either. Details agreed with the owner on 2026-10-20: leaving isn't logged; a password change signs out other devices; a voice channel rename keeps people connected; renames are logged. |
| **J. UX review follow-ups (Phase 7, one PR each)** | P7-01 wizard invite link → P7-04 phone height and home-bar gap → P7-02 shortcuts sheet → P7-03 Pins/Threads side panel (the owner agreed the order and chose the side panel on 2026-10-20). Rows join the Units table once #169 is merged, to avoid a conflict there. |

Lanes B and C both touch MessageList in P1-08 and P2-05. Never run those two at the same time as another lane-C unit.

## Open questions flagged for the human
All closed (2026-10-20, P7-05), each with what was built or decided:
- ~~P1-01: fail fast on a migration error at boot?~~ Yes: a failed migration rolls back and stops the server with a clear error (`runMigrations`, tested in `db-migrations.test.js`).
- ~~P1-10: moderators can delete only lower-ranked authors' messages?~~ Yes, built that way (P1-10), and it's the same rank rule as kick, ban and timeout (P3-26).
- ~~P1-12/P1-19: hooks + useReducer (no store library), and Vitest?~~ Yes, both in use.
- ~~P1-15: UID/GID for Unraid volumes (99:100?), plus a one-time chown needed.~~ 99:100 (2026-10-17); chown documented in the README.
- ~~P2-12: proxy og:images to hide viewer IPs (v1 assumes no)?~~ Yes, built in P2-23 (2026-10-17).
- ~~P2-18: iOS install requirement for push; push message previews?~~ Built: iPhone/iPad need DisGourd added to the Home Screen first (Notification settings says so), and pushes show a short preview. The owner hasn't confirmed a push on a real phone yet.
- ~~P2-20: ComfyUI models and VRAM, kie.ai models and prices, default limits.~~ Settled while building P2-20b/c and P3-21–P3-36 (the owner's ComfyUI, the kie.ai catalogue with real prices, a daily default per instance and per server).
- ~~P2-21: bitset permissions versus named thresholds.~~ Named permissions per role (the owner's choice, 2026-10-18).
- ~~P2-22: thread model.~~ Decided 2026-10-17: hidden child channels; anyone who can post starts one; auto-archive after 7 quiet days; follow model (see P2-22-threads.md).
- ~~P3-06: the template channel sets.~~ Approved as proposed (2026-10-17).

## Art pass (P8)
Kept as its own table so it doesn't collide with other sessions' rows.

| ID | Title | Phase | State | Effort | Depends on | Main files |
|---|---|---|---|---|---|---|
| P8-01 | Art pass: mascot poses, sign-in art, ready-made server icons, share image | 8 | COMPLETE | M | none | mascotParts.js, Mascot.jsx, LoginArt.jsx, serverGlyphs.js, GlyphPicker.jsx, AuthShell.jsx, server/static.js, web/public/og-image.png |
| P9-01 | Message reports (moderators' Reports queue; servers only) | 9 | COMPLETE | M | P3-26, P1-10 | migrations v26, routes, gateway, MessageList menu, ReportsDialog |
| P9-02 | Hand a server to a new owner (immediate; old owner becomes Admin) | 9 | COMPLETE | S–M | P2-21, P5-04 | routes/spaces.js, db, OverviewSection, TransferDialog |
| P9-03 | Signed-in devices (list, sign out one or all others; no IPs) | 9 | COMPLETE | M | P6-02 | migrations v27, auth/tokens.js, routes/auth.js, gateway, My account |
| P9-04 | ComfyUI style presets (Container: a–c) | 9 | PLANNED | L | P2-20b, P3-24–P3-36 | see children |
| P9-04a | Style presets: engine and server (migration v28) | 9 | COMPLETE | M | P9-04 design | engines/comfyui.js, imagine/index.js, runner, admin routes |
| P9-04b | Style presets: Settings (Styles list and editor) | 9 | REVIEW | M | P9-04a | ComfyPage.jsx, ImagineSettings.jsx, StylesSection.jsx, QualityPage.jsx |
| P9-04c | Style presets: /imagine panel Style row and message text | 9 | READY | S–M | P9-04a, P9-04b | ImaginePanel.jsx, Composer, runner text |
