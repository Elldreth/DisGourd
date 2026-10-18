# P3-21 — Say where the /imagine daily limit comes from

- **Unit Type:** Implementation
- **Phase:** 3
- **State:** COMPLETE (merged #132)
- **Effort:** S
- **Depends on:** P2-20a / P2-20d (limits, server dialog), P2-20b (Settings section)
- **Starting baseline:** main at ca68b0b (#131 merged)
- **Requirement Source:** the user, 2026-10-18. They hit "You've used all 10 images for today", raised Settings → Image generation from 20 to 30, and still couldn't generate: Tx Check had its own limit of 10, which overrides the instance default, and nothing on screen said so.

## Scope
- **Server:** `limitInfo(spaceId)` returns `{ limit, source }`:
  - `server`: the server's own number;
  - `instance`: the instance default;
  - `ceiling`: either one, capped by the instance ceiling.
- **The refusal names its source,** e.g.:
  - "You've used all 10 images for today. Tx Check sets its own limit of 10 a day (server menu → Image generation)."
  - "…This instance allows 30 a day (Settings → Image generation)."
  - "…The instance's maximum is 100 a day."
- `GET /spaces` adds `imagine.limitSource`.
- **Admin view:** `serverLimits: [{ space, limit }]` lists every server with its own limit.
- **App:**
  - The /imagine panel's "used up" reason says the same as the server.
  - **Settings → Image generation**, under "Images per person per day": "These servers set their own limit, which takes priority: Tx Check — 10 a day. Change it in that server's menu → Image generation."
  - The **server dialog** says what the instance default is ("Leave blank to use the instance default (30)"), which it already shows in the placeholder, and that a number here takes priority over it.

## Acceptance criteria
- [x] Server tests: the LIMIT refusal says server / instance / ceiling as appropriate; `GET /spaces` has `limitSource`; the admin view lists `serverLimits`, and drops a server once its own limit is cleared.
- [x] Web tests: the panel's used-up reason names the server's own limit vs the instance default; Settings lists servers with their own limit (and nothing when there are none).
- [x] All suites pass; `vite build` is clean.
- [x] Sandbox: with Tx Check at 10 and the default at 30, Settings shows "Tx Check — 10 a day", and the chat panel's reason names Tx Check's own limit.

## Implementation notes
- `GET /spaces` also sends `instanceLimit` (the default a blank server limit falls back to), so the server dialog can say "instance default (30 a day)" even while the server has its own number.
- The Settings hint used to say servers "can set a lower number". They can set a higher one too, up to the ceiling, which was part of the confusion. It now reads "A server can set its own number (up to 100), which takes priority."
- **Fixed a flaky test** (`imagine-kie.test.js`, "stopping a job stops the polling"): a status check already on its way to the mock when the job stopped could still land and be counted. The test now lets that one arrive before checking that no more follow. Before: 3 failures in about 8 runs of the image suites; after: 0 in 10.

## Evidence (2026-10-18)
| Acceptance criterion | Evidence |
|---|---|
| Server | `imagine.test.js` new test: with the server's own limit, the refusal reads "You've used all N images for today. Previews sets its own limit of N a day (server menu → Image generation)", and `GET /spaces` has `limitSource: 'server'` and `instanceLimit`; `serverLimits` lists the server. With the default: "…This instance allows N a day (Settings → Image generation)", `limitSource: 'instance'`, `serverLimits` empty. Over the ceiling: "…That's this instance's maximum of N a day", `limitSource: 'ceiling'` |
| Web | `ImagineLimits.test.jsx` (3): the panel's reasons for server / instance / ceiling; Settings lists "Tx Check — 10 a day" and "Smoke Test — 50 a day" under "These servers set their own limit, which takes priority", and nothing when there are none; the new hint text; the server dialog's placeholder "Instance default (30)" and "Leave blank to use the instance's default (30 a day, set in Settings → Image generation). A number here takes priority over it." |
| Suites | Server: 321 tests. Web: 73 files, 608 tests. `vite build` clean |
| Sandbox | After the user's own change (Tx Check at 20, default 30): `GET /spaces` gave `dailyLimit 20, limitSource 'server', instanceLimit 30, usedToday 10`. Settings → Image generation showed "These servers set their own limit, which takes priority: Tx Check — 20 a day · Change one in that server's menu → Image generation (blank uses this default)" and "The default for every server. A server can set its own number (up to 100), which takes priority." |
