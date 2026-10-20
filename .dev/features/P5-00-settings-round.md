# P5-00 — Settings and menus round (October 2026, round 2)

- **Unit Type:** Container (children P5-01 … P5-06)
- **Phase:** 5 (design)
- **State:** PLANNED (settings map and all five recommendations agreed by the owner, 2026-10-19)
- **Effort:** 2 S-ish, 2 M, 2 L
- **Depends on:** nothing beyond main at `99c7991` (#157 merged)
- **Requirement Source:** `design/settings-review-2026-10/REVIEW.md`. The owner asked (2026-10-19) for settings that "land in appropriate places" without cluttering or confusing, menus that work well, and a strong graphical aesthetic, with kie.ai spend approved.

## Goal
Every setting lives where its effect lives: your Settings for you, Server settings for a server, channel settings for a channel, Site admin for the whole install. One settings kit makes every settings window look and behave the same. The 2,300 px Image generation form becomes six short pages.

## Children
| ID | Title | Size | Review items | State |
|---|---|---|---|---|
| P5-01 | Quick fixes: image overflow, member menu dismissal | S | B1, M1 | REVIEW |
| P5-02 | Settings kit and your settings | M | S1, S4, S5, S6, F1, A1 | PLANNED (after P5-01) |
| P5-03 | Site admin: General and Image generation pages | L | S2, S3, V2 | PLANNED (P5-02) |
| P5-04 | Server settings window and a short server menu | L | V1, V2, V3, V4 | PLANNED (P5-02) |
| P5-05 | Channel settings tabs and member menu header | M | C1, M2 | PLANNED (P5-02; P5-01 for the menu) |
| P5-06 | Sound set, image-generation art, shorter voice warning | M | A2, F2 (+ art for P5-03) | PLANNED (art lands after P5-03) |

## Cross-child dependencies and hot files
- P5-02 creates the kit (`settings/SettingsLayout.jsx`, `SettingRow.jsx`, `Switch.jsx`, `SaveBar.jsx`); P5-03, P5-04 and P5-05 use it, so they wait for it.
- `ChannelList.jsx` (server menu, voice panel, footer): P5-02 (footer via `UserFooter.jsx`), P5-04 (server menu), P5-06 (voice warning). One at a time.
- `MemberList.jsx`: P5-01 then P5-05.
- `ImagineAdmin.jsx`: only P5-03 (it is split into files there).
- `sounds.js`: only P5-06.

## Integration verification (before COMPLETE)
- Walk every settings window at 1024×768 and 375×812, dark and light: no jumps between sections, no horizontal page scroll, every section reachable.
- A non-admin member sees no Site admin group and only the server-settings sections their roles allow.
- axe-core on each settings window: no new violations.
- Web and server suites green; `vite build` clean.

## Discovered work (recorded, not planned)
- Members can't leave a server (needs a route).
- No change-password for a signed-in user (needs a route).
- Channels can't be renamed after creation (needs a route).

## Decisions
- 2026-10-19, the owner agreed the settings map and all five recommendations in the review's section 6:
  1. The settings map as proposed.
  2. Site admin stays inside Settings as its own group.
  3. The footer's sign-out icon becomes a Settings gear; Sign out moves to Settings › My account and the status menu.
  4. A save bar for site-admin, server and channel settings; personal settings apply instantly.
  5. A designed sound set replaces the sine beeps, with the synth kept as a fallback.
- Order: P5-01 first (the owner's choice), then P5-02 … P5-06.
