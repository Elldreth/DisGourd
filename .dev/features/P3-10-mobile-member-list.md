# P3-10 — Member list on mobile (right-side drawer)

- **Unit Type:** Implementation
- **Phase:** 3 — "Mobile has no way to see the member list" (`MemberList.jsx:86`)
- **State:** COMPLETE (merged in #75)
- **Effort:** S
- **Depends on:** none
- **Serialize with:** App.jsx units (one state value and a prop), ChatPanel.jsx units (P2-08), MemberList.jsx units (P3-08)
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 3. Revalidated: `<aside className="hidden ... lg:flex">`, so the list is hidden below 1024px with no alternative.

## Scope
- ChatPanel header: a "Members" icon button visible below `lg` (`lg:hidden`), with `aria-expanded`.
- MemberList gains a `variant="drawer"`: fixed on the right, `z-40`, a backdrop (like the left nav drawer in App.jsx), slide-in animation, Esc and backdrop close it, and focus moves into it.
- App holds `membersOpen`. Picking "Message" on a member closes the drawer.
- On desktop (≥ lg), nothing changes.

## Acceptance criteria
- [x] On an emulated 390×844 screen: tap Members, the drawer opens with the online/offline groups, and tapping the backdrop closes it.
- [x] Role menus and kick work inside the drawer.
- [x] Between 768px and 1023px (tablet), the button is visible and the drawer works.
- [x] The desktop layout is unchanged.

## Expected Areas of Change
`web/src/components/ChatPanel.jsx`, `web/src/components/MemberList.jsx`, `web/src/App.jsx`.

## Working Set / Blast Radius
3 files.

## Evidence
| Check | Result |
|---|---|
| `MemberList.test.jsx` (7): closed = `invisible` below lg, `lg:visible` on desktop, no backdrop; open = online/offline groups, backdrop, focus inside; backdrop / close button / Esc each close; Esc ignored while closed; member actions (Message) work in the drawer; focus returns to where it was on close; chat header has a `lg:hidden` Members button with `aria-expanded` | pass (5 failed first; the 2 about existing behaviour passed before) |
| Full suite / build | web 300/300, lint clean, build ok |
| Sandbox 390×844, real taps: Members -> drawer visible on the right (x 134-390), "Online — 1" / "Offline — 1", `aria-expanded=true`, focus on its close button; tap the backdrop -> hidden, `aria-expanded=false`, focus back on Members | pass (after one fix, below) |
| Sandbox 390×844 in the drawer: bob -> Make admin -> "ADMIN" badge, drawer stays open; Remove admin -> back to member; "Remove from server" -> confirm "Remove bob from the server?" (answered no) | pass |
| Sandbox 800×1000 (tablet): button shown; drawer opens with focus inside; Message on bob -> DM with bob, drawer closed; back to the server, the drawer doesn't reopen | pass |
| Sandbox 1300×800 (desktop): Members and close buttons `display: none`, no backdrop; column static, visible, 224 px wide at the right edge, full height, box-shadow only transparent layers | pass (unchanged) |

## Implementation notes
- One `<aside>` serves both: below lg it's a fixed right-hand drawer (w-64, slides in, backdrop, `invisible` when closed so it's out of the tab order); lg and up restores the old static w-56 column (`lg:visible lg:static lg:translate-x-0 lg:shadow-none lg:transition-none`).
- **Fixed during the sandbox check:** focus didn't move into the drawer in Chrome. With `transition-[transform,visibility]` the drawer stays `visibility: hidden` for the first frame of opening (visibility interpolates discretely), so `focus()` failed. Now visibility switches at once when opening and only animates when closing (so the slide-out stays visible). jsdom has no transitions, so the unit test couldn't catch this.
- App holds `membersOpen`; "Message" closes the drawer before opening the DM.
- Members button uses the existing `users` icon; the drawer header gets a close (×) button below lg.

## Not verified
- Real touch devices and screen readers (the drawer is an `<aside aria-label="Members">`, not a modal dialog; focus isn't trapped inside it).
