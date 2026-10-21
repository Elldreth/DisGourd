# P9-07b — Blocking in the app

- **Unit Type:** Implementation (child of P9-07)
- **Phase:** 9
- **State:** REVIEW
- **Starting baseline:** main at c41eda6 (#198 merged)
- **Effort:** M
- **Depends on:** P9-07a

## Scope
- **State:** a `useBlocks` hook loads GET /blocks after sign-in and reloads on `blocks_changed`. It exposes `isBlocked(username)`, `block(username)` and `unblock(username)`.
- **Block / Unblock in four places:**
  - the member list menu;
  - a 1-to-1 DM's header ("…" or a button);
  - a message's "…" menu, beside Report;
  - Settings › My account › **Blocked people**: the list with Unblock, or "You haven't blocked anyone."
  - Blocking asks first: "Block bob? They can't message you or add you to groups, and their messages are hidden behind 'Show'. They aren't told." Unblocking is immediate.
- **Messages in servers, threads and groups:**
  - A blocked person's message renders as a small row, **"Blocked message · Show"**. Show reveals that message until you leave the channel.
  - Consecutive blocked messages collapse into one row ("3 blocked messages · Show").
  - Replies quoting a blocked message show "Blocked message" as the quote.
- **Notifications and typing:**
  - `notify.js` ignores frames from blocked people: no desktop notification and no sound.
  - Their name is dropped from typing lines.
- **A blocked 1-to-1:**
  - The composer is replaced by a bar: "You've blocked bob. Unblock to message." (with Unblock), or "You can't message this person" when they've blocked you, as GET /dms `blocked` says.
  - A `BLOCKED` refusal from the server shows as a toast.
- **The new-message and group pickers** leave out people you've blocked.

## As built
- **`state/useBlocks.js`:**
  - The hook loads GET /blocks on sign-in and reconnect, and on `blocks_changed`. It provides `isBlocked`, plus `block` / `unblock`, which call the API and then reload.
  - `BlocksContext` / `useBlocked()` share `{ list, isBlocked, requestBlock, unblock }`. With no provider, nobody is blocked and the actions are absent.
- **`App`:**
  - The provider, and the "Block bob?" confirm (`ConfirmDialog`, danger) with "Blocked bob" / "Unblocked bob" toasts. It reloads the DM list after either, and on `blocks_changed`.
  - A `dm` BLOCKED refusal shows a toast.
  - `notifier.update({ blocked })`.
  - The group picker and the people picker leave out blocked people.
- **Places to block:**
  - `MemberList` gets **Block…** (amber) or **Unblock**, for others.
  - `MessageList` gets **Block <name>…** in the message menu, for others' messages that aren't the bot's, notices or already blocked.
  - `DmPanel`: a **Block <name>** button in a 1-to-1's header (hidden once blocked).
  - **Settings › My account › Blocked people** (`settings/BlockedSection.jsx`).
- **`MessageList`:** messages from blocked people become one row per consecutive run, "Blocked message" / "n blocked messages" with **Show**. Shown ids stay revealed until the channel changes. A reply quoting a blocked person shows "Blocked message".
- **`DmPanel`:** for a 1-to-1 that I've blocked, or that the server marks `blocked`, a bar replaces the composer. Mine says "You’ve blocked bob. Unblock to message them." with **Unblock**; theirs says "You can’t message this person."
- **`TypingIndicator`** drops blocked names, and `notify.attentionKind` ignores frames from blocked people (no desktop notification or sound).
- **The blocked person isn't told,** so their "You can’t message this person" bar clears only when their DM list next reloads (opening DMs, a reconnect), as designed.

## Acceptance criteria
- [x] **Web:**
  - The hook (load, block, unblock, the frame).
  - Each of the four places (with the confirm).
  - Collapsed messages and grouped runs, with Show.
  - A reply quote from a blocked person; no notification or sound; typing filtered.
  - The DM bar (both cases); the pickers filtered; the Settings list.
- [x] **All suites pass;** `vite build` is clean.
- [x] **Sandbox, in two browsers:**
  - sandy blocks bob from the member list.
  - bob's messages in Tx Check collapse for sandy, and Show reveals one.
  - The DM bar appears for both of them.
  - Unblock from Settings, and everything is back.

## Evidence (2026-10-21)
| Acceptance criterion | Evidence |
|---|---|
| Web | `blocking.test.jsx` (new, 6):<br>• `useBlocks`: load, block / unblock calls and reloads, `blocks_changed` reloads.<br>• Member list: Block… asks (`requestBlock('cara')`), Unblock acts (`unblock('bob')`).<br>• Messages: a run of two → "2 blocked messages", the single one → "Blocked message", and cara's reply quote of bob → "Blocked message". Show reveals that run only. "Block cara…" in her menu; no Block on a revealed blocked message.<br>• Typing shows "cara is typing…" without bob; `attentionKind` ignores bob's mention and DM.<br>• DmPanel: the header's Block for cara; my-block bar with Unblock; their-block bar without; no composer.<br>• BlockedSection: the list with Unblock, and the empty note.<br>`App.test.jsx`: the api mock gained `getBlocks` |
| All suites | Web 104 files, 817. Server 53 files, 461 (both run). `vite build` clean |
| Sandbox (:3005; sandy and bob in two tabs) | **Blocking:** sandy › Tx Check › members › bob → menu Message, Roles…, **Block…**, Time out…, Remove, Ban… → "Block bob?" with the explanation → Block → toast "Blocked bob". Every bob message in #general collapsed into rows ("9 blocked messages · Show"…).<br>**Live:** bob (other tab) posted "@sandy live message while blocked" → it joined the last run ("3 blocked messages") and stayed hidden; Show revealed it.<br>**DMs:** sandy's DM with bob shows "You’ve blocked bob. Unblock to message them." with Unblock, and no composer or Block button. bob's DM with sandy shows "You can’t message this person." only.<br>**Unblocking:** Settings › My account › Blocked people listed bob → Unblock → "You haven’t blocked anyone", toast "Unblocked bob", sandy's composer back. bob's bar stayed until his DM list reloaded (switching to a server and back), then his composer returned, as designed (he isn't told) |
