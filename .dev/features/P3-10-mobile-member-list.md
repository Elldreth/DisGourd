# P3-10 — Member list on mobile (right-side drawer)

- **Unit Type:** Implementation
- **Phase:** 3 — "Mobile has no way to see the member list" (`MemberList.jsx:86`)
- **State:** READY
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
- [ ] On an emulated 390×844 screen: tap Members, the drawer opens with the online/offline groups, and tapping the backdrop closes it.
- [ ] Role menus and kick work inside the drawer.
- [ ] Between 768px and 1023px (tablet), the button is visible and the drawer works.
- [ ] The desktop layout is unchanged.

## Expected Areas of Change
`web/src/components/ChatPanel.jsx`, `web/src/components/MemberList.jsx`, `web/src/App.jsx`.

## Working Set / Blast Radius
3 files.
