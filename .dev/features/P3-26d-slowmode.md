# P3-26d — Slow mode

- **Unit Type:** Implementation (child of P3-26)
- **Phase:** 3
- **State:** COMPLETE (merged #155)
- **Starting baseline:** main at dc6e706 (#154 merged)
- **Effort:** S–M
- **Depends on:** P3-26a

## Scope
- **Migration:** `channels.slowmode_seconds INTEGER NOT NULL DEFAULT 0`.
- **Channel settings:** "Slow mode" (Off / 5 s / 30 s / 1 min / 5 min) on text channels, via PATCH `/spaces/:s/channels/:c { slowmode }`; logged; `space_updated`.
- **Gateway:** a post less than N seconds after that person's last post in the channel is refused with `SLOWMODE { retryAfter }`. Exempt: delete_others_messages / edit_server holders and the owner. Threads inherit their parent's setting.
- **channelMeta** carries `slowmode`.
- **The composer:** after sending in a slow-mode channel, it shows "Slow mode: 23 s" and disables Send until the countdown ends; a refusal syncs it.

## As built
- **Migration v23** adds `channels.slowmode_seconds`. (v20–v22 are already on the developer's real DB; see P3-26c.)
- **Settings:** PATCH accepts `slowmode` of 0, 5, 30, 60 or 300, on text channels only. A change is logged as `slowmode { channel, seconds }`; saving the same value isn't logged again.
- **Gateway:**
  - The wait counts from the person's latest stored message in that channel or thread (`MAX(created_at)`), so it survives restarts.
  - A thread uses its parent's setting.
  - The refusal is `{ type: 'error', op: 'message', code: 'SLOWMODE', space, channel, retryAfter }`.
  - Exempt: the owner, and anyone with "Delete others' messages" or "Edit server".
  - /imagine isn't limited by slow mode.
- **App:**
  - `slowmode.js` keeps one countdown per channel or thread, shared by the panels. Sending starts it; a SLOWMODE refusal (for example, from another tab) resets it from `retryAfter` and shows a toast saying the message wasn't sent.
  - The Send button becomes a disabled "Slow mode: 23 s" with a clock. Enter does nothing, and the text stays in the box.
  - Exempt people get no countdown.
  - Channel settings has a "Slow mode" choice (text channels).
  - The log reads "sandy set slow mode in #general to 30 seconds" / "sandy turned off slow mode in #general".

## Acceptance criteria
- [x] Server: the setting (managers only), refusal with retryAfter, moderators exempt, threads inherit, logged.
- [x] Web: the setting in channel settings; the composer countdown.
- [x] Sandbox: 30 s slow mode; bob posts twice and the second is refused with a countdown; sandy is exempt.

## Evidence (2026-10-19)
| Acceptance criterion | Evidence |
|---|---|
| Server | `slowmode.test.js` (5):<br>• **Setting:** a member gets 403; 7 s gives 400; a voice channel gives 400; admin 30 → `{ slowmode: 30 }`, space_updated, `channelMeta.general.slowmode` 30 (others 0), and logged once (saving 30 again isn't logged).<br>• **Refusal:** a member's second post is refused with SLOWMODE, channel general and `retryAfter` 26–30; another channel is unaffected.<br>• **After the wait** (last post moved 31 s back): posting works.<br>• **Exempt:** the admin and the owner each post twice.<br>• **Threads:** a thread under #general refuses the second post; with the parent off, the thread and #general are free.<br>`api.test.js` now expects `slowmode: 0` in channelMeta. Server suites: 41 files, 395 |
| Web | `Slowmode.test.jsx` (5): countdowns per channel in whole seconds and running out; `useCooldown` re-renders on start and each second; the composer with `cooldown` shows "Slow mode: 23 seconds" disabled, Enter doesn't send and the text stays, and with 0 it's "Send" again; channel settings shows 30, doesn't save an unchanged value, saves 0 when changed, and isn't offered for voice; the log sentences. Web suites: 80 files, 674; `vite build` clean |
| Sandbox (:3005, restarted on this branch; sandy and bob in two tabs) | Sandy → #general settings → Slow mode "30 seconds" → Save. Bob sent "first message under slow mode"; the button turned into "Slow mode: 28 s" and his second message stayed in the box. A script as bob was refused with `SLOWMODE, retryAfter: 16`; sandy (owner) posted twice with no error. After the countdown, Send came back and bob's waiting text went through. Slow mode was then turned off; the log shows both changes. The refusal toast was checked through code review, not live |
