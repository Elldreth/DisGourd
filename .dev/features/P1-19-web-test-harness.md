# P1-19 — Web unit-test harness (Vitest)

- **Unit Type:** Implementation (enabler; not in IMPROVEMENT-PLAN.md but needed to test P2-01 markdown, the P1-12 reducers and P2-03 helpers)
- **Phase:** 1
- **State:** COMPLETE (merged in Elldreth/DisGourd#56)
- **Effort:** S
- **Depends on:** P1-18 (the Vitest major must match the Vite major)
- **Serialize with:** web/package.json units
- **Requirement Source:** planner recommendation. The client has zero automated tests (revalidated).

## Scope
- devDependencies: `vitest`, `jsdom`, `@testing-library/react`.
- Add `"test": "vitest run"` to `web/package.json`. Put the config in `web/vite.config.js` (`test: { environment: 'jsdom' }`).
- One seed test: `web/src/util.test.js` covering `mergeMessages`, `formatDay` and `applyServerOrder`.
- Root `package.json`: `"test"` runs both the server and web tests. Add a web test step to CI (P1-17), as a follow-up edit if P1-17 has already landed.

## Acceptance criteria
- [x] `npm --prefix web test` runs and passes.
- [x] Root `npm test` runs both suites.
- [x] `npm --prefix web run build` is unaffected; test files are not bundled.

## Expected Areas of Change
`web/package.json`, `web/package-lock.json`, `web/vite.config.js`, new `web/src/util.test.js`, root `package.json`, and `.github/workflows/ci.yml` (if present).

## Assumptions
- ASSUMPTION (kept): Vitest.

## Suggested addition (from P1-13, 2026-10-15)
P1-13 hit a crash that `vite build` and CI both missed: a hook result was read before it was declared, which blanked the app on load. Consider adding an App render smoke test here, rendering `<App/>` with the API and WebSocket stubbed and failing on any thrown error. Not yet part of this packet's acceptance criteria; decide when activating.

## Activation
- Activated 2026-10-16 on branch `claude/p1-19-web-tests`, cut from main @ 26b4f30 (P1-14 merged).
- **Dependency on P1-18 dropped.** Vitest is pinned to **2.1.9**, which supports the current Vite 5, so the harness doesn't wait for the Vite bump. When P1-18 moves Vite to a new major, bump Vitest to the matching major in the same PR.

## What was added
- devDependencies: `vitest@2.1.9`, `jsdom@25.0.1`, `@testing-library/react@16.1.0`, `@testing-library/dom@10.4.0`.
- `web/vite.config.js` `test` block (jsdom, `src/**/*.test.{js,jsx}`, `restoreMocks`). `web` script `"test": "vitest run"`. Root `"test"` runs the server tests, then the web tests.
- `src/util.test.js` (9): `mergeMessages`, `formatDay`, `applyServerOrder`, `roleRank`, `attachmentInfo`.
- `src/state/useChannelMessages.test.js` (8): every `messagesReducer` action, `pruneExpired`, `badgeCounts`.
- **`src/App.test.jsx` (2): the suggested App render smoke test (adopted).** It renders the real `<App/>` signed in and signed out, with `api.js` mocked and a fake WebSocket. It asserts that the server/channel/message list renders (or the sign-in screen), and that nothing is thrown or logged via `console.error`.
- CI (`.github/workflows/ci.yml`): the web job is now "Web tests and build" and runs `npm test` before the build.

## Verification (AC → evidence)
| AC | Evidence |
|---|---|
| `npm --prefix web test` passes | 3 files, 19/19, about 1.5s. |
| Root `npm test` runs both | Server 8 suites, 72/72; then web 3 files, 19/19. |
| Build unaffected; tests not bundled | `vite build` passes. `dist/assets/*.js` contains no "smoke test" / "vitest" text. |
| (extra) the smoke test catches the P1-13 crash class | I temporarily added `const earlyDm = dm.current;` above `const dm = useDms(...)`. `vite build` **still passed**, but both smoke tests **failed** with `ReferenceError: Cannot access 'dm' before initialization`. I reverted it (the diff is empty) and the suite is back to 19/19. |
