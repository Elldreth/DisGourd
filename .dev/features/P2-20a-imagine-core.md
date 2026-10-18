# P2-20a — Imagine core: bot user, settings, permission, limits, job runner, fake engine

- **Unit Type:** Implementation (child of P2-20)
- **Phase:** 2
- **State:** COMPLETE (merged #121)
- **Effort:** M
- **Depends on:** P2-21 (roles), P1-05
- **Starting baseline:** main at 560106f (#120 merged)
- **Serialize with:** `server/db/migrations.js`, `server/db/index.js`, `server/gateway/router.js`, `server/routes/admin.js`, `server/routes/spaces.js`

## Why
Everything `/imagine` needs that doesn't depend on a real engine: the bot that posts results, where settings live, who may use it, the limits, the job queue, and a fake engine so all of it is tested before ComfyUI (P2-20b) or kie.ai (P2-20c) exist. No user-facing screen yet (P2-20d).

## Scope
- **Migration v13:**
  - `users.is_bot`;
  - `channels.nsfw` (the 18+ flag);
  - `spaces.imagine_enabled` and `spaces.imagine_daily_limit`;
  - an `imagine_jobs` table: id, user, space, channel, message, engine, model, prompt, shape, quality, permissive, cost, status `queued | running | done | failed`, error, and created / started / finished times.
- **Bot user:**
  - `db.ensureImagineBot()` at start-up creates **Imagine** (or "Imagine-bot" if that username is taken). It has `is_bot = 1` and an impossible password hash.
  - `/login` refuses bot accounts outright.
  - It posts with `postAsBot` and edits with `updateBotMessage(id, content, attachments)`.
  - `message_update` frames now carry `attachments`, and the app's message hook applies them.
- **Permission:** a new `generate_images` role action ("Generate images").
  - Its tier default is 2, so newly made servers seed it onto Admin.
  - Existing servers' roles don't get it; only owners have it until someone ticks it on the Roles screen.
- **Instance settings** (site admins): `GET` / `PUT /admin/imagine`.
  - **The engine list:** `fake` is available only when `IMAGINE_FAKE_ENGINE=1` (tests, sandbox); `comfyui` and `kie` arrive in b and c.
  - **Defaults and caps:** the default engine, the permissive switch (off by default), the default daily limit per user (20) and a hard daily ceiling.
  - **Engine config is opaque here:** each engine module validates and masks its own (b and c add theirs).
- **Server settings:**
  - `PATCH /spaces/:s/imagine { enabled, dailyLimit }` needs `edit_server`; the limit is capped at the instance ceiling.
  - `PATCH /spaces/:s/channels/:c { nsfw }` needs the manager right; a thread follows its parent.
  - `GET /spaces` adds `imagine: { enabled, canUse, dailyLimit, usedToday, engines: [{ id, name }] }` and `channelMeta[c].nsfw`.
- **The `imagine` gateway op** `{ space, channel, prompt, shape, quality, engine? }`. **Checks, in order:**
  1. a member who can view and post in the text channel or thread;
  2. the server has it on, and the instance has an engine;
  3. they hold `generate_images`;
  4. prompt 1–1,000 characters; shape and quality valid; the engine is enabled;
  5. their count in the last 24 hours is below the server's limit;
  6. the always-refused check passes.

  **On success:** a job row, a bot placeholder ("🎨 Imagining for **alice**… 2nd in line"), and an `imagine_queued { jobId, messageId }` frame to the requester. **On failure:** `{ type: 'error', op: 'imagine', code, error }`.
- **Job runner** (`server/imagine/runner.js`):
  - one job at a time per engine, in arrival order;
  - placeholders show their queue position and "generating…";
  - a 5-minute timeout (an AbortController given to the engine);
  - images saved into `UPLOADS_DIR/<random>/imagine-<n>.png` and attached through `updateBotMessage`;
  - failures replace the placeholder with "⚠️ Couldn't imagine that: <reason>";
  - at start-up, jobs left `queued` or `running` by a restart are marked failed and their messages updated.
- **Permissive mode:** on only when the channel (or a thread's parent) is 18+ **and** the instance allows it. The engine is told `permissive: true`; everywhere else, `false`.
- **The always-refused check** (`server/imagine/promptCheck.js`): prompts combining sexual terms with words for minors are refused in every channel. **Honest scope:** a word-list check catches the plain cases, not every phrasing; the engines' own filters and the instance owner's responsibility remain. Sexual images of real, named people can't be detected by words, so they're stated in the admin page's notice (P2-20d) rather than enforced here.
- **`fake` engine** (`server/imagine/engines/fake.js`): returns a small solid-colour PNG after an optional delay; a prompt containing `[fail]` makes it fail, `[slow]` makes it wait (tests only).

## Non-goals
The app's `/imagine` panel, settings screens, BOT badge (P2-20d); ComfyUI and kie.ai (b, c); DMs (servers only for now); Retry / Variations.

## Acceptance criteria
- [x] `imagine.test.js` (fake engine), covering:
  - the bot can't log in;
  - each refusal in the op (not a member, can't post, server off, no engine, no permission, bad prompt / shape / quality, over the daily limit, the always-refused check), each with its code;
  - a good request makes a placeholder visible only to channel viewers, then the same message gains an image attachment (the file exists under `UPLOADS_DIR`);
  - queue positions while a slow job runs;
  - `[fail]` turns the placeholder into the error;
  - the timeout;
  - permissive only in an 18+ channel with the instance switch on (and in a thread under one);
  - restart recovery;
  - `GET /spaces` carries `imagine` and `nsfw`.
- [x] Settings: `/admin/imagine` is site-admins only, round-trips, and refuses an unknown engine; the server toggle needs `edit_server` and caps the limit; the channel 18+ switch needs the manager right; `generate_images` shows up in a new server's Admin role.
- [x] The app applies `attachments` from `message_update` (hook test); `PERMISSION_ACTIONS` includes "Generate images".
- [x] All existing suites pass (the roles equivalence test still agrees with the tier maths).
- [x] Sandbox (sandbox DB, fake engine via `IMAGINE_FAKE_ENGINE=1`): an `imagine` op sent as sandy shows "🎨 Imagining…" in bob's open tab, then the image, with no reload.

## Expected Areas of Change
`server/db/migrations.js`, `server/db/index.js`, `server/imagine/` (new: `index.js`, `runner.js`, `promptCheck.js`, `engines/fake.js`), `server/gateway/router.js`, `server/routes/admin.js`, `server/routes/spaces.js`, `server/routes/auth.js`, `server/server.js` (start-up), tests; `web/src/state/useChannelMessages.js`, `web/src/util.js`.

## Working Set / Blast Radius
~12 server files and 2 web files. Nothing changes for anyone until a site admin enables an engine, and only `fake` exists in this unit.

## Implementation notes
- **Engine interface:** `id`, `name`, `available()`, `validateConfig(input, prev)` (returns the stored config or `{ error }`), `publicConfig(cfg)` (masked), `costOf(request, cfg)`, and `generate(request, cfg, { permissive, signal })`. `generate` returns `{ model, cost?, images: [{ buffer, contentType }] }` or throws; `err.code === 'REFUSED'` reads as "the engine refused this prompt". P2-20b and c add `comfyui` and `kie` to `ENGINES` in `server/imagine/index.js`.
- **Settings** live in `site_settings` under the key `imagine` (JSON). `GET /spaces` is decorated in the route (`imagine.decorateSpaces`), so `db` stays independent of the imagine module.
- **The bot:** a `users` row with `is_bot = 1` and the password hash `!`. `countUsers` and the start-up "promote the first account" both skip bots, so a fresh instance's first person is still the site admin. Bot messages go through `storeMessage` (no mention rows, so a prompt's `@names` don't notify). Edits use `updateBotMessage`, which only touches the bot's own messages.
- **Refusals** are one frame: `{ type: 'error', op: 'imagine', code, error }`. The codes are `NOT_ALLOWED`, `DISABLED`, `NO_ENGINE`, `NO_PERMISSION`, `BAD_PROMPT`, `BAD_OPTION`, `LIMIT` and `REFUSED`.
- **The daily count** is rolling 24 hours across the instance (failures excluded), compared with the server's limit (its own, or the instance default, capped by the ceiling).
- **The always-refused check:** "girl", "boy" and "young" alone aren't treated as minors (adults are described that way). Phrases like "little girl", the words for children and teens, and ages under 18 are.

## Discovered work
- **For P2-20d:** when the image arrives (a `message_update` with attachments), the message list doesn't keep itself scrolled to the bottom, so the image sits just below view until you scroll. Seen in the sandbox check; it belongs with the chat experience.
- One full server run showed the image-proxy suite failing; a rerun and the suite on its own passed. It didn't recur in three later full runs, so it looks like a timing flake under parallel load, unrelated to this change. Watch it.

## Evidence (2026-10-18)
| Acceptance criterion | Evidence |
|---|---|
| Core behaviour | `imagine.test.js` (10): the bot is `Imagine`, `is_bot`, not site admin; its login is 401; `countUsers` is 4 with it present. Refusals in order: NOT_ALLOWED (outsider), NO_PERMISSION (member without the role), BAD_PROMPT (blank, 1,001 characters), BAD_OPTION (shape, quality, unknown engine), REFUSED ("nude 12 year old"), DISABLED, NO_ENGINE, with no job stored. A request posts a bot placeholder seen by a channel viewer and not by an outsider; the same message then gets the PNG (the file exists and starts with PNG), the job is `done`, and history shows the attachment. A `[slow]` job makes the next one read "2nd in line" and then "generating" only after the first is done. `[fail]` and `[hang]` (600 ms timeout) end as the error text. Permissive was seen as `false, false, false, true, true` for: plain channel; 18+ with the instance switch off; plain with it on; 18+ with it on; a thread under the 18+ channel. LIMIT once the count reaches the server's limit, which `GET /spaces` reports. Restart recovery marks the job failed and rewrites the placeholder |
| Settings | Same file: `/admin/imagine` is 403 for a non-admin; an unknown engine is 400; a limit over the ceiling is 400; the values round-trip. The server toggle is 403 without `edit_server` and 400 over the ceiling. The channel 18+ switch is 403 for a non-manager and 400 for a non-boolean. `GET /spaces` carries `imagine` and `channelMeta[].nsfw`. A new server's Admin role includes `generate_images` |
| App | `useChannelMessages.test.js`: an update with attachments sets them (and `attachment`); a later edit without them keeps them. `PERMISSION_ACTIONS` gains "Generate images (/imagine)". Web: 64 files, 563 tests |
| Existing suites | Server: 31 suites, 290 tests. Two expectations changed for the additions themselves: the seeded Admin role's list now includes `generate_images` (`roles-schema.test.js`), and `channelMeta` now has `nsfw: false` (`api.test.js`). The migrations test lists `idx_imagine_jobs_user` |
| Sandbox (sandbox DB, `IMAGINE_FAKE_ENGINE=1`, 2.5 s delay) | As sandy through the API: the fake engine on, `/imagine` on for Tx Check (`GET /spaces` imagine: enabled, canUse, limit 20, used 0). With bob's tab open on #general, an `imagine` op as sandy went "1st in line" → "generating" → "🎨 **sandy** imagined: a gourd wearing a top hat" with `/uploads/…/imagine-1.png`. Bob's tab showed the Imagine bot's message and the purple test image without a reload |
