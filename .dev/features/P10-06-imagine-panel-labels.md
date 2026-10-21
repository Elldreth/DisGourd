# P10-06 — /imagine panel: labelled chip groups and a steady height

- **Unit Type:** Implementation (child of P10-00)
- **Phase:** 10
- **State:** PLANNED
- **Effort:** S–M
- **Depends on:** P9-04c, P9-05b
- **Serialize with:** none
- **Requirement Source:** `design/design-review-p10/REVIEW.md` P1.

## Scope
- A small label before each chip group: Shape, Quality, Engine, Style, Strength.
- A group that doesn't apply stays in place, dimmed and not focusable, with a reason ("ComfyUI only", "follows the picture").
- Phones: the labels sit above the chips.

## Acceptance criteria
- [ ] AC-1: switching the engine or adding a picture doesn't change the panel's height (±2 px).
- [ ] AC-2: every chip group is a labelled radio group for screen readers.
- [ ] AC-3: the existing ImaginePanel tests pass.

## Expected Areas of Change
ImaginePanel.jsx, tests.

## Not in scope
Anything not listed above. Other findings in the review belong to their own pass.
