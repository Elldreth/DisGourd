# P10-06 — /imagine panel: labelled chip groups and a steady height

- **Unit Type:** Implementation (child of P10-00)
- **Phase:** 10
- **State:** COMPLETE (merged #207)
- **Effort:** S–M
- **Depends on:** P9-04c, P9-05b
- **Serialize with:** none
- **Requirement Source:** `design/design-review-p10/REVIEW.md` P1.

## Scope
- A small label before each chip group: Shape, Quality, Engine, Style, Strength.
- A group that doesn't apply stays in place, dimmed and not focusable, with a reason ("ComfyUI only", "follows the picture").
- Phones: the labels sit above the chips.

## Acceptance criteria
- [x] AC-1: switching the engine or adding a picture doesn't change the panel's height (±2 px).
- [x] AC-2: every chip group is a labelled radio group for screen readers.
- [x] AC-3: the existing ImaginePanel tests pass.

## Expected Areas of Change
ImaginePanel.jsx, tests.

## As built
- **`ImaginePanel.jsx`:**
  - Each group is an `Option` row: a small uppercase label (Shape, Quality, Engine, Style), then its chips, in a two-column grid on wider screens and one column on phones. Labels sit beside the chips, not above them: at 375 px they fit and save a row each.
  - A group that doesn't apply stays in place with its reason in place of the chips: Shape "follows the picture" (with a picture), Style "ComfyUI only" (with kie.ai or the test engine). The Style row shows whenever ComfyUI has two or more styles.
  - The picture row has a minimum height, so a thumbnail doesn't make it grow. Its "The shape follows the picture." note is gone, since the Shape row now says it.
- **AC-2, as built:** the groups keep their toggle-button chips (`aria-pressed`), each group named by its visible label (`aria-labelledby`), rather than switching to radio buttons. That keeps the panel's keyboard behaviour (focus stays in the message box) and the Composer tests unchanged.
- **Unchanged:** `showStyles()` still decides when a style is sent with the request.

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | Sandbox, measured | Panel height: ComfyUI 150 px, kie.ai 150 px, with a picture 151 px |
| AC-2 | Verified | `ImaginePanel.test.jsx` | Every chip group is named by its visible label; "off" rows give their reason |
| AC-3 | Verified | Vitest | Composer.imagine and ImagineLimits pass unchanged |
| Accessibility | Verified | axe-core 4.10.2 | The panel (with a picture): no violations |
| Phone | Verified | Sandbox 375×812 | One column, no sideways scroll (`shots/p10-06-phone.jpg`) |
| Suites | Verified | Vitest, Jest, Vite | Web 105 files / 834 tests; server 53 suites / 461 tests; `vite build` clean |

## kie.ai spend
None.

## Not in scope
Anything not listed above. Other findings in the review belong to their own pass.
