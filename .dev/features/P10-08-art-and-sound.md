# P10-08 — New art and sound: "all clear", group scene, "privacy" poses; group glyph; two sounds

- **Unit Type:** Implementation (child of P10-00)
- **Phase:** 10
- **State:** PLANNED
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
- [ ] AC-1: the new poses follow the same rules as P8 (theme colours only, one-colour mode, under 5,000 characters).
- [ ] AC-2: the sounds are each under 30 KB and play through the chosen output device.
- [ ] AC-3: the PR lists every kie.ai generation and its cost (estimated about 33 credits).

## Expected Areas of Change
mascotParts.js, Mascot.jsx, serverGlyphs.js, sounds.js, web/public/sounds/, design/design-review-p10/refs/, tests.

## Not in scope
Anything not listed above. Other findings in the review belong to their own pass.
