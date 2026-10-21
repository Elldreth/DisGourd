# P10-08 — New art and sound: "all clear", group scene, "privacy" poses; group glyph; two sounds

- **Unit Type:** Implementation (child of P10-00)
- **Phase:** 10
- **State:** COMPLETE (merged #201)
- **Effort:** S–M
- **Depends on:** P8-01
- **Serialize with:** P10-01 and P10-04 use its poses
- **Requirement Source:** `design/design-review-p10/REVIEW.md` section 4.

## Scope
- Three mascot poses in `mascotParts.js`: allClear (a lime check in the belly), privacy (a small shield), and a three-gourd group scene. They're drawn as SVG from kie.ai references; nothing generated ships.
- A "group" glyph plus three more tiles in `serverGlyphs.js` (also offered as group pictures if P10-04 adds that).
- Two sounds from kie.ai Suno "sounds", trimmed and peak-normalised as in P5: report-received (for moderators, on `reports_changed` when the count rises) and added-to-group. Each follows the message-sounds setting and has the synth fallback.
- Optional (decision 5): a looping mascot clip for the README, priced and shown before generating.

## Acceptance criteria
- [x] AC-1: the new poses follow the same rules as P8 (theme colours only, one-colour mode, under 5,000 characters).
- [x] AC-2: the sounds are each under 30 KB and play through the chosen output device.
- [x] AC-3: the PR lists every kie.ai generation and its cost (estimated about 33 credits).

## Expected Areas of Change
mascotParts.js, Mascot.jsx, serverGlyphs.js, sounds.js, web/public/sounds/, design/design-review-p10/refs/, tests.

## As built
- **Poses** (`mascotParts.js`):
  - **clear**: a lime check in the bubble and three sparkles.
  - **privacy**: a small shield in the bubble.
  - Both sit in the `POSES` table, so `<Mascot pose="clear" />` and `mascotSvg('privacy')` work like the others.
- **Group scene:** `groupParts()` with `GROUP_VIEWBOX`, and `groupSvg()` for static pages. Two smaller gourds (74%) flank the middle one, the left one mirrored so both face in. The middle bubble holds three dots, with chatter dots between them. `Mascot.jsx` gains `MascotGroup`.
- **`mascotSvg` and `groupSvg`** share one string drawer (`partsSvg`); the output is unchanged for the existing poses.
- **Tiles** (`serverGlyphs.js`):
  - **Group:** two speech bubbles, the front one with three dots. The first try (a bubble between two circles) read as a face with ears, so it was redrawn.
  - **Heart**, **Sports** (a ball) and **Camera**.
  - Sixteen tiles in all; the picker wraps as before.
- **Sounds** (`sounds.js`): `playReport()` (two soft knocks) and `playGroup()` (three rising notes), each with a synth fallback.
- **When they play** (`notify.js`):
  - Only with Message sounds on, and never in Do Not Disturb.
  - **Report:** `onSpaces(spaces)` plays it when a server's open-report count rises (`reportsRose`). The first look, and servers seen for the first time, don't count, so signing in is silent. App calls it whenever the server list changes.
  - **Group:** `useDms` gains `onAdded(conversation)`. It fires for a `dm_conversation` group frame that's new to you and whose owner isn't you, so a group you make, or an update to one you're in, stays quiet. The sound is skipped for a muted group.
- **Sound cuts:** the automatic trim keeps only the first event (a single knock or note), so both files were cut by hand. `design/sounds/PROMPTS.md` has the details.
- **Not used yet:** the poses and the group scene wait for P10-01 (empty queue), P10-02 (empty Blocked list) and P10-04 (the group welcome and group pictures).

## kie.ai spend
- **References** (nano-banana, 4 credits each): 4 images, 16 credits, in `design/design-review-p10/refs/` as 640 px JPEGs, each with its prompt. Nothing generated ships.
- **Sounds** (Suno "sounds" V6_MINI, 2.5 credits per request): 2 requests, 5 credits.
- **Total: 21 credits** (estimate was about 33).

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | `ArtPass.test.jsx` + render | Nine poses: theme variables only, under 5,000 characters. The group scene too, with the left gourd mirrored. Sheet in dark, light and one colour, with the 16 tiles: `design/design-review-p10/shots/p10-08-poses-and-tiles.jpg` |
| AC-2 | Verified | Files + `sounds.test.js` + sandbox | `report.ogg` 2.0 KB, `group.ogg` 3.5 KB. Each has its own file, with the fallback. Live on :3005 with this branch's app (:5175) as sandy, with Message sounds on: cara's report fetched `/sounds/report.ogg`, and bob adding sandy to "P10 Sound Check" fetched `/sounds/group.ogg` |
| AC-3 | Verified | This packet and the PR | 21 credits, listed above |
| Rules | Verified | `notify.test.js`, `useDms.test.js` | Rises only after the first look; new servers don't chime. A group you made, or an update, doesn't call `onAdded` |
| Suites | Verified | Vitest, Jest, Vite | Web 104 files / 821 tests; server 53 suites / 461 tests; `vite build` clean |

## Not checked
- What the sounds sound like through real speakers: the browser pane has no audio out. The files are in `web/public/sounds/` to listen to.

## Not in scope
Anything not listed above. Other findings in the review belong to their own pass.
