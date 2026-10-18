# P2-21d — Role colours in names and member-list grouping

- **Unit Type:** Implementation (child of P2-21)
- **Phase:** 2
- **State:** REVIEW
- **Effort:** S
- **Depends on:** P2-21c (roles, colours and holders reach the client)
- **Starting baseline:** main at b15cd6a (P2-21c merged, #117)
- **Serialize with:** `MessageList.jsx`, `MemberList.jsx`, `App.jsx`, `useSpaces.js`

## Why
Roles can have colours since P2-21c, but nothing uses them: names in chat all look alike, and the member list is one long Online / Offline roster.

## Scope
- **Name colour:** a member's name takes the colour of their highest role that has one (Discord's rule). No coloured role, no colour (the usual text colour).
- **Readable in both themes:** any colour someone picks is adjusted only as much as needed to reach WCAG AA (4.5:1) against every surface names sit on in that theme (ink-600 … ink-900 and the "mentions you" tint): lightened in the dark theme, darkened in the light one. Each name carries both versions as CSS variables and the stylesheet picks by theme, so switching themes needs no re-render. Colours that already pass are untouched.
- **Where:** author names in the channel's messages (MessageList, which the thread panel also uses), the thread panel's root message, pinned messages, and the member list. Only inside a server: DMs and cross-server search results stay uncoloured.
- **Member-list grouping:** online members are grouped under their highest role (roles in order, with the count), then "Online" for members with no role; offline members stay together under "Offline". Groups with nobody online are left out.

## Non-goals
- A per-role "show separately" (hoist) switch; every role groups for now.
- Colouring names in search results (they span servers), mentions or replies.

## Acceptance criteria
- [x] `roleColor.test.jsx`: the adjusted colour reaches 4.5:1 on every surface in each theme for the preset colours and extremes (black, white, pure yellow, pure blue); a colour that already passes is unchanged; the surface constants match `index.css`.
- [x] A name takes the colour of the highest coloured role (skipping uncoloured roles above it); no coloured role means no colour; DMs are uncoloured.
- [x] Member list: online members grouped by highest role in role order with counts, then Online, then Offline; names coloured.
- [x] All existing suites pass; `vite build` clean.
- [x] Sandbox (sandbox DB only): with Mods coloured and given to bob, bob's name shows in that colour in chat and in the member list under a Mods group, in both themes.

## Expected Areas of Change
`web/src/roleColor.js` (new) + `roleColor.test.jsx`, `web/src/index.css` (one rule), `web/src/state/useSpaces.js`, `web/src/components/RoleName.jsx` (new: context + name span), `MessageList.jsx`, `ThreadPanel.jsx`, `PinsPanel.jsx`, `MemberList.jsx`, `App.jsx`.

## Working Set / Blast Radius
~10 web files, display only; no server change.

## Implementation notes
- `roleColor.js`: `readableColor(hex, theme)` mixes the colour towards white (dark) or black (light) in 5% steps until it reaches 4.5:1 on every surface in `SURFACES[theme]`; `memberColor` / `nameColors` pick the highest coloured role. `useSpaces` memoises `nameColors` from members and roles.
- `RoleName` reads a `RoleColorsContext` (App provides it around the server view; the thread panel gets an empty map when its thread belongs to another server) and sets `--name-dark` / `--name-light`; the unlayered `.role-name` rule in `index.css` picks by `[data-theme]`, so a theme switch needs no re-render and beats the `text-gray-*` utility.
- `MemberList` builds the online groups from the roles (highest first), skipping empty ones; the badge stays (it still names the role for offline members).

## Discovered work
- **Fixed here (found in the sandbox check, P2-21c code):** the member Roles… checklist disabled every box while a change saved, which dropped keyboard focus to the page so Esc no longer closed it; the Roles screen's Move up / Move down and Remove did the same. They now stay enabled and ignore clicks while a change is saving (`roles` test "keeps keyboard focus…").

## Evidence (2026-10-18)
| Acceptance criterion | Evidence |
|---|---|
| Readable in both themes | `roleColor.test.jsx`: the surface constants equal ink-600…900 in `index.css` for both themes; the nine presets plus black, white, yellow, blue, red, green and the brand colour all reach ≥ 4.5:1 on every surface in both themes; `#ffc53d` (dark) and `#1a1430` (light) come back unchanged; pure blue on dark is adjusted; a non-hex gives null |
| Highest coloured role | Same file: an uncoloured role above is skipped (Mods' blue wins over Plain), no coloured role → none; `RoleName` sets both variables through the context and stays plain without a provider (DMs) |
| Member-list grouping | Same file: headers read Plain — 1, Mods — 1, Helpers — 1, Online — 1, Offline — 1 (role order, empty groups dropped, the owner with no role under Online); bob's name carries `role-name`, eve's (uncoloured role) doesn't |
| Suites | Web: 64 files, 562 tests (one existing file edited: the new focus test added to `RolesDialog.test.jsx`); server: 280 tests unchanged; `vite build` clean |
| Sandbox (sandbox DB only) | As sandy on Tx Check, gave bob the blue Mods role through his Roles… checklist. Dark theme: bob's name in #staff and in the member list computed to rgb(0, 144, 255) (#0090ff, unchanged), and with bob signed in on a second tab the list read MODS — 1 (bob), ONLINE — 1 (sandy), OFFLINE — 1 (cara). Light theme (Settings → Appearance → Light): the same names computed to rgb(0, 101, 179) (#0065b3, the darkened version). Theme set back to Dark afterwards |
