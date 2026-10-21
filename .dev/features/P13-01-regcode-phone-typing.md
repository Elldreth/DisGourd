# P13-01 — Registration codes that survive a phone keyboard

- **Unit Type:** Implementation
- **Phase:** 13 (small fixes found on the live server)
- **State:** REVIEW
- **Effort:** S
- **Depends on:** none
- **Starting baseline:** main after #222
- **Requirement Source:** the owner, 2026-10-21. Signing up from a phone failed with "A valid registration code is required" several times, and then hit the sign-up limit of 5 per 15 minutes per IP. Their words: "fix the registration code field: no auto-capitalize/autocorrect, trim spaces, and easier-to-type new codes."

## Problem
- **The codes:** `crypto.randomBytes(6).toString('base64url')` (`server/routes/admin.js`), e.g. `aB3x-Q9_kZ1m`. They're mixed case, include `-` and `_`, and contain lookalikes (`l`/`I`, `0`/`O`).
- **The server** compared codes exactly (`server/db/index.js` `findUsableRegCode`; `server/routes/auth.js` for `REGISTRATION_CODE`).
- **The sign-up field** (`web/src/components/Login.jsx`) left auto-capitalise, autocorrect and spell-check on, so a phone keyboard capitalised the first letter or "fixed" the code. The app already trimmed spaces before sending.

## As built
- **`server/auth/regCodes.js` (new):**
  - `newRegCode()` makes codes like `K7MPQ-X3HRT`: 10 symbols from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0/O/1/I/L), using `crypto.randomInt`. That's 31¹⁰ ≈ 8×10¹⁴ possibilities, and sign-up is rate-limited.
  - `normalizeRegCode()` removes whitespace and dashes and upper-cases.
- **`POST /admin/registration/codes`** mints codes with `newRegCode()`.
- **`findUsableRegCode`** matches on `replace(upper(code), '-', '')` against the normalized input. If two old codes differ only in case, the exact match wins. **Old codes keep working.** Their case no longer matters, which only widens matching for existing mixed-case codes by a negligible amount.
- **`REGISTRATION_CODE`** from the environment is compared the same way (normalized on both sides, constant time).
- **Sign-up field:** `autoCapitalize="none"`, `autoCorrect="off"`, `autoComplete="off"`, `spellCheck={false}`, and a monospace font. **The setup wizard's setup-code field** gets the same `autoCapitalize` and `autoCorrect`.

## Acceptance criteria
- [x] AC-1: new codes are two groups of five easy-to-read symbols.
- [x] AC-2: a code typed in lower case, with spaces or without the dash, registers.
- [x] AC-3: the environment code is matched the same way.
- [x] AC-4: the sign-up code field turns off auto-capitalise, autocorrect, autocomplete and spell-check.
- [x] AC-5: the existing rules still hold (a wrong code → 403, a used-up code → 403, closed mode, the account cap).

## Evidence (2026-10-21)
| Criterion | Evidence |
|---|---|
| AC-1 | `server/tests/regcodes.test.js`: 200 codes match `^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$` and are unique, and the alphabet has no 0/1/O/I/L. `api.test.js` checks a minted code's shape |
| AC-2, AC-3, AC-5 | `api.test.js` "registration gating": ` code `, the code without its dash, and `Xxxxx yyyyy` each register (maxUses 3). The env code `sesame` typed as ` Sesame` registers. The wrong, missing and used-up cases, closed mode and the cap are unchanged |
| AC-4 | `web/src/components/LoginCode.test.jsx` checks the attributes |
| Suites | Server 554 tests, web 845 tests; `vite build` is clean |
| Sandbox | A throwaway copy of the sandbox DB on :3010, built client. As sandy, set mode `code` and minted `KJZJW-PQ7N5`. Then, signed out: Register → typed the code as `Kjzjw pq7n5 ` → **account created** (the "not in any servers yet" screen). The field showed autocapitalize=none, autocorrect=off, spellcheck=false, monospace. The temporary launch entry and DB copy were removed afterwards |

## Discovered Work (not done)
- **A sign-up link with the code filled in** (e.g. `/#register=K7MPQ-X3HRT`) would avoid typing altogether. Small, but it's a feature; ask the owner.
- **Codes listed in Site admin › General** could use a Copy button and the monospace font, if they don't have them already.
