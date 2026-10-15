# P1-17 — GitHub Actions: tests + web build (+ Docker build)

- **Unit Type:** Implementation
- **Phase:** 1 — Ops
- **State:** READY
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
- [ ] The workflow is green on a PR from a branch off current main.
- [ ] A deliberately failing test makes the `server` job fail (verify once, then revert).
- [ ] Total runtime is under 6 minutes.

## Expected Areas of Change
New `.github/workflows/ci.yml`, and optionally a README badge.

## Working Set / Blast Radius
None at runtime.
