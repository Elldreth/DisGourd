# P3-26c — Timeout

- **Unit Type:** Implementation (child of P3-26)
- **Phase:** 3
- **State:** COMPLETE (merged #154)
- **Starting baseline:** main at b0da6f8 (#153 merged)
- **Effort:** M
- **Added by the user (2026-10-19):** "Also end a banned or removed person's voice session while you're in the voice code" (P3-26b Discovered Work).
- **Depends on:** P3-26a

## Scope
- **The `timeout_members` permission** (Admin by default), shown as "Time out members".
- **Migration:** `space_members.timeout_until INTEGER`, `timeout_reason TEXT`.
- **Routes:**
  - **`PUT /spaces/:s/members/:user/timeout { minutes: 5 | 60 | 1440 | 10080, reason? }`:** rank-checked; logged.
  - **`DELETE /spaces/:s/members/:user/timeout`:** removes it; logged.
- **The member list / GET /spaces** carry `timedOutUntil`.
- **While timed out (until > now):** these are refused with `TIMED_OUT` (+ until):
  - sending messages (channels, threads), editing, reacting;
  - creating threads, /imagine;
  - speaking in voice (they join muted and can't unmute).

  Reading, DMs and listening are unaffected. Lifting is automatic, by comparing against now.
- **App:**
  - **The member menu:** "Time out…" with a duration and reason, and "Remove timeout".
  - **A ⏱** next to the name, with a tooltip of the end time.
  - **The composer** is replaced by "You're timed out in this server until 4:30 PM" (+ reason), and comes back when it ends.

- **Added: calls end on ban / removal.** The server ends the person's voice session in that server and sends them `voice_ended { space, channel, reason: 'banned' | 'removed' }`. Their app leaves the call and says "Your call in #lounge ended: you were banned from X."

## As built
- **Migration v22** adds the two columns and gives `timeout_members` to each existing seeded Admin role (as v21 did for bans).
  - **Don't change v22 before it merges.** On 2026-10-19 an ad-hoc `require` during this work ran v20–v22 on the developer's real `server/db/disgourd.db` (it's at version 22 now), so v22 must stay as written.
- **GET /spaces** carries my own `timeout: { until, reason } | null` per server. Members carry `timedOutUntil`.
- **Refusals** go out as `{ type: 'error', op, code: 'TIMED_OUT', until }`, for `message`, `edit`, `react` and `imagine`. Thread creation returns 403 `{ code: 'TIMED_OUT' }`. Typing isn't relayed.
- **The kick route** now matches only `DELETE /members/:user`. Before, it also caught `DELETE /members/:user/timeout` and removed the person.
- **Voice:**
  - Joining while timed out sets `forcedMute: true` in `voice_peers`, and the server keeps them muted whatever `voice_mute` says.
  - Timed out mid-call: `voice_forced_mute { on: true }` mutes them; removal sends `{ on: false }`, and they stay muted until they unmute.
  - The client also turns the mic track off. Media is peer-to-peer, so a modified client could still send audio; the shown state stays muted.
- **App:**
  - "Time out…" (5 minutes / 1 hour / 1 day / 1 week, with a reason) or "Remove timeout" in the member menu.
  - A red clock next to timed-out names, with "Timed out until …".
  - The message box (channel and thread) becomes "You're timed out in this server until 5:27 PM" plus the reason, with the day when it isn't today. `useActiveTimeout` brings the box back when the timeout ends.
  - While muted by a timeout, the mic button is disabled with a tooltip.
  - The log reads "ada timed out bob for 1 hour" / "ada removed bob's timeout", with filters.

## Acceptance criteria
- [x] Server: set / remove with rank rules; every guarded path refused while active and allowed after (clock faked); logged.
- [x] Web: the dialog, the ⏱, the composer notice and its return.
- [x] Sandbox: sandy times bob out for 5 minutes; bob can't post or react and sees the notice; remove → he can post.
- [x] (Added) A removed or banned person's call in that server ends, with a reason.

## Evidence (2026-10-19)
| Acceptance criterion | Evidence |
|---|---|
| Server | `timeouts.test.js` (9):<br>• **Refusals:** a member gets 403; yourself 400; another admin or the owner 403; nobody 404; 7 minutes 400.<br>• **Setting one:** 60 minutes with " cool off " → until ≥ now + 1 h, `timed_out` with the trimmed reason, members_changed, `timedOutUntil` on them only, my own `timeout` in GET /spaces, and logged with `{ minutes, until }`.<br>• **While active:** message, edit, react and imagine each get a TIMED_OUT error with `until`; nothing is stored or reacted; thread creation 403 with TIMED_OUT; reading is 200.<br>• **After it ends** (end time set in the past): posting works, no error, `timeout: null`.<br>• **Remove:** 200, `timed_out` with until null, logged, then 404.<br>• **Voice:** a forced mute mid-call; unmute ignored; rejoining starts muted; after removal they can unmute. Removing and banning someone in the lounge each send `voice_ended` with the right reason and drop them from `voice_state`.<br>• **Permission:** with it off for Admin → 403.<br>`db-migrations.test.js`: v22 columns and the Admin permission (the v21 test is pinned to ≤ 21). `roles-schema.test.js` expects `timeout_members`. Server suites: 40 files, 390 |
| Web | `Timeouts.test.jsx` (6): the clock on cara only, labelled with the end time; Time out… needs the permission, isn't offered for the owner or someone already timed out, and Remove timeout calls `onRemoveTimeout('cara')`; the dialog defaults to 1 hour and sends `('bob', { minutes: 1440, reason: 'cool off' })`, closes, and shows a refusal; the notice text and reason, with the day only for another day; `useActiveTimeout` → the timeout, then null after the fake clock passes it; the log sentences. `voice.test.js` (2 new): a forced mute sends voice_mute and blocks unmute (and undeafen), and after it lifts you can unmute; `endCall` leaves, closes links and sets the notice, and does nothing outside a call. Web suites: 79 files, 669; `vite build` clean |
| Sandbox (:3005, restarted on this branch; sandy and bob in two tabs) | Sandy → bob → Time out… → 5 minutes, "Cool off for a bit" → the clock appeared by bob's name. Bob's Tx Check #general showed "You're timed out in this server until 05:27 PM. Reason: Cool off for a bit" instead of the message box. A script as bob: message and react → `TIMED_OUT` with until; nothing stored. Sandy → bob → Remove timeout → bob's message box came back without a reload, and the clock went. Voice: cara joined the lounge (forcedMute false); sandy removed her → cara got `voice_ended { channel: 'lounge', reason: 'removed' }`; she rejoined with an invite. The automatic end at the end time was checked by tests, not by waiting live |
