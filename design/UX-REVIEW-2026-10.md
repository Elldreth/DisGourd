# DisGourd UX review, October 2026

A design round on the app as it stands on `main` after the threads work (PRs #97–#100). Everything below was seen in the sandbox server (`app-sandbox` on :3005, sandbox DB only) on 2026-10-17, at a 1280×800 desktop viewport and the 375×812 phone preset, plus the setup wizard on a fresh install (`app-fresh` on :3006). The light theme was checked by switching `data-theme`. Accessibility was checked with axe-core 4.10.2 (every `title` stripped first, so it doesn't count as a name) and a script that measured every interactive element at phone width.

Scope: sign-in and setup wizard, server rail and channel list, the chat panel (messages, replies, reactions, pins, link previews, threads), the thread panel, DMs, the member list, quick switcher and search, voice, settings and the status menu. The voice/video stage could not be exercised: the browser pane blocks the microphone and camera, so the review of it is from the code (`VideoStage.jsx`).

## Summary

The bones are good. The Neon Calabash theme is coherent, contrast passes AA across the board (axe found only two moderate structural issues on the main screen), dialogs trap focus and close on Esc, message actions have a keyboard and long-press path, and the setup wizard is one of the better first-run flows I have seen in a self-hosted app. The things that hold it back are polish-level, not structural:

1. **Phone touch targets are too small.** 41 of the 50 interactive elements on the channel screen are under 44 px; the five header icon buttons are 30 px.
2. **Settings is one 1,700 px scroll** mixing profile, audio, appearance, notifications and site admin, with no section navigation.
3. **Empty states are inconsistent** (an emoji here, a `#` glyph there, plain text elsewhere) and none of them has the personality the brand work set up.
4. **Starting a DM needs a detour** through a server's member list.
5. **Link-preview cards dominate the message list**, especially on phones.
6. A handful of small hierarchy issues: the server rail reads as five identical pills, the server menu puts "Delete server" one row under "Permissions", hover timestamps are 10 px.

The prioritised list is at the end. The suggested round of work (R1–R7) is in `.dev/features/P4-*.md`.

## How to read the findings

Each finding has what I saw, why it matters, a concrete suggestion and a size: **S** (hours, one or two files), **M** (a day or two, a few files, tests), **L** (several days or needs a data change). Severity is in the priority list, not here.

---

## 1. Flow

### F1. Settings is a single long sheet with no navigation — M

**Saw.** "Edit your profile" opens a dialog titled Settings. It stacks Profile, Voice & audio (two device pickers, two test buttons, join/leave sounds, push-to-talk with shortcut hints), Appearance, Notifications (with a pink "blocked in your browser" banner), Message sounds, Registration & access (site admin), Site admins and Link previews. The scroll height is about 1,700 px inside an 85 vh panel. There are no tabs or anchors, so finding "Theme" means scrolling past the audio section every time.

**Why it matters.** Settings is the second most-opened dialog after the status menu. Mixing personal preferences with site-admin controls also means an ordinary member sees admin-only sections flash past or wonders why the sheet is so long. (Only admins see the admin sections, but the structure problem is the same for them.)

**Suggest.** Keep one dialog, add a left column of sections on desktop (Profile, Voice & audio, Appearance, Notifications, and for site admins a separate "Site admin" group) and a horizontal segmented control on phones. Each section is its own scroll. Move the notification-permission banner into the Notifications section only when a level other than Off is chosen.

### F2. Starting a DM requires leaving the DM view — S

**Saw.** The Direct Messages column has no "new message" control. Its empty state says "Open a member in a server (right-hand list) to start one", and the main empty state says the same. On a phone that is: open the drawer, pick a server, open the member drawer, tap a name, choose Message.

**Why.** "Message someone" is the one thing people come to the DM view to do. Five steps for it on a phone is the longest common flow in the app.

**Suggest.** A "New message" button (plus icon) in the DM header that opens a people picker. The quick switcher already lists people and does fuzzy matching; open it in a people-only mode with the prompt "Message who?". Also make the DM empty-state text a button that does the same.

### F3. The setup wizard ends with the invite link buried in a textarea — S

**Saw.** Step 4 ("You're all set") shows a monospace textarea containing a three-line message with the invite URL inside it, a "Copy message" button and "Open DisGourd". The link itself is not shown as a link, there is no "Copy link" option, and nothing says how long the invite lasts or that you can make more later.

**Why.** Most people paste a link, not a paragraph. The paragraph is also the only place the code appears.

**Suggest.** Show the invite URL first in its own read-only field with "Copy link", then the friendly message below it as a secondary option. Add one line: "Invites never expire; make more from the server menu."

### F4. Keyboard shortcuts are invisible until you already know them — S

**Saw.** Ctrl+K, Alt+↑/↓, ↑ to edit, Ctrl+Shift+M / D are all implemented. The only hint is a footer line inside the quick switcher and the push-to-talk card in Settings. The search button, the Threads and Pins buttons and the channel list have no tooltip shortcuts.

**Suggest.** A keyboard-shortcuts sheet on `Ctrl+/` (and from the status menu as "Keyboard shortcuts"), and add the shortcut to the tooltip of each button that has one ("Search messages · Ctrl+K" style). Tooltips are already `title` attributes, so this is text only.

### F5. Pins and Threads open as popovers that close on any click — S

**Saw.** Both open anchored dropdowns under the header; they close on the next click anywhere. Opening a pinned message from the list closes the list, so reviewing several pins is open-click-reopen.

**Suggest.** Keep the popover, but let a click inside it (open a pin, toggle Archived) keep it open; close on Esc, the X, or a click outside. If the thread panel is open, open Pins in that side column instead of over the chat.

### F6. The server menu puts "Delete server" one row below "Permissions" — S

**Saw.** Server menu order: Invite people, Rename server, Change icon, Permissions, Delete server. Delete is red but there is no separator and no spacing.

**Suggest.** A divider above the destructive item and 4 px extra padding. The confirm dialog already exists (P3-08), so this is layout only.

### F7. Channels have no topic line — M

**Saw.** The channel header shows only the name. Nothing tells a newcomer what `#made-offline` or `#history` is for. The welcome card ("This is the start of the channel. Say hello!") is the only context.

**Suggest.** An optional topic per channel (set from Channel settings, shown in the header, truncated, click to expand). Needs a column and a route, so this is a feature rather than polish; listed for completeness.

## 2. Visual design

### V1. Link-preview cards dominate the message list — S

**Saw.** The GitHub preview renders the site name, title, two-line description and a 1,200×600 image at full card width: about 320 px tall on desktop and the whole screen on a phone. One preview pushes three or four messages off screen.

**Why.** The message is the content; the card is a hint. Right now the card is louder than the text, and a channel with a few links becomes a wall of images.

**Suggest.** Cap the card at 420 px wide and the image at 180 px tall (object-fit cover), or show large images as a thumbnail to the right of the text on desktop. Collapse the description to two lines (it already is) and let the card be dismissed per message by the author ("Remove preview"), which Discord and Slack both do.

### V2. Thread summary chips truncate the wrong part — S

**Saw.** Under a root message the chip reads "router http://192.… · 1 reply · last 1 h ago". On a phone the long example became "B… · 6 replies · last 33 min ago · archived": the name shrinks to one letter so the metadata can stay.

**Suggest.** Give the name the flexible width and truncate the meta first (hide "last …" below 360 px, keep the reply count). Prefer the thread's name over the root excerpt when it has one.

### V3. Empty states are inconsistent and characterless — M

**Saw.** Six different empty states, six different treatments: a floating `#` for an empty channel, a `#` again for an empty thread, a 💬 emoji for the DM home and the DM conversation start, the gourd mark for "No server selected", plain grey text for pins, threads, search and members. The copy is fine (friendly, short, says what to do next) but nothing ties them together, and the brand mark only appears on one of them.

**Why.** Empty states are where a small server lives in its first week. They are also the cheapest place to put the "gourd" personality the logo work promised (see design/IMPROVEMENT-PLAN.md Phase 4, "mascot poses" and "empty-state illustrations").

**Suggest.** One `EmptyState` component (icon or illustration, heading, one line, optional action button), used everywhere. Illustrate four of them with small flat spot illustrations in the palette: empty channel, no DMs, no server, and nothing found (search/pins/threads share it). Generate options with kie.ai, keep the best as optimised SVG or a WebP under 20 KB each, with the prompt recorded under `design/empty-states/`. The style must stay flat and read in one colour, matching the logo.

### V4. The server rail reads as five identical pills — S

**Saw.** Gourd (DMs), two server initials, "+", and the join arrow are all 40 px circles in a column with equal gaps. There is no visual grouping between home, your servers and the two actions.

**Suggest.** A short divider under the gourd and one above the actions; draw the actions as outlined circles (ring, no fill) so filled circles mean "a place" and outlined ones mean "do something". Keep drag-to-reorder as is.

### V5. Hover timestamps are 10 px — S

**Saw.** Grouped messages show their time on hover/focus at 10 px in `gray-500`. On a 1280 px screen it is a smudge; on a phone it never shows (no hover) and long-press is the only route.

**Suggest.** 11 px minimum, `gray-400`, and on coarse pointers always show the time for the first message of each minute group instead of relying on hover.

### V6. Nested outlines on the auth card — S

**Saw.** Login and wizard: the page watermark gourd, then a card with a ring, then a logo tile with its own ring, then inputs with rings. Three concentric rounded outlines before any content.

**Suggest.** Drop the ring and background from the logo tile (draw the mark directly on the card) and keep the single card ring. This one is taste; it does make the card calmer.

### V7. Light theme: the logo's lime leaf is faint — S (design decision)

**Saw.** On `data-theme="light"` the violet body is fine but the lime leaf is low-contrast against `#eae5f7`. Already noted in the P2-17 packet as a decision for the owner.

**Suggest.** On light surfaces draw the leaf in `--color-lime` (which the light theme darkens to `#2b7512`) instead of the fixed `#B8F34A`. One prop on `Gourd`.

### V8. The thread panel is mostly empty space — S

**Saw.** The thread column pins the root message at the top and the replies at the bottom, with a `#` glyph and "The start of the thread" floating in the middle of a tall empty column.

**Suggest.** Top-align replies (no `justify-end`), use a thread icon rather than `#`, and add "Started by sandy · yesterday" under the root.

## 3. Accessibility

### A1. Phone touch targets — M

**Saw.** Measured at 375 px: 41 of 50 interactive elements are under 44 px in at least one dimension. Header icon buttons 30×30; channel rows 32 px tall; reactions 20 px tall; the thread chip 24 px; spoiler buttons 20 px; "Archive"/"Follow" 24 px; Sign out 29 px. The WCAG 2.2 AA floor is 24 px, which most meet, but the common mobile guidance (Apple, Material, Smashing's cheat-sheet) is 44 px for anything at the top or bottom of the screen.

**Suggest.** A `@media (pointer: coarse)` block: icon buttons 44 px (padding, not icon size), channel and DM rows 44 px, reactions 28 px tall with 8 px gaps, chips 32 px. Keep desktop as is. The `IconButton` component already centralises most of these.

### A2. Settings form controls are unlabelled — S

**Saw.** The Microphone and Speaker selects report their selected option ("System default") as their name; the uppercase captions above them are plain spans. The two checkboxes (join/leave sounds, push-to-talk) report "on". Everything else in the app has names.

**Suggest.** `<label htmlFor>` on the captions, and wrap each checkbox row in a `label`. Ten lines in `AudioSettings.jsx`.

### A3. No level-one heading and no landmarks on the main screen — S

**Saw.** axe: `page-has-heading-one` and `region` (the channel list's "Text channels" / "Voice channels" captions are outside any landmark). Dialogs are fine.

**Suggest.** `<h1 class="sr-only">DisGourd</h1>` in App, `nav aria-label="Channels"` around the channel list, `aside aria-label="Members"` around the member list, `main` is already there.

### A4. The message hover toolbar covers the message — S

**Saw.** The reply/react/edit/delete toolbar appears over the top-right of the row, on top of the text of the previous line when the row is short. In the phone emulation it covered half of "router http://192.168.1.1/".

**Suggest.** Position it at `-top-3` so it straddles the row's top edge (the Discord pattern) and give it the row's background so it never overlaps text.

## 4. Mobile

### M1. The thread panel takes over with only a top-right close — S

**Saw.** On phones the thread panel is full-screen. The only way back is the 30 px X at the top-right, out of thumb reach; Android back closes the app.

**Suggest.** A back chevron at the top-left ("‹ #general") and `history.pushState` so the hardware back button closes the panel. Same for the members drawer.

### M2. Five 30 px header buttons on a 375 px screen — S

Covered by A1. On phones, fold Threads and Pins under one "…" button, or make all five 44 px and drop the channel name's bold weight to give them room.

### M3. The composer on phones — S

**Saw.** Attach, text, emoji, Send fit on one line. The Send label is a text button; the emoji button is 32 px. Not verifiable here: keyboard safe-area and `100dvh` behaviour, since the pane has no virtual keyboard.

**Suggest.** Use `100dvh` for the app shell (check `index.css`), `env(safe-area-inset-bottom)` on the composer, and make Send an icon button on phones.

## 5. Things that are already good

Worth saying so they are not "fixed": the status menu (one click, keyboard radio group), the quick switcher (fast, shows unread counts, shortcut hints), the welcome card and date dividers, the reply preview strip, the spoiler and code-block treatment, in-app confirm dialogs, the undo toast, the new-messages divider, the thread "archived · reply reopens it" notice, the voice panel's plain-language "No microphone" explanation, and the whole four-step wizard with its template picker.

## 6. Outside reading

Used to sanity-check the suggestions, not as sources of truth:

- Empty-state guidance (Eleken, LogRocket's Slack onboarding case, Setproduct's checklist): one primary action, human copy, consistent illustration style, a "nothing found" state that looks different from "nothing yet".
- Target sizes (Smashing's cheat-sheet, Siteimprove): 44 px at screen edges, 24 px WCAG floor, spacing between adjacent controls.
- W3C APG modal dialog pattern: already met by `Modal.jsx`.
- Sidebar/settings navigation patterns: sections on the left for desktop, segmented tabs on phones.

---

## Prioritised list

| # | Finding | Area | Size | Priority |
|---|---|---|---|---|
| 1 | A1 + M2: touch targets at phone width | Mobile / a11y | M | High |
| 2 | F1: settings with section navigation | Flow | M | High |
| 3 | V3: one EmptyState component + flat illustrations | Visual | M | High |
| 4 | F2: new-message button in DMs | Flow | S | High |
| 5 | V1: tame link-preview cards | Visual | S | High |
| 6 | V4 + F6 + V5 + V6 + V8: hierarchy polish (rail groups, menu divider, timestamps, auth card, thread panel) | Visual | S | Medium |
| 7 | A2 + A3 + A4: labels, landmarks, toolbar position | A11y | S | Medium |
| 8 | M1: thread panel back affordance + hardware back | Mobile | S | Medium |
| 9 | F3: wizard final step shows the link first | Flow | S | Medium |
| 10 | F4: shortcuts sheet and tooltip hints | Flow | S | Medium |
| 11 | F5: pins/threads popovers stay open on inner clicks | Flow | S | Low |
| 12 | V2: thread chip truncation | Visual | S | Low |
| 13 | V7: lime leaf on light theme | Visual | S | Low (owner's call) |
| 14 | M3: dvh + safe-area on the composer | Mobile | S | Low (unverified) |
| 15 | F7: channel topics | Flow | M | Later |

## Proposed round ("Shine", packets P4-01 to P4-07)

| Unit | Covers | Size |
|---|---|---|
| P4-01 Phone touch targets and header | 1, M2 | M |
| P4-02 Settings sections | 2 | M |
| P4-03 Empty states with illustrations | 3 (plus kie.ai assets under `design/empty-states/`) | M |
| P4-04 New message from DMs | 4 | S |
| P4-05 Calmer link previews | 5 | S |
| P4-06 Hierarchy and a11y polish | 6, 7, 12, 13 | S |
| P4-07 Thread panel on phones | 8 (+ V8) | S |

Items 9, 10, 11, 14 and 15 are recorded as follow-ups in the container packet (P4-00) and can become units later.
