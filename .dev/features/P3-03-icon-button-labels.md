# P3-03 — Accessible names for icon-only buttons (IconButton sweep)

- **Unit Type:** Implementation
- **Phase:** 3 — "Icon buttons need aria-label"
- **State:** REVIEW
- **Effort:** S–M (mechanical, but wide)
- **Depends on:** P3-02 and P3-05 (those units restructure the files that hold most icon buttons; sweeping after them avoids rework)
- **Serialize with:** **effectively exclusive.** It touches about 12 component files, so run it when no other client unit is in flight.
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 3. Revalidated: icon buttons use `title=` (a tooltip). Only `Icon.jsx` and `Gourd.jsx` set `aria-label`, on the SVG.

## Scope
- New `web/src/components/IconButton.jsx` with props `{ icon, label, size, className, ...rest }`. It renders a `<button type="button" aria-label={label} title={label}>`, and the Icon inside it gets `aria-hidden`.
- Replace icon-only buttons in: ChatPanel, ChannelList, ServerRail, Composer, MessageActions, MemberList, DmPanel, DmSidebar, UserFooter, VideoStage, Album, Lightbox. Toggle buttons (mute, deafen, camera, share) get `aria-pressed`.
- Unread and mention badges get screen-reader text ("3 unread, 1 mention").

## Acceptance criteria
- [x] An axe DevTools scan of the main chat view, a DM and settings shows 0 "button-name" violations.
- [x] Toggle buttons announce their pressed state.
- [x] No visual change.

## Expected Areas of Change
New `IconButton.jsx`, plus the ~12 components above (small edits).

## Working Set / Blast Radius
Wide, shallow edits.

## Evidence
Baseline: main at 65d45ca (after P3-11). Branch `claude/p3-03-icon-buttons`.

| Acceptance criterion | Evidence |
|---|---|
| 0 "button-name" violations (main chat, a DM, settings) | Sandbox, axe-core 4.10.2 with button-name, label, select-name, link-name and the aria name rules. The scan ran **with every `title` removed first**, so a tooltip doesn't count as a name; a probe button named only by its title was caught. 0 violations on: the main chat (113 buttons), the message menu open, the emoji picker open, a DM (@bob), Settings, and channel settings. `a11y.test.jsx` runs the same check (named without the title, and not just a symbol) on ChannelList (in a call, plus the voice notice), ServerRail, ChatPanel, DmPanel and DmSidebar. |
| Toggle buttons announce their pressed state | `aria-pressed` on Mute, Deafen, Camera, Share your screen, Share app audio, and "Mute <name>'s audio for me". Each keeps a stable name while aria-pressed carries the state; the tooltip still says what a click does. Unit-tested. **Not checked in a live call:** the Browser pane blocks the mic. |
| No visual change | Class strings were kept as they were. IconButton passes `className` through, and the swapped controls render the same. The only visible differences are keyboard-only: the channel gear now shows when its row has keyboard focus, and Upload avatar gets a focus ring. Screenshots of the chat and Settings looked unchanged. |

Web tests: 365 pass (9 new in `a11y.test.jsx`). Build clean.

### Also fixed (keyboard reachability, from earlier Discovered Work)
- **Channel-settings gear:** it was hover-only. It now also shows on `group-focus-within`/`focus-visible`, so Tab from a channel reaches it, and it has a name per channel ("Channel settings for random"). While its dialog is open it stays shown; on close, focus goes back to it (Modal couldn't refocus a `display:none` element before).
- **Upload avatar:** it was a `<label>` around a hidden file input, so Tab skipped it. It's now a real button that opens the file picker.

### Other names added
- Composer: attach button, "Remove <file>" on pending attachments, and the message box (named only by its placeholder before).
- ChannelList: the create (voice) channel "+" buttons (also `aria-expanded`), the new channel name inputs, voice-notice Dismiss (was "✕"), and the shared-audio volume slider.
- Badges: servers, channels and DMs now say "N unread, N mentions" to screen readers, and the visual badge is hidden from them. Server icons announce the full server name instead of initials, plus `aria-current`.
- EmojiPicker category buttons, RegistrationAdmin admin "Remove" and promote input, and the Speaker select plus its "Test speaker" button.

### Notes
- MessageActions, MemberList, VideoStage, Album and Lightbox already had names from P3-02/P3-05; the scans found nothing there.
- `dom-accessibility-api` (already installed via Testing Library) is now listed as a devDependency because the test imports it.
- IconButton is used where buttons were rewritten. Icon buttons that already had aria-label were left alone to keep the diff small.
