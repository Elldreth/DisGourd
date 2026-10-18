# P3-23 — /imagine Retry and Variations

- **Unit Type:** Implementation
- **Phase:** 3
- **State:** COMPLETE (merged #134)
- **Effort:** S–M
- **Depends on:** P2-20 (/imagine), P3-21 (limit wording)
- **Starting baseline:** main at 01f275a (#133 merged)
- **Requirement Source:** the user, 2026-10-18: "Retry and Variations buttons would be nice". Decisions (user, 2026-10-18):
  - **Variations** makes new takes of the same prompt and options (a new random seed), not image-to-image.
  - **Anyone** who may use /imagine in that channel can press the buttons. A press counts against the presser's own daily limit, and the new image is posted under their name.

## Scope
- **Server:** the `imagine` op takes `from: <messageId>` in place of a prompt.
  - It looks up the job behind that bot message (`imagine_jobs.message_id`).
  - The job must be in the same server and channel (or thread) as the request, and must be finished (`done` or `failed`). Otherwise it's refused with `NOT_FOUND`: "That image request can't be repeated".
  - It copies the job's prompt, shape and quality. It uses the job's engine if that engine is still switched on; otherwise it uses the default engine.
  - Every usual check still applies: membership, posting rights, server switch, permission, daily limit, prompt check and budget.
- **App:**
  - On the /imagine bot's messages, a finished image shows a **Variations** button ("Make another take of this prompt"), and a failed one shows a **Retry** button.
  - The buttons show only when /imagine is available to you there (`imagine.available`).
  - Pressing one sends `{ from: id }`. A refusal (for example the daily limit) shows next to the buttons.
  - Detecting the messages: the bot's text comes only from `runner.text` ("🎨 **name** imagined: …" with an image, or "⚠️ Couldn't imagine that for **name**: …"). The app matches those, so no schema change is needed.

## Acceptance criteria
- [x] Server: `from` on a finished job queues a new job with the same prompt, shape and quality, under the presser's name, and it counts toward their limit. A failed job can be retried. Refused: another channel's message, an unknown id, a non-imagine message, a job still running. The limit applies.
- [x] Web: Variations on a finished image, Retry on a failed one, nothing on ordinary messages or while /imagine isn't available; a press calls `run({ from: id })`; a refusal is shown.
- [x] All suites pass; `vite build` is clean.
- [x] Sandbox (fake engine): Variations on an image posts a new image with the same prompt; the "left today" count drops.

## Discovered Work
- (none yet)
