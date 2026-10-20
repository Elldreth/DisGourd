# P5-00 — Settings and menus round (October 2026, round 2)

- **Unit Type:** Container (children P5-01 … P5-06)
- **Phase:** 5 (design)
- **State:** COMPLETE (2026-10-20; all six children merged, #159–#164; integration check below)
- **Effort:** 2 S-ish, 2 M, 2 L
- **Depends on:** nothing beyond main at `99c7991` (#157 merged)
- **Requirement Source:** `design/settings-review-2026-10/REVIEW.md`. The owner asked (2026-10-19) for settings that "land in appropriate places" without cluttering or confusing, menus that work well, and a strong graphical aesthetic, with kie.ai spend approved.

## Goal
Every setting lives where its effect lives: your Settings for you, Server settings for a server, channel settings for a channel, Site admin for the whole install. One settings kit makes every settings window look and behave the same. The 2,300 px Image generation form becomes six short pages.

## Children
| ID | Title | Size | Review items | State |
|---|---|---|---|---|
| P5-01 | Quick fixes: image overflow, member menu dismissal | S | B1, M1 | COMPLETE (#159) |
| P5-02 | Settings kit and your settings | M | S1, S4, S5, S6, F1, A1 | COMPLETE (#160) |
| P5-03 | Site admin: General and Image generation pages | L | S2, S3, V2 | COMPLETE (#161) |
| P5-04 | Server settings window and a short server menu | L | V1, V2, V3, V4 | COMPLETE (#162) |
| P5-05 | Channel settings tabs and member menu header | M | C1, M2 | COMPLETE (#163) |
| P5-06 | Sound set, image-generation art, shorter voice warning | M | A2, F2 (+ art for P5-03) | COMPLETE (#164) |

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

## Integration verification (done 2026-10-20, on main after #164)
Sandbox only: the sandbox server on :3005, with a dev server on the branch (main plus this PR's one fix) on :5175.

| Check | Result |
|---|---|
| Every settings window at 1024×768, dark and light | Scripted walk: Settings (11 sections), Server settings (6) and Channel settings (3), every section opened in turn. The section list never moved (same box on every section), and no page or panel scrolls sideways, in both themes |
| Every settings window at 375×812, dark and light | All 20 sections open (through the list and Back on phones); no sideways scroll; Settings and Server settings fill the screen |
| A non-admin member | bob (Mods: invite and pin only) sees My account, Voice & audio, Notifications and Appearance, with no Site admin group. The server menu offers only Invite people, with no Server settings item, since he has nothing to manage. I gave Mods "Delete others' messages" for a moment: after a reload, bob's menu offered Server settings with only Moderation log, which loaded the log (`shots/p5-00-bob-moderation-log-only.jpg`, taken as the window opened). Then I set Mods back to pin only |
| axe-core 4.10.2 (titles stripped first) | One minor finding: the Image generation Overview's engine cards were `<button role="listitem">` (aria-allowed-role). Fixed in this PR with a real list of buttons. After the fix: no violations on any section of the three windows, nor on the main screen with the member menu open |
| Suites | Web 89 files / 724 tests; server 42 suites / 402 tests; `vite build` clean |

## Round summary
- **Your settings:** a fixed-size window; on phones, a list first and then a page; My account with status and Sign out; switches; a gear in the footer.
- **Site admin:** General, plus Image generation as an Overview and five short pages sharing one save bar, with "Discard changes?" on close.
- **Server settings:** one window replaces eleven menu items, with sections gated by permission and grouped role permissions.
- **Channel settings:** three tabs at a fixed height. The member menu has a header and a moderation group.
- **Media:** designed sounds (the old beep stays as a fallback), "not set up" art, and a one-line mic warning.
- **Fixes:** image overflow on narrow screens and phones; the member menu now closes on Escape or a click outside.
- **kie.ai spend for the round:** 15 credits (sounds) + 8 (art references).
