# P1-17 — GitHub Actions: tests + web build (+ Docker build)

- **Unit Type:** Implementation
- **Phase:** 1 — Ops
- **State:** REVIEW (PR open)
- **Effort:** S
- **Depends on:** none (P1-19 later adds `npm --prefix web test` as a step)
- **Serialize with:** none (new file)
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 1 Ops. No `.github/` directory exists (revalidated).

## Scope
`.github/workflows/ci.yml`, triggered on push to `main` and on pull requests. Jobs:
1. `server`: ubuntu-latest, Node 22, `npm ci --prefix server`, `npm test --prefix server`.
2. `web`: Node 22, `npm ci --prefix web`, `npm run build --prefix web`.
3. `docker` (needs both): `docker build .` with no push, using the buildx cache.

Use `actions/setup-node` with `cache: npm` and `cache-dependency-path` pointing at both lockfiles.

## Acceptance criteria
- [x] The workflow is green on a PR from a branch off current main.
- [x] A deliberately failing test makes the `server` job fail (verify once, then revert).
- [x] Total runtime is under 6 minutes.

## Expected Areas of Change
New `.github/workflows/ci.yml`, and optionally a README badge.

## Working Set / Blast Radius
None at runtime.

## Activation
- Activated 2026-10-15 on branch `claude/p1-17-ci`, cut from main @ fe3c2e0.

## Implementation notes
- Each job uses its own lockfile for `setup-node`'s npm cache (`server/package-lock.json`, `web/package-lock.json`).
- The Docker job (`needs: [server, web]`) builds without pushing and uses the `type=gha` buildx cache.
- `concurrency` cancels superseded runs on the same ref.
- `permissions: contents: read`.
- Added a CI badge to the README header.

## Verification (AC → evidence)
| AC | Evidence |
|---|---|
| Green on a PR off current main | Run 38691558396 (PR #48): Server tests ✓, Web build ✓, Docker image builds ✓. |
| A deliberately failing test fails the `server` job | Commit af2aaed added `server/tests/ci-canary.test.js` (`expect(1).toBe(2)`). Run 38691831467: **Server tests failed** ("1 failed, 57 passed"), Web build ✓, Docker skipped (needs both). Reverted in 4900dd1. |
| Runtime < 6 min | Wall clock 1m34s (server 18s, web 13s, docker 70s on a cold cache). |
