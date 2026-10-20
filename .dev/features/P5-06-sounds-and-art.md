# P5-06 — Sound set, image-generation art and a shorter voice warning

- **Unit Type:** Implementation (child of P5-00)
- **Phase:** 5
- **State:** PLANNED (owner decision 5; the art needs P5-03's Overview page)
- **Effort:** M
- **Depends on:** P5-03 for the art placement only
- **Serialize with:** anything editing `sounds.js`, `ChannelList.jsx` (voice panel)
- **Requirement Source:** `design/settings-review-2026-10/REVIEW.md` A2, F2 and the "Generated assets" table. kie.ai spend approved by the owner for this round.

## Scope
- **Sounds:** five sounds made with kie.ai's sound-effects generation: you joined, you left, someone joined, someone left, mention/DM, plus a soft message blip (the speaker test reuses "you joined"). Trimmed and encoded to Ogg/Opus (with an MP3 fallback only if Safari needs it), each under 15 KB, in `web/public/sounds/`. `sounds.js` plays the file through the preferred output device and falls back to today's synth tones when a file can't load. The prompts, the raw downloads and the chosen takes are kept under `design/sounds/` with `PROMPTS.md`.
- **Art:** one flat illustration (a gourd at an easel) for Image generation › Overview when no engine is on, drafted with kie.ai nano-banana and redrawn as inline SVG in the `EmptyState` style (under 5 KB). Drafts under `design/settings-review-2026-10/art/`.
- **Voice warning:** the five-line "No microphone…" note becomes one line with a "Why?" link that opens Settings › Voice & video.

## Acceptance criteria
- [ ] AC-1: each sound file is under 15 KB and under 1 s; the set is reviewed by the owner (listen page or files attached to the PR) before it ships.
- [ ] AC-2: with a sound file missing (network blocked in a test), the synth tone plays instead and nothing throws.
- [ ] AC-3: sounds still respect DND, the message-sound switch and the join/leave switch (existing tests green).
- [ ] AC-4: the art renders in both themes and in one colour, and is under 5 KB inline.
- [ ] AC-5: the voice warning is one line at 240 px wide and its link opens the Voice & video section.

## Expected Areas of Change
`web/src/sounds.js`, `web/public/sounds/*` (new), `design/sounds/*` (new), the Overview page from P5-03, `ChannelList.jsx` (voice warning), tests.

## Working Set / Blast Radius
4–5 files plus assets.

## Testing Strategy
Unit tests for the fallback path with a mocked `Audio`/`fetch`; listen in the sandbox (the pane plays audio out).

## Out of Scope
Music and video (the review explains why).

## Starting Baseline
To be recorded at activation.
