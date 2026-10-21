# P13-03 — kie.ai safety blocks said plainly, without a doubled full stop

- **Unit Type:** Implementation
- **Phase:** 13 (small fixes found on the live server)
- **State:** COMPLETE (merged in #230)
- **Effort:** S
- **Depends on:** P13-02
- **Starting baseline:** main after #229
- **Requirement Source:** the owner, 2026-10-21. After P13-02 went live, a Flux-2 Pro image of a woman in a bikini failed with "⚠️ Couldn't imagine that for elldreth: kie.ai couldn't make it with Flux-2 Pro: The generated images appear to be unsafe. Try modifying the prompts.. No credits were used". Their words: "Yes, fix it: recognise kie.ai safety blocks like "unsafe" and word them clearly, and drop the doubled period."

## Problem
- **The refusal pattern** (`REFUSAL` in `server/imagine/engines/kie.js`) didn't include "unsafe", so Flux's block looked like a general failure.
- **When a refusal was recognised,** the runner replaced its text with "the engine refused this prompt", which lost kie.ai's reason and the cost note.
- **kie.ai's text ends with its own full stop,** and ". No credits were used" doubled it.

## As built
- **`REFUSAL`** now also matches `unsafe`, `explicit` and `harmful`.
- **`taskFailed()`** trims trailing whitespace and full stops from kie.ai's text before quoting it, in every message.
- **A safety block** becomes `REFUSED`, with "kie.ai's safety filter blocked this one on <model> ("<kie.ai's reason>")" followed by advice that fits the case:
  - **The model's filter can be switched** (it has `safety`) **in a normal channel:** "Try rewording, or post in an 18+ channel, where DisGourd turns this model's filter off."
  - **Already in an 18+ channel:** "This happened with the filter already off for this 18+ channel; try rewording."
  - **The filter can't be switched** (Nano Banana 2): "<model>'s filter can't be turned off; try rewording, or another model."

  Plus "No credits were used" when kie.ai says so. A safety block is never retried.
- **`server/imagine/runner.js`:** a `REFUSED` error shows its own message, falling back to "the engine refused this prompt". This also makes ComfyUI's "That address isn't allowed for ComfyUI" show as written.

## Acceptance criteria
- [x] AC-1: Flux's "The generated images appear to be unsafe. Try modifying the prompts." is recognised as a safety block, and isn't retried.
- [x] AC-2: the advice fits the model and the channel (switchable filter in a normal channel, in an 18+ channel, and not switchable).
- [x] AC-3: no message ends a quote with a doubled full stop.
- [x] AC-4: the chat message shows the full safety wording.

## Evidence (2026-10-21)
| Criterion | Evidence |
|---|---|
| AC-1–3 | `imagine-kie.test.js` "P13-03": the mock returns Flux's exact text (full stop included, creditsConsumed 0). Flux-2 Pro in a normal channel, then permissive, then Nano Banana 2, each give the expected full message. 1 createTask call (no retry). No `..` |
| AC-4 | `imagine-kie.test.js` (the chat flow): a `[unsafe]` job's bot message reads "⚠️ Couldn't imagine that for **admin**: kie.ai's safety filter blocked this one on … ("The generated images appear to be unsafe. Try modifying the prompts"). … No credits were used" |
| Suites | Server 616 tests, web 862 tests |
| Live | Not re-run against kie.ai (credits). The owner's failure is the live case |
