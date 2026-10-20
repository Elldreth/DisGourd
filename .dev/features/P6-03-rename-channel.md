# P6-03 — Rename channel

- **Unit Type:** Implementation
- **Phase:** 6
- **State:** REVIEW (details confirmed by the owner, 2026-10-20)
- **Effort:** M
- **Depends on:** none (merge after P6-01; they share files)
- **Serialize with:** P6-01 (`server/routes/spaces.js`, `web/src/state/useSpaces.js`, `web/src/api.js`)
- **Requirement Source:** `design/settings-review-2026-10/REVIEW.md` discovered work ("rename a channel").

## What a rename has to touch (checked against main)
Channels have an integer id, and nearly everything points at it: messages, pins, thread follows, role overrides, imagine jobs, categories (`category_id`), and threads (`~t<rootId>` rows with `parent_id`). Those all follow a rename without any change. Only these use the **name**:
- `channels.name` itself, `UNIQUE(space_id, name)`.
- `read_state(user_id, space, channel)`, joined on `rs.channel = c.name`. It must be updated in the same transaction, the way `renameSpace` updates `read_state.space`.
- Voice rooms in memory, keyed by `[space, channel]` (`gateway/voice.js`).
- Client state keyed by name: the current channel, `channelMeta`, the saved view, unread and mention counts.
- Old `mod_log.details.channel` values are history and stay as they were.

## Scope
- **Server:** `PATCH /spaces/:name/channels/:channel` takes an optional `name`, beside `topic`, `slowmode` and `nsfw`. Same permission as the rest of that route (owner or `edit_server`, which is who can open Channel settings).
  - It's normalized and validated like creation (`normalizeChannelName` / `validateChannelName`).
  - 409 "A channel with that name already exists" when the name is taken (creation silently ignores a duplicate; a rename can't). Renaming to the same name is a no-op.
  - Threads can't be renamed (404, as today).
  - `channels.name` and `read_state.channel` are updated in one transaction.
- **Voice:** if people are in the voice channel, its room is re-keyed to the new name and `voice_state` is resent, so nobody is dropped. *(Confirmed by the owner, 2026-10-20.)*
- **Gateway:** `{type:'channel_renamed', space, channel: oldName, newName}` goes to everyone who can view the channel, followed by the usual `space_updated`. That mirrors `space_renamed`.
- **Mod log:** a `channel_rename` entry `{from, to}`, shown in Server settings › Mod log as "renamed #from to #to" (with a filter option). *(Confirmed by the owner, 2026-10-20.)*
- **Client:**
  - Channel settings › Overview gets a "Name" field at the top (60 characters, previewed in its normalized form, e.g. "Game Night" → `game-night`). It's saved with the existing footer "Save".
  - On `channel_renamed`, any client that's in the channel moves to the new name. The view state, `channelMeta`, and unread and mention counts carry over.

## Acceptance criteria
- [x] AC-1: a rename returns 200 with the new name. `GET /spaces/:name/channels` lists the new name, not the old one. Messages, pins, threads (their `parent_id`), the category, and role overrides are all still attached.
- [x] AC-2: a name taken by another channel gets 409. An empty or invalid name gets 400. Without `edit_server` you get 403, and renaming a thread gets 404.
- [x] AC-3: read state carries over: a user with unread messages in the old name still has the same unread count under the new name.
- [x] AC-4: viewers get `channel_renamed` with the old and new names. Members who can't see the channel don't.
- [x] AC-5: someone in the voice channel stays connected, and `voice_state` shows the new name.
- [x] AC-6: the mod log has a `channel_rename` entry.
- [x] AC-7: the Overview tab shows the Name field. Saving a changed name calls the API; an unchanged name doesn't. When the event arrives, a client viewing the old channel switches to the new one.
- [x] AC-8: the server tests are in `server/tests/rename-channel.test.js`, and web tests cover AC-7. The existing suites stay green.
- [x] AC-9: a sandbox check: sandy renames a channel while bob is viewing it in a second tab, and bob moves along. Screenshots.

## Expected Areas of Change
`server/routes/spaces.js`, `server/db/index.js` (`renameChannel`), `server/gateway/voice.js` (re-key a room), `web/src/api.js`, `web/src/state/useSpaces.js` (or wherever `channel_deleted` is handled), `web/src/components/ChannelSettingsDialog.jsx`, `web/src/components/server-settings/ModLogSection.jsx`, plus tests.

## Working Set / Blast Radius
About 8 files. The name-keyed client state is the risky part, so the web test drives the event.

## Testing Strategy
Jest plus ws, Vitest, and a sandbox with two tabs.

## Out of Scope
Renaming categories, moving channels between servers, and putting channel ids in URLs.

## Starting Baseline
Revision: `d7f159a` (main after #165). Rebased onto `d34878b` (main after #166 and #167) before the PR. No migration is needed.

## Implementation notes
- **Server:**
  - `db.renameChannel` updates `channels.name` and `read_state.channel` in one transaction; threads are refused.
  - The PATCH route applies the name **last**, because the other fields use the old name. It then logs `channel_rename {from, to}`, sends `channel_renamed` to the viewers of the new name, and calls `voiceRenameChannel`.
  - `voiceRenameChannel` re-keys the room, points each member socket at the new key, and resends `voice_state`. `channel_renamed` goes out first, so clients know the new name before the voice state arrives.
- **Client:**
  - **`useSpaces`:** renames the channel in the local server list and switches the open channel *in the same update* (`renameChannelIn`, in `util.js`), then reloads. The first sandbox run found a bug here, fixed in this branch: switching only the open channel let the "channel gone, go to the first one" effect send everyone to #general (`design/p6-actions/shots/p6-03-bug-jumped-to-general.jpg`). `useSpaces.rename.test.js` reproduces it; it fails without the fix.
  - **`useChannelMessages`:** moves unread counts, mentions and the last-read position to the new key, and points threads at the new parent name (in that server only).
  - **`useVoiceCall` / `voice.js`:** follow the call's room, via `renameRoom`.
  - **`App`:** keeps an open thread's parent name in step.
  - **Mod log:** gets a "Channel renames" filter and the line "renamed #from to #to".
- **Settings › Overview:** a Name field (60 characters). When the typed name will be stored differently, it shows "Saved as #game-night: lowercase, with dashes for spaces."

## Discovered Work (not done here)
- **Renaming a server doesn't move its voice rooms.** `renameSpace` updates the database, but `voiceRooms` (in `gateway/voice.js`) stays keyed by the old server name, so a call in progress keeps the old one. It's the same fix as `voiceRenameChannel`, applied per server.
- **Slow-mode countdowns are keyed by channel name on the client** (`cooldownKey(space, channel)`). A countdown running at the moment of a rename is forgotten. The server still enforces slow mode, so this is cosmetic.

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | Jest `rename-channel.test.js` | 200 with `{name: 'game-night'}` (from "  Game Night "). The same row id and category. The list shows the new name only. History, the pin, the thread (`parent_id`) and the role override are all intact. In the sandbox, #history kept its messages and its pinned message (`p6-03-renamer-moved.jpg`). |
| AC-2 | Verified | Jest | 409 for a taken name ("Other" normalizes to `other`). 400 for empty, longer than 60 characters, or not a string. 403 for a member, 404 for an unknown channel. Threads go through the existing 404. |
| AC-3 | Verified | Jest | One unread message for admin under `general` became one under `game-night`, and none under the old name. |
| AC-4 | Verified | Jest | Viewers get `channel_renamed {space, channel, newName}` before `space_updated`. A member who can't see #staff isn't told. |
| AC-5 | Verified | Jest + sandbox (listen-only) | In Jest, the member stays in the room, `voice_state` names `hangout`, there's no `voice_ended`, a new connection sees the room under the new name, and mute still reaches it. In the sandbox, bob, connected listen-only to lounge, stayed connected as "hangout · Tx Check" (`p6-03-voice-kept.jpg`). |
| AC-6 | Verified | Jest + Vitest + sandbox | A `channel_rename` entry with from/to. Same-name saves aren't logged. The mod log shows "sandy renamed #lounge to #hangout" (`p6-03-mod-log.jpg`). |
| AC-7 | Verified | Vitest `RenameChannel.test.jsx`, `useSpaces.rename.test.js` + sandbox | Name field shown, and the "Saved as" hint (`p6-03-name-field.jpg`). An unchanged name isn't sent. A changed name is renamed after the topic. Empty names are refused before saving, and server errors are shown. Counts and thread parents move. The open channel follows (also with the list reload delayed); someone elsewhere stays put. Sandbox: sandy renamed #testing-notes to #history from the dialog, and both her tab and bob's moved to #history (`p6-03-renamer-moved.jpg`, `p6-03-viewer-moved.jpg`). After the rebase: #made-offline → #offline-notes moved bob too (`p6-03-after-rebase.jpg`). |
| AC-8 | Verified | Jest, Vitest, Vite | After the rebase onto #166 and #167: server 45 suites / 415 tests, web 94 files / 741 tests, all green. `vite build` clean. |
| AC-9 | Verified | Sandbox (a fresh copy of the sandbox DB on :3007, this branch's code) | As in AC-5 to AC-7; screenshots in `design/p6-actions/shots/p6-03-*`. No console errors. |
