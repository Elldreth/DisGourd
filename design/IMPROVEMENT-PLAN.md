# DisGourd improvement plan

Written 2026-10-14 from two read-only reviews (one UX/UI, one full-stack/security) plus logo and hero-art concepts generated with kie.ai. Everything below is still a proposal; none of it has been implemented.

**Overall verdict.** The foundations are good. Password hashing (scrypt), JWT checks, upload path safety, React escaping, presence and reconnect are all handled properly. Before you open the server to anyone beyond trusted friends, though, some hardening has to happen. Most of that is small work, roughly 1–2 days in total. The visual design is tidy, but it reads as "Discord with the blue swapped out."

---

## Phase 0: Fix what's broken (do this first)

| # | Issue | Where | Effort |
|---|---|---|---|
| 0.1 | **Any logged-in user can crash the server.** A malformed JSON body, `?limit=abc`, or a WebSocket frame where a string is expected but an object is sent all kill the process. The HTTP router and the WS handler need try/catch around them, plus type checks and clamping on inputs. | `server/server.js` lines 501…806, 790, 1083/1376, 1268, 1294 | S |
| 0.2 | **The placeholder `JWT_SECRET` in docker-compose is accepted.** The server only rejects the literal `changeme`. Refuse any secret shorter than 32 characters or matching a known placeholder. | `docker-compose.yml:20`, `server.js:48` | S |
| 0.3 | **Private channels leak.** Messages, edits, reactions, typing indicators, search results and unread counts reach members who can't view the channel. Add a single `canView` delivery helper and use it everywhere. | `server.js:1060-1174`, `db/index.js:618,653,787` | S–M |
| 0.4 | **The login rate limit can be bypassed** with a spoofed `X-Forwarded-For` header. On top of that, synchronous scrypt blocks the event loop on every login attempt. | `server.js:79,101,167` | S |
| 0.5 | **No size limits.** JSON bodies, the WS `maxPayload` (100 MiB default), message length and `avatarCrop` are all unbounded. | `server.js:387,987,1109,1204,506` | S |
| 0.6 | **`/friends/accept` works without a pending request**, so anyone can add anyone. Self-requests are also allowed. | `server.js:626-635` | S |
| 0.7 | **`PRAGMA foreign_keys` is never turned on**, so the cascades never run and orphaned rows pile up. Enable it and run a one-time cleanup. | `db/index.js:8` | S–M |
| 0.8 | **`node_modules/ws` is committed** to the repo root. Untrack it, and make sure setup installs `server/` deps. | repo root | S |

**Already done in this session:** `.env` was already gitignored and has never been committed. `.env`, `.env.*` and `*.local` are now also in `.dockerignore`, so your KIE key can't end up in a Docker image.

## Phase 1: Foundations before new features

- **Split `server.js` (1,400 lines)** into `auth/`, `routes/{spaces,dms,admin,uploads}`, `gateway/{router,voice}`, and a `permissions.js` with `canView`, `canPost` and `canModerate`.
- **Versioned migrations.** Use `PRAGMA user_version` instead of the current try/catch-and-continue.
- **Indexes** on `messages(channel_id,id)`, `dm_messages(user_a,user_b,id)` and `mentions(user_id)`.
- **More pragmas:** `busy_timeout` and `synchronous=NORMAL`.
- **Wrap multi-step writes in transactions:** create space, message plus its mentions, and invite join (which currently races against `max_uses`).
- **Cursor pagination,** plus "load older messages" in the UI. Today you can only ever see the last 50.
- **Resync everything on WebSocket reconnect,** not just the open channel.
- **Moderation:** wire up the already-defined `delete_others_messages` permission.
- **Ops:**
  - Run the Docker container as a non-root `USER`, add a `HEALTHCHECK`, and use `npm ci`.
  - Back up nightly with `VACUUM INTO`.
  - Add a GitHub Actions workflow that runs the tests and the build.
  - Bump vite.
- **Split up `App.jsx` (943 lines, about 30 `useState`s)** using a reducer or a small store.

## Phase 2: Missing features, ranked by value ÷ effort

**Already present:** edit/delete, 8 fixed reactions, @mentions, unread/mention badges, spoilers, albums and lightbox, search, typing indicator, presence, DMs/friends, 3 role tiers with per-channel gates, voice/PTT/camera/screenshare.

| Rank | Feature | Effort |
|---|---|---|
| 1 | Markdown and code blocks with syntax highlighting | S |
| 2 | Browser notifications, unread count in the tab title and favicon, message sound | S |
| 3 | "New messages" divider and jump-to-unread | S |
| 4 | Full emoji picker with search, plus an emoji button in the composer | S |
| 5 | Drag-and-drop and paste-to-upload | S |
| 6 | Replies/quotes (`reply_to`, jump to the original) | M |
| 7 | Link previews (fetched server-side, with **SSRF protection**) | M |
| 8 | Pins, custom status, DND/invisible | S |
| 9 | Light theme and a theme picker | M |
| 10 | PWA and Web Push | M |
| 11 | Custom server emoji | M |
| 12 | `/imagine` and AI media in chat via kie.ai (see below) | M |
| 13 | Custom roles with colours and a permission matrix | L |
| 14 | Threads | L |

**The `/imagine` integration** would live in a new `server/integrations/kie.js` module plus an `imagine` gateway op. How it would work:

1. Posts come from a bot or system user (this needs adding).
2. It checks permission and a per-user quota or cost cap.
3. It posts a placeholder message.
4. It polls kie.ai for the result.
5. It downloads the result into `UPLOADS_DIR`.
6. It replaces the placeholder via `message_update`.

The key is read from the environment. In Docker, pass `KIEAI_API_KEY` through compose; never bake it into the image.

## Phase 3: UX and accessibility fixes

- **Message actions only appear on hover,** so keyboard and touch users can't reach them. Add a focusable "…" menu and a long-press menu. (`MessageList.jsx:270`)
- **Contrast fails WCAG AA:** white on `#7d6ff3` is about 3.9:1, and gray-500 on ink-700 is about 3.6:1.
- **Dialogs need** `role="dialog"`, `aria-modal`, a focus trap and Esc to close. Icon buttons need `aria-label`.
- **Create/Join server** should be a proper modal with tabs (name, icon, template) instead of the 56px inline input. (`ServerRail.jsx:145`)
- **Setup wizard:** explain the registration modes, end on "here's your invite link", and stop swallowing errors.
- **Replace `window.confirm` on delete** with an in-app confirm, or better, an undo toast.
- **Mobile has no way to see the member list.** (`MemberList.jsx:86`)
- **Keyboard shortcuts:** Ctrl+K quick switcher, Alt+↑/↓ to change channels, ↑ to edit your last message.
- **Voice stage:** a speaking ring on tiles, pin/spotlight, and fullscreen screenshare.
- **Inter is declared but never loaded,** so most users actually see Segoe UI or Roboto.

## Phase 4: New look

Concept images are in `design/logo-concepts/` and `design/hero/`.

**Recommended direction: "Gourd Lantern."** A dried gourd lit from inside, which is warm, organic, and unlike Discord.

- **Surfaces:** `#14110F` / `#1B1714` / `#221D19` / `#2C2621`, border `#3A322B`
- **Accent:** amber `#E8A33D` (hover `#F2B65A`). Dark text on amber is about 9:1, which fixes button contrast.
- **Secondary:** violet `#9B8CFF`, used for links and mentions so the purple heritage survives.
- **Other colours:** vine green `#7BC47F` for online, `#E5684F` for danger.
- **Text:** `#F3ECE4` / `#B9AEA2` / `#8C8177`.
- **Fonts:** Fraunces for display, Inter or Geist for UI, JetBrains Mono for code.

**Alternative: "Neon Calabash."** Gamer/playful: `#0E0B1A` bases, violet `#8B5CFF`, lime `#B8F34A`, pink `#FF5FA2`, with Space Grotesk.

**Logo:**
- **Lead candidate: `06-lantern-gourd`.** It's a glowing gourd whose three holes double as a typing indicator, so the logo says "chat".
- **Mascot:** `07-mascot-face` (or `01-flat-mascot`), used for empty states and stickers.
- **Next steps:** draw the chosen mark as a clean SVG, make a mono 16px variant, and test it at 16, 32 and 180px.

**Assets to generate once a direction is chosen:**

- Login hero art at 16:9 and 9:16. Regenerate `A-gourd-lantern`, which has a stray dark rectangle in the middle.
- 6–8 mascot poses: waving, sleeping, headphones, magnifier, confused, party, shushing.
- Empty-state illustrations: no servers, empty channel, no DMs.
- 12 default server-icon glyphs.
- PWA and maskable icons, a favicon with an unread dot, and an OG share image.
- A sound set to replace the sine tones in `sounds.js`: a wooden "tok" for messages, a two-note marimba for mentions, a gourd-shaker for join/leave, a gourd-drum ring.

## Suggested order

Phase 0 (security) → Phase 1 foundations → logo and theme tokens (Phase 4) → quick-win features 1–5 → Phase 3 accessibility → bigger features.
