# P2-18b — Web Push for mentions and DMs while the app is closed

- **Unit Type:** Implementation (child of P2-18)
- **Phase:** 2
- **State:** REVIEW
- **Effort:** M
- **Depends on:** P2-18a (service worker), P2-04 (notification settings), P2-14 (Do Not Disturb), P1-01, P1-05
- **Serialize with:** `server/gateway/chat.js`, `server/gateway/dm.js`, `web/sw.js`, `web/src/pwa.js`, `NotificationSettings.jsx`, `App.jsx`

## Decisions (from the P2-18 container, user 2026-10-18)
iOS needs Add to Home Screen first (acceptable; the app says so). Previews on by default, with an opt-out.

## Scope
- **Keys:** VAPID keys are generated once and kept in `.vapid.json` next to the JWT secret (the Docker `/config` volume); `VAPID_CONTACT` (optional) sets the contact address. Tests use an ephemeral pair.
- **Storage:** migration 11, `push_subscriptions(id, user_id → users CASCADE, endpoint UNIQUE, p256dh, auth, previews, created_at)`.
- **API** (signed in): `GET /push/vapid-key` → `{ key }`; `POST /push/subscriptions { subscription, previews }` saves or updates the browser's subscription; `DELETE /push/subscriptions { endpoint }` removes it.
- **When a push is sent:** only for an **@mention** in a channel or thread, or a **DM**, and only when the person has **no open socket** and isn't in **Do Not Disturb**. Title "author in #channel · Server" (threads: "author in Thread (#channel) · Server"; DMs: the sender). Body: the first 100 characters of the text, or nothing when that subscription has previews off. A dead subscription (404/410 from the push service) is deleted.
- **In the worker:** `push` shows the notification; clicking it focuses an open DisGourd tab and asks it to open the place, or opens the app at `/?open=…`, which the app reads once and clears (like invite links).
- **Settings → Notifications:** "When DisGourd is closed": a switch for push (asks for permission, subscribes, saves) and "Include message text" (re-saves the subscription with the choice). Hints when the browser can't do push, and on iPhone when the app isn't on the Home Screen yet.
- Not here: push for every message (the "All" level stays a desktop-notification thing), push for followed-thread replies without a mention.

## Acceptance criteria
- [x] Server tests (`push.test.js`, `web-push` mocked): the key endpoint; save, update and delete a subscription; a mention pushes to a person with no socket (title, body, data) and not to one with a socket, nor in DND; previews off sends no body; a DM pushes; a reply-mention pushes; a 410 removes the subscription; the sender never gets their own push.
- [x] Web tests: the worker's `push` handler shows a notification from the payload and `notificationclick` focuses or opens the app; `subscribeToPush` / `unsubscribeFromPush` call the API with the subscription; the settings switch subscribes and the previews switch re-saves; `?open=` is read once and cleared.
- [x] Sandbox: subscribing from Settings stores a row; with the tab closed (no socket) a mention from another user calls the push service (observed in the server log, since the browser pane's push service is unavailable); with the tab open nothing is sent.
- [x] Both suites pass; `npm audit` clean after adding `web-push`.

## Expected Areas of Change
`server/push.js` (new), `server/routes/push.js` (new), `server/routes/index.js`, `server/db/migrations.js`, `server/db/index.js`, `server/gateway/chat.js`, `server/gateway/dm.js`, `server/package.json`, `.gitignore`, `web/sw.js`, `web/src/pwa.js`, `web/src/api.js`, `web/src/App.jsx`, `NotificationSettings.jsx`, `web/vite.config.js` (dev proxy), README (env), tests.

## Working Set / Blast Radius
~15 files, each small; the sending rule is one function (`notifyIfAway`) called from two places.

## Implementation notes
- `server/push.js` loads or generates the VAPID pair (`.vapid.json` next to the JWT secret; ephemeral under test or with an in-memory DB), configures `web-push`, and exposes `notifyIfAway(userId, { title, body, data })` and `preview(content, attachments)` (markdown markers and spoilers out, 100 characters). It sends only when `userClients[userId]` is empty and presence isn't `dnd`; 404/410 from the push service deletes that endpoint.
- `storeMessageWithMentions` now also returns `mentionedIds`; `chat.js` pushes to each mentioned id except the author, with the thread form of the title when in a thread; `dm.js` pushes to the recipient with the sender as the title.
- Routes live in `routes/push.js` (`GET /push/vapid-key`, `POST`/`DELETE /push/subscriptions`), registered last in `routes/index.js`; the dev proxy in `vite.config.js` forwards `/push`.
- The worker's `push` handler tags notifications per conversation (`dm:<user>` or `ch:<space>:<channel>`) so a newer one replaces the older; `notificationclick` posts `{ type: 'OPEN', data }` to an open tab or opens `/?open=<json>`. `pwa.js` gained `pushSupport`, `subscribeToPush`, `unsubscribeFromPush`, `getPushSubscription`, `onOpenRequest` and `readOpenRequest` (the `?open=` is read once and removed, like invite links); App routes an open request to a DM, a channel or a thread.
- Settings keep the previews choice in `localStorage` (`disgourd.pushPreviews`) for the switch; the server stores it per subscription.

## Evidence (2026-10-18)
| Acceptance criterion | Evidence |
|---|---|
| Server: endpoints, rules, previews, DMs, reply-mentions, dead subscriptions | `server/tests/push.test.js` (6, `web-push` mocked): 401 without a token; the key; a bad subscription 400; save, update in place, delete (404 for an unknown endpoint); a mention pushes to two away members with title `ann in #general · Pushville`, the cleaned preview and `data { space, channel }`, not to the sender; nothing with a socket open, in DND, or without a mention; previews off drops the body; a DM pushes with the sender as the title and `data { dm }`; a reply pushes to the original's author; a 410 removes the subscription. Suite: 27 suites, 258 tests; the migrations test lists `idx_push_user` |
| Web: subscribe / unsubscribe / hints / open requests | `pwa.push.test.js` (6): key decoding; subscribe asks permission, subscribes with the server key and saves with the previews choice; an existing subscription is re-saved without a new subscribe; denied permission is a readable error; unsubscribe removes it on the server and in the browser; the iPhone-in-browser hint; `?open=` read once and removed, and OPEN messages from the worker |
| Web: the worker | `sw.test.js` (+2): a push shows a notification with the body, icon, per-conversation tag and data; a click focuses an open tab with an OPEN message, or opens `/?open=…` |
| Web: settings | `NotificationSettings.test.jsx` (+1): the push switch subscribes with the previews choice, the text switch re-saves with it (and remembers it), turning push off unsubscribes. Suite: 62 files, 529 tests; `vite build` clean |
| Sandbox (:3005, sandbox DB only) | The sandbox DB upgraded to `user_version` 11 and `.vapid.json` was generated next to it (log: "Generated VAPID keys and saved them to …"). cara (a member of "Tx Check") saved a subscription with a stand-in endpoint; sandy mentioned @cara over the gateway while cara had no socket: the server attempted exactly one push (log: "Could not send a notification: The subscription p256dh value should be 65 bytes long", the stand-in key); with cara's socket open a second mention produced no attempt; DELETE removed the subscription. In the browser pane (where notifications are blocked), Settings → Notifications showed the new section, and the push switch reported "Notifications are blocked for this site" and stayed off; the pane can't reach a real push service, so a real device wasn't exercised here. No console errors |
