# P1-19 — Web unit-test harness (Vitest)

- **Unit Type:** Implementation (enabler; not in IMPROVEMENT-PLAN.md but needed to test P2-01 markdown, the P1-12 reducers and P2-03 helpers)
- **Phase:** 1
- **State:** PLANNED (READY after P1-18)
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
- [ ] `npm --prefix web test` runs and passes.
- [ ] Root `npm test` runs both suites.
- [ ] `npm --prefix web run build` is unaffected; test files are not bundled.

## Expected Areas of Change
`web/package.json`, `web/package-lock.json`, `web/vite.config.js`, new `web/src/util.test.js`, root `package.json`, and `.github/workflows/ci.yml` (if present).

## Assumptions
- ASSUMPTION: Vitest is acceptable. It's the natural fit for Vite. Flag for human.
