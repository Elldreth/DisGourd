# P5-06 — Sound set, image-generation art and a shorter voice warning

- **Unit Type:** Implementation (child of P5-00)
- **Phase:** 5
- **State:** REVIEW (PR open, 2026-10-20; AC-1 waits for the owner to listen)
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
- [x] AC-2: with a sound file missing (network blocked in a test), the synth tone plays instead and nothing throws.
- [x] AC-3: sounds still respect DND, the message-sound switch and the join/leave switch (existing tests green).
- [x] AC-4: the art renders in both themes and in one colour, and is under 5 KB inline.
- [x] AC-5: the voice warning is one line at 240 px wide and its link opens the Voice & video section.

## Expected Areas of Change
`web/src/sounds.js`, `web/public/sounds/*` (new), `design/sounds/*` (new), the Overview page from P5-03, `ChannelList.jsx` (voice warning), tests.

## Working Set / Blast Radius
4–5 files plus assets.

## Testing Strategy
Unit tests for the fallback path with a mocked `Audio`/`fetch`; listen in the sandbox (the pane plays audio out).

## Out of Scope
Music and video (the review explains why).

## Starting Baseline
Revision: `87c3ac2` (main after #163). Web suite before: 87 files / 718 tests.

## Implementation notes
- **Sounds:**
  - kie.ai Suno "Generate sounds" (`ai-music-api/sounds`, V6_MINI): 6 requests × 2 takes, 15 credits.
  - `design/sounds/tools/trim_sounds.py` cuts each take to its first event (chimes ≤1.0 s, pops ≤0.45 s), fades the end, peak-normalises (chimes −6 dBFS, pops −9 dBFS) and encodes Ogg/Opus 32 kb/s mono.
  - I first used loudness normalisation, but on clips this short it pushed two pops to 0 dBFS. I caught that in the sandbox and switched to peak normalisation.
  - Chosen takes are in `web/public/sounds/` (19.4 KB together). All twelve takes are in `design/sounds/takes/`, with `PROMPTS.md`.
- **Choosing by ear:** I can't listen, so I chose by measurement: a clean single event, the natural length and the level. peer-join take 1 was too quiet and short. The owner picks by ear on the listen page: https://claude.ai/artifact/Hkuvut8ZdRGJCMimQ2ywd3 (private; both takes for each sound, plus the old beep at the level the app used).
- **`sounds.js`:**
  - `route()` sends any WebAudio graph to the preferred output device, as before. `playSound()` fetches and decodes `/sounds/<name>.ogg` once.
  - Any failure (HTTP error, network error, an undecodable file) plays the old tones. No MP3 copy: older Safari may not decode Ogg/Opus, and gets the old tones instead.
  - The speaker test reuses "join". Callers are unchanged, so DND, the message-sound switch and the join/leave switch still gate everything.
- `server/static.js` serves `.ogg` as `audio/ogg`. `devProxy.test.js` now skips folders in `web/public` (`/sounds` is served by Vite, not the API).
- **Art:** nano-banana references (2 × 4 credits) in `design/settings-review-2026-10/art/`, as 512 px JPEGs, with `PROMPTS.md`. The shipped scene is `ART.imagine` in `EmptyState.jsx`: the gourd mark, an easel, a blank canvas and a lime-tipped brush, drawn only with theme colours. It shows on Image generation › Overview while neither engine is on (as saved), with a "Set up ComfyUI" button that opens the ComfyUI page.
- **Voice warning:** one line, "No microphone: listening only.", plus a "Why?" button (with a tooltip giving the usual reasons) that opens Settings › Voice & audio. That page asks for microphone access. `App` gained `openProfile(section)` and passes `initialSection` to Settings. My first wording ("you can listen but not speak") was cut off in the 240 px sidebar in the sandbox, so I shortened it.

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Partly verified: the owner still has to listen | Measurement + listen page | Every file is under 15 KB (largest 5.0 KB) and at most 1.0 s long (chimes 1.00 s, pops 0.20–0.45 s). Peaks after encoding are −3.6 to −6.7 dBFS. **The owner's review by ear** is the listen page above; the PR stays open for that |
| AC-2 | Verified | `sounds.test.js` | A 404, a network error and an undecodable file each play the synth tones without throwing. A good file plays through a buffer source and is fetched once |
| AC-3 | Verified | Existing tests | The callers (`notify.js`, `voice.js`, the settings previews) are unchanged; their DND, sound-switch and join/leave tests pass. Full web suite 89 files / 724 tests |
| AC-4 | Verified | Test + sandbox | `EmptyState.test.jsx`: theme variables only, no literal colours, under the size limit. Sandbox: shown in dark and light (`shots/p5-06-imagine-art-*.jpg`). I turned both engines off to show it, then back on, and the server confirmed it |
| AC-5 | Verified | Test + sandbox | It fits on one line in the 240 px sidebar (`scrollWidth ≤ clientWidth`), and "Why?" opened Settings at Voice & audio (`shots/p5-06-voice-warning.jpg`, `p5-06-why-opens-voice-audio.jpg`) |
| In the browser | Verified | Sandbox (Chrome in the pane) | All six files return 200 `audio/ogg` from the dev server and decode; `playMention()` ran without error. The pane can't be heard, so actual playback by ear is the owner's check |
