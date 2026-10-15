# P2-04 — Desktop notifications + message/mention sounds (with settings)

- **Unit Type:** Implementation
- **Phase:** 2, rank 2 (part 2)
- **State:** PLANNED
- **Effort:** S–M
- **Depends on:** P1-13 (channel and DM handlers live in hooks, so notification logic plugs in without editing App.jsx)
- **Soft-depends on:** P2-14 (DND suppresses notifications; add that check when P2-14 lands)
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 2 #2

## Scope
- New `web/src/notify.js`:
  - `shouldNotify(frame, ctx)` is pure. It returns true for a mention of me, or a DM to me, when the window isn't focused or the message isn't in the focused channel. It is never true for my own messages. It also covers an "all messages" level.
  - `showNotification({ title, body, icon, onClick })` truncates the body to 120 characters and strips markdown and spoilers (spoiler text becomes "Spoiler"). Clicking it focuses the window and navigates to the channel or DM.
- Settings, stored in localStorage next to the getters in `audio.js`: notifications off / mentions & DMs (default once the user enables them) / all messages; and a sound on/off toggle. The permission request happens *only* from the settings toggle, never on load.
- Sounds: `playMessage()` and `playMention()` in `sounds.js` (sine placeholders until the Phase 4 sound set lands). Play only when the message isn't in a focused, visible channel.
- UI: a "Notifications" section in ProfileDialog (or next to AudioSettings).

## Acceptance criteria
- [ ] Vitest for `shouldNotify` covers focused/unfocused, own message, mention, DM and level settings.
- [ ] Manual (Chrome + Firefox): the permission prompt appears only after the toggle. With the tab in the background, a mention shows a notification, and clicking it opens that channel. No notification fires for the channel you're focused on.
- [ ] Sounds respect the toggle and never play for your own messages.
- [ ] If permission is denied, the UI says so and offers no retry loop.

## Expected Areas of Change
New `web/src/notify.js`, `web/src/sounds.js`, `web/src/audio.js` (setting getters/setters), `web/src/components/ProfileDialog.jsx` or `AudioSettings.jsx`, `web/src/state/useChannelMessages.js`, `web/src/state/useDms.js`.

## Working Set / Blast Radius
~6 files. Nothing changes until the user opts in.
