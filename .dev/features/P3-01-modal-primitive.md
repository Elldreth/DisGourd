# P3-01 — Accessible Modal primitive + migrate the simple dialogs

- **Unit Type:** Implementation
- **Phase:** 3 — "Dialogs need role=dialog, aria-modal, a focus trap and Esc to close"
- **State:** REVIEW (PR open)
- **Effort:** S–M
- **Depends on:** none
- **Serialize with:** units touching the migrated dialog files
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 3. Revalidated: there are **zero** `role="dialog"`/`aria-modal` usages in `web/src`. Only Lightbox, SearchOverlay and AudioSettings handle Escape.

## Scope
- New `web/src/components/Modal.jsx`:
  - props: `{ title, onClose, children, size, initialFocusRef, closeOnBackdrop = true }`
  - renders through a portal to `document.body`
  - `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` pointing at the rendered title
  - a focus trap (Tab and Shift+Tab cycle inside)
  - Esc closes; the handler stops propagation so nested Esc handlers (AudioSettings key capture) can claim it first
  - focus is restored to the opener on close, and body scroll is locked
  - uses the existing `anim-scale-in` and `anim-fade` animations
- Migrate **InviteDialog**, **ChannelSettingsDialog** and **ServerPermissionsDialog** to it.

## Acceptance criteria (manual keyboard and screen-reader pass)
- [x] For each migrated dialog: it opens with focus on the first control (or `initialFocusRef`), Tab never leaves it, Esc closes it, and focus returns to the button that opened it.
- [ ] NVDA or VoiceOver announces "dialog, <title>". **Not run with a real screen reader**; the accessible name and role are checked in the tests and in the browser's accessibility data ("Invite people to Tx Check", "#general settings", "Server permissions — Tx Check", all `aria-modal`).
- [x] Clicking the backdrop closes it; clicking inside doesn't.
- [x] Visual appearance is unchanged.
- [x] Optional, if P1-19 has landed: a Vitest + Testing Library test covering the focus trap and Esc.

## Expected Areas of Change
New `web/src/components/Modal.jsx`, plus `web/src/components/{InviteDialog,ChannelSettingsDialog,ServerPermissionsDialog}.jsx`.

## Working Set / Blast Radius
4 files.

## Scope change during the work
- `ChannelList.jsx` (outside the 4 planned files): picking an item in the server menu (Invite people, Permissions, …) now returns focus to the server-name button before the menu closes. Without it the opener is already gone when the dialog mounts, so focus had nowhere to return on close, and the "focus returns to the button that opened it" criterion couldn't pass for Invite and Permissions.

## Evidence
| Check | Result |
|---|---|
| `Modal.test.jsx` (10): role=dialog, aria-modal, named by `Modal.Title`; portal on `<body>`; focus to the first control or `initialFocusRef` (a control or a container); Tab / Shift+Tab wrap inside; Esc closes unless a control inside already handled it (`preventDefault`); backdrop closes, inside doesn't, `closeOnBackdrop={false}` opts out; focus back to the opener and body scroll locked / restored; Invite, Channel settings and Server permissions each render as a modal dialog named by their title | pass (failed first; one test was itself wrong, missing the `initialFocusRef` prop, and fixed) |
| Full suite / build | web 310/310, lint clean, build ok |
| Sandbox, keyboard only, Invite: server button -> Enter (menu) -> Tab -> "Invite people" -> Enter: dialog "Invite people to Tx Check", aria-modal, focus on Copy; Tab -> Close -> Tab -> Copy; Shift+Tab -> Close (stays inside); Esc -> closed, focus back on the server button | pass |
| Sandbox, Permissions: dialog "Server permissions — Tx Check", focus on the first setting (Create channels select); Tab from the last control wraps to Close (first); Esc -> closed, focus back on the server button | pass |
| Sandbox, Channel settings (mouse): dialog "#general settings", focus on "Who can see this channel"; clicking inside keeps it open; clicking the backdrop closes it | pass |
| Visual | same panel classes and headings; the backdrop is the same `bg-black/60` overlay, now `fixed` in a portal instead of `absolute` in the app root (which fills the window), so it looks the same; screenshot checked |

## Implementation notes
- `Modal.jsx`: draws backdrop + empty panel (`panelClassName`), so each dialog keeps its own layout and classes; `Modal.Title` (an h3, default `text-lg font-bold` as before) provides `aria-labelledby` through context.
- `initialFocusRef` can point at a container: Channel settings and Server permissions pass their body, so focus starts on the first setting rather than the header's Close button.
- Esc is handled on the dialog (bubbling), so a control inside can claim it first by calling `preventDefault` (the push-to-talk key capture will need that when ProfileDialog moves to Modal in P3-02).

## Not verified
- A real screen reader (NVDA / VoiceOver).

## Discovered Work
- The **channel settings gear** in the channel list only appears on hover (`hidden group-hover:flex`), so keyboard users can't reach it at all. Show it on `group-focus-within` / focus-visible too (fits P3-03, the icon-button sweep).
