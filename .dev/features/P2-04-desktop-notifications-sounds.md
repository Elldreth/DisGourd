# P2-04 — Desktop notifications + message/mention sounds (with settings)

- **Unit Type:** Implementation
- **Phase:** 2, rank 2 (part 2)
- **State:** REVIEW (PR open)
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
- [x] Vitest for `shouldNotify` covers focused/unfocused, own message, mention, DM and level settings.
- [~] Manual (Chrome + Firefox): the permission prompt appears only after the toggle. With the tab in the background, a mention shows a notification, and clicking it opens that channel. No notification fires for the channel you're focused on.
- [x] Sounds respect the toggle and never play for your own messages.
- [x] If permission is denied, the UI says so and offers no retry loop.

## Expected Areas of Change
New `web/src/notify.js`, `web/src/sounds.js`, `web/src/audio.js` (setting getters/setters), `web/src/components/ProfileDialog.jsx` or `AudioSettings.jsx`, `web/src/state/useChannelMessages.js`, `web/src/state/useDms.js`.

## Working Set / Blast Radius
~6 files. Nothing changes until the user opts in.

## Evidence
| Check | Result |
|---|---|
| `notify.test.js` (14 tests): own messages, mention / DM / plain message, focused vs background, open channel vs same name elsewhere, levels off / mentions / all, sounds on/off, notification text | pass |
| `NotificationSettings.test.jsx` (5 tests): nothing asked on load; allowing saves the level; blocking keeps it off with a notice; already blocked never asks; sound toggle works with no Notification API | pass |
| Full web suite / build | 95/95 pass, `vite build` ok |
| Sandbox, real browser permission "denied": Settings shows the Notifications section and the blocked notice; choosing "Mentions and DMs" stays on Off and never prompts | pass |
| Sandbox, `Notification` stubbed as granted, level "mentions", bob sends four frames while sandy reads #history: mention in #general -> "bob in #general · Tx Check", body "hey @sandy look at Spoiler this"; mention in the open #history -> none; plain message in #random -> none; DM -> "bob", "a direct one" | pass |
| Clicking those notifications opens #general and the DM with bob, and closes them | pass |

## Implementation notes
- The rules are pure functions (`attentionKind`, `shouldNotify`, `soundFor`, `notificationText`); `useNotifications()` wires them up. The channel and DM hooks call `onIncoming` with each incoming frame.
- One notification per conversation (`tag`): a newer one replaces the older. Open notifications close when the window regains focus.
- Sounds are separate from desktop notifications: mentions and DMs chime; plain messages blip only at "All messages".
- Tests were written alongside the code rather than strictly first.

## Not verified
- Real Chrome / Firefox permission prompts and OS notifications: the preview pane has notifications blocked, so delivery was checked with a stubbed `Notification`.
- Sounds were not heard in the sandbox (no audio output); only the choice of sound is unit-tested.
- DND (P2-14) is not checked yet; add it to `shouldNotify` and `soundFor` when P2-14 lands.

## Discovered Work
- After a DM arrives and you open it from a notification, the DM sidebar can still say "No conversations yet" until it reloads. Seen in the sandbox; not caused by this unit. Worth a look alongside P1-09 (reconnect resync) or as its own small fix.
