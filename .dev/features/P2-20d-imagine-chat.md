# P2-20d — `/imagine` in chat: the panel, server and 18+ switches, bot badge

- **Unit Type:** Implementation (child of P2-20)
- **Phase:** 2
- **State:** COMPLETE (merged #124)
- **Effort:** M
- **Depends on:** P2-20a (op, runner), P2-20b (a real engine and the instance settings)
- **Starting baseline:** main at ffefd85 (#122 and #123 merged)
- **Serialize with:** `Composer.jsx`, `ChatPanel.jsx`, `ThreadPanel.jsx`, `MessageList.jsx`, `ChannelList.jsx`, `ChannelSettingsDialog.jsx`, `App.jsx`, `useSpaces.js`

## Why
Everything behind `/imagine` works, but nobody can use it from the app yet: there's no way to type it in chat, a server owner can't switch it on, and nobody can mark a channel 18+.

## Scope
- **Typing it** (`Composer`):
  - Typing `/` in an empty box suggests **/imagine — generate an image** (when the server has it); picking it fills `/imagine `.
  - While the text starts with `/imagine`, a small panel above the box shows:
    - shape chips (Square / Portrait / Landscape / Wide);
    - quality chips (Draft / Standard / High);
    - the engine choice, only when more than one is on;
    - "N left today".
  - Enter sends the `imagine` op instead of a message. The box clears once the server accepts it.
  - A refusal shows inline (off here, no permission, limit reached, the always-refused check…) and keeps the text.
  - If `/imagine` can't be used here, the panel says why, and Enter doesn't post the text as a message.
  - It works in channels and in the thread panel.
- **The app's side of the op:** `useImagine` sends the frame and resolves on `imagine_queued`, or rejects on the `error` frame for `op: 'imagine'`, matched in order. After a request the server list reloads, so "left today" stays right.
- **Server owners** (server menu → **Image generation**, for those with `edit_server`):
  - a small dialog with "Allow /imagine in this server", and a daily limit per person (blank = the instance default, capped by the ceiling);
  - a line pointing to the **Generate images** permission on the Roles screen;
  - when the instance has no engine, it says so (and that a site admin sets one up under Settings → Image generation).
  - `GET /spaces` gains `imagine.ownLimit` (the server's own limit, or null).
- **18+ channels:** Channel settings gain **Age-restricted (18+)** for text channels, saved with the dialog's Save. The channel list shows a small "18+" tag on those channels.
- **Bot messages:**
  - Messages from the Imagine bot show a **BOT** badge by the name.
  - History marks them too: `MESSAGE_SELECT` returns `bot` (from `users.is_bot`), matching the live frame's `bot: true`.
- **Scrolling:** when an image in the newest messages finishes loading (a generated one arriving, or any slow image), the list stays at the bottom if you were there. This fixes the P2-20a discovered work.

## Non-goals
kie.ai (P2-20c); Retry / Variations buttons; image editing; DMs.

## Acceptance criteria
- [x] Composer tests:
  - `/` suggests /imagine, and picking it fills the text;
  - `/imagine a cat` with Landscape + High sends `{ prompt: 'a cat', shape: 'landscape', quality: 'high' }` and doesn't call `onSend`;
  - the box clears on success, and a refusal keeps the text and shows the reason;
  - when unavailable, the reason shows and nothing is sent;
  - "N left today" reflects the limit.
- [x] `useImagine`: resolves on `imagine_queued`, rejects with the server's message on the matching error, and ignores unrelated error frames.
- [x] The server dialog toggles and saves `{ enabled, dailyLimit }`, blank sending null; it explains a missing engine. The channel dialog saves `nsfw` only when changed. The channel list shows "18+".
- [x] MessageList shows BOT for `bot` messages and keeps to the bottom when an image loads while you're at the bottom (not when you've scrolled up).
- [x] The server: `bot` in history for the bot's messages; `imagine.ownLimit` in `GET /spaces`.
- [x] All suites pass; `vite build` is clean.
- [x] Live (sandbox app on :3005 with the user's ComfyUI): as sandy, turn `/imagine` on for Tx Check in the new dialog, type `/imagine …` in #general, and the image appears with the BOT badge, scrolled into view. Mark a channel 18+ and see the tag. As bob (no permission), the panel explains why.

## Expected Areas of Change
`web/src/components/Composer.jsx`, `ImaginePanel.jsx` (new), `ChatPanel.jsx`, `ThreadPanel.jsx`, `MessageList.jsx`, `ChannelList.jsx`, `ChannelSettingsDialog.jsx`, `ServerImagineDialog.jsx` (new), `web/src/state/useImagine.js` (new), `useSpaces.js`, `App.jsx`, `api.js`; `server/db/index.js` (`MESSAGE_SELECT`), `server/imagine/index.js`; tests.

## Working Set / Blast Radius
~14 files, mostly the app. Nothing changes in a server until its owner switches `/imagine` on.

## Implementation notes
- `imagineFor(spaces, space, channel, request)` (in `ImaginePanel.jsx`) builds the Composer's `imagine` from the server list and binds the request to that server and channel (or thread). `imagineState` turns the server's info into `{ available, reason, remaining, engines, run }`. When a server has no `imagine` info (older servers, test mocks), `/imagine` isn't offered and the box behaves as before.
- The chips use `onMouseDown` preventDefault, so clicking one leaves focus in the message box and Enter still generates.
- When `/imagine` is unavailable, Enter does nothing; the panel already shows the reason, so it isn't repeated as an error.
- The list follows the bottom on `img` load events (captured on the scroller; `load` doesn't bubble), using where you were at your last scroll. This also helps any slow-loading picture, not just generated ones.
- `MESSAGE_SELECT` returns `u.is_bot AS bot`; `hydrateBot` keeps `bot: true` and drops the field for people, so existing history shapes are unchanged.

## Discovered work
- **Fixed during the live check:** the first wiring sent the request without the server and channel (the Composer tests use a fake `run`), so the server refused it with "You can't post there". The binding now lives in `imagineFor`, with its own test.
- **Not fixed (pre-existing, separate):** the channel list's "restricted" shield reads the old tier columns (`view_role` / `post_role`), so a channel made private with role overrides (P2-21c) shows no shield. It should come from the roles (e.g. `channelMeta[c]` gaining a `private` flag when @everyone can't view it).

## Evidence (2026-10-18)
| Acceptance criterion | Evidence |
|---|---|
| Composer | `Composer.imagine.test.jsx` (8): "/" suggests the command, and picking it (click, or Enter on "/im") fills "/imagine ". Landscape + High sends `{ prompt, shape: 'landscape', quality: 'high' }` and never `onSend`; the box clears; "3 left today"; no engine chips with one engine. An empty prompt is caught; a LIMIT refusal keeps the text and shows the reason. For each of off / no engine / no permission / used up: no suggestion, the reason shown once, nothing sent. Two engines offer the choice and send `engine`. Without `imagine` info, "/imagine hello" is posted as text. `imagineFor` sends `space` and `channel` (a thread too), and is null for a server without info |
| `useImagine` | Same file: two requests are answered in order (queued, then the LIMIT error); an error frame for another op is ignored; `onQueued` runs once |
| Switches, tag, badge, scrolling | `ImagineSwitches.test.jsx` (6). The server dialog: enabling with a blank limit sends `{ enabled: true, dailyLimit: null }`; an existing limit of 5 shows and saves as 8; a missing engine and save errors are explained. Channel settings save `nsfw` only when changed, and voice channels don't offer it. The channel list shows "18+" on marked channels only, and the server menu's Image generation opens the dialog. The BOT badge appears on bot messages only. An image load keeps the list at the bottom when you were there, and not when you'd scrolled up |
| Server | `imagine.test.js`: history has `bot: true` on the bot's message and no `bot` field on people's; `imagine.ownLimit` is 5 after the owner sets 5 |
| Suites | Web: 68 files, 583 tests. Server: 32 suites, 301 tests. `vite build` clean |
| Live (sandbox server :3005 built app, the user's ComfyUI, Flux dev, High tier) | As sandy: server menu → Image generation showed /imagine on and "Instance default (20)"; set 10 and saved. History showed the bot's earlier messages with BOT badges. In #general, "/" offered /imagine and Enter filled it; the panel read "8 left today" with both sandbox engines. The first send was refused ("You can't post there"): the wiring bug above, fixed and rebuilt. Retried with Landscape: the box cleared, "generating…" after 1 s, and the fox in autumn leaves arrived at about 9 s, fully in view (image 394–701 px against the list's bottom at 704 px). Channel settings for `random` → Age-restricted (18+) → Save: the list showed "random 18+". As bob (no Generate images permission): "/imagine a cat" + Enter showed "You don't have the Generate images permission in this server." once, and nothing was posted |
