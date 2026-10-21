# P13-02 — kie.ai failures in plain words, one free retry, and a log line

- **Unit Type:** Implementation
- **Phase:** 13 (small fixes found on the live server)
- **State:** COMPLETE (merged in #227)
- **Effort:** S
- **Depends on:** none
- **Starting baseline:** main after #225
- **Requirement Source:** the owner, 2026-10-21. On the live server, `/imagine` with Nano Banana 2 on High answered "⚠️ Couldn't imagine that for elldreth: kie.ai: generate task timeout". Their words: "I'd definitely like a clearer message on what went wrong when it comes to the kie.ai service. I'm not sure if it's something we're sending incorrectly or if it is actually a timeout. Are we dropping connection after a period of time? Do we need to increase that? Is it really a kie.ai issue?"

## What happened (diagnosed live)
- **The container reaches kie.ai.** A credit check from inside it answered in 220 ms, with the key from the secret file accepted.
- **The request matches kie.ai's documentation** for `nano-banana-2`: prompt, `aspect_ratio`, `resolution: "2K"`, `output_format: "png"` and `image_input: []` (docs.kie.ai/market/google/nanobanana2).
- **The message came from kie.ai's task record:** `state: "fail"`, `failMsg: "generate task timeout"`. kie.ai accepted the task, and its model then failed on kie.ai's side.
- **DisGourd's own 5-minute limit wasn't involved.** That limit produced a different message, "it took too long".
- **Nothing was logged on the server for a failed job**, so `docker logs` showed nothing.

## As built
- **`server/imagine/engines/kie.js`:**
  - **`taskFailed()`** turns kie.ai's `failMsg` into plain words, naming the model:
    - **Timeout:** "kie.ai's Nano Banana 2 ran out of time on kie.ai's own servers ("generate task timeout"). The request was fine; try again, or a lower quality."
    - **Internal or busy errors:** "kie.ai's … hit a problem on kie.ai's side ("…"); try again in a moment."
    - **Anything else:** "kie.ai couldn't make it with …: …".
    - Refusals are unchanged.
    - When kie.ai reports `creditsConsumed: 0`, the message adds "No credits were used".
  - **One automatic retry:** for a timeout or internal error that kie.ai says cost nothing, `generate()` starts one more task. If that fails too, the message ends "(tried twice)". Refusals, charged failures and other failures aren't retried. The retry stays inside the job's overall time limit.
  - **A download failure now says** "kie.ai made the image, but downloading it failed (…)".
  - **The server log** records each failed kie.ai task as `[imagine] kie.ai task <id> (<model>) failed: <failCode> <failMsg>`, so the task can be looked up in kie.ai's dashboard.
- **`server/imagine/runner.js`:**
  - **DisGourd's own limit** now reads "DisGourd stopped waiting after 5 minutes (the image engine hadn't finished)" instead of "it took too long".
  - **Every failed job is logged:** `[imagine] job <id> (<engine>) failed after <n>s: <reason>`.
  - The "Couldn't imagine that for **name**:" prefix is unchanged, because Retry and ImagineAgain read it.

## Acceptance criteria
- [x] AC-1: kie.ai's timeout and internal-error failures say they happened on kie.ai's side, name the model, and suggest what to try.
- [x] AC-2: such a failure that cost nothing is retried exactly once, and a retry that succeeds returns the image.
- [x] AC-3: refusals and other failures aren't retried.
- [x] AC-4: DisGourd's own time limit says so, in minutes or seconds.
- [x] AC-5: every failed job, and every failed kie.ai task with its id, is in the server log.

## Evidence (2026-10-21)
| Criterion | Evidence |
|---|---|
| AC-1–3 | `imagine-kie.test.js`: the mock kie.ai returns `generate task timeout` (creditsConsumed 0). `[timeout]` → 2 createTask calls, then the full message ending "No credits were used (tried twice)". `[timeout-once]` → the image. `[refuse]` → REFUSED with 1 call. `[broken]` → "hit a problem on kie.ai's side". `[odd]` → "couldn't make it with Z-Image: prompt too long. No credits were used" |
| AC-4 | `imagine.test.js`: the hung job's message ends "DisGourd stopped waiting after N seconds (the image engine hadn't finished)" |
| AC-5 | The log lines show in the Jest console output for those tests |
| Suites | Server 581 tests, web 855 tests |
| Live | Not run against the real kie.ai: that would spend credits. The owner's own failure is the live case; the next one will show the new wording and a log line |

## Discovered Work (not done)
- **A configurable time limit:** `IMAGINE_TIMEOUT_MS` already lets the owner raise DisGourd's own limit through the environment. It isn't needed for this failure, which was kie.ai's limit.
- **Showing the kie.ai task id in the message** (for site admins only) would make dashboard lookups quicker; it's in the log for now.
