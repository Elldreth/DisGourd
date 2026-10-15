# P1-06 — Transactions for multi-step writes (space create, message + mentions, invite join, registration)

- **Unit Type:** Implementation
- **Phase:** 1 — "Wrap multi-step writes in transactions"
- **State:** COMPLETE (merged in Elldreth/DisGourd#45)
- **Effort:** S–M
- **Depends on:** P1-03 (register), P1-04 (spaces, invites), P1-05 (gateway message)
- **Serialize with:** db/index.js units (P1-07, P1-10, P2-05)
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 1, plus a new finding from revalidation (below)

## Current state (revalidated)
- `POST /spaces` calls `createSpaceOwned` and then a separate `createChannel(name, 'general')`. A crash between the two leaves a server with no channels.
- Gateway `message` runs `storeMessage`, then `markRead`, then `addMentions` as separate statements.
- Invite join reads `getInvite`, then calls `addMember`, `markSpaceRead` and `incrementInviteUses`. There is no `await` in this path and better-sqlite3 is synchronous, so a real in-process race is unlikely today. The value here is atomicity and crash consistency.
- **NEW finding: registration has a real race.** `findUsableRegCode` and the `maxAccounts`/username checks run *before* `await hashPassword(...)`, and `incrementRegCodeUses` runs after it. Concurrent sign-ups can overrun a code's `max_uses` or `MAX_ACCOUNTS`. A duplicate username fails with a raw SQLite UNIQUE error, which comes back as a 400 that leaks the error text.

## Scope
New db functions, each wrapped in `db.transaction`:
1. `createSpaceWithDefaults(name, ownerId, channels = [{ name: 'general', type: 'text' }])`. Returns the space id or null.
2. `storeMessageWithMentions(...)`. Inserts the message, marks it read for the author and inserts the resolved mentions. Returns `{ id, timestamp, mentions }`.
3. `redeemInvite(code, userId)`. Re-reads the invite inside the transaction, checks expiry, then adds the member. Increments with `UPDATE invites SET uses = uses + 1 WHERE code = ? AND (max_uses IS NULL OR uses < max_uses)`; if 0 rows change, it rolls back. Returns `'joined' | 'already' | 'expired' | 'exhausted'`.
4. `createUserRedeemingCode(...)`. Hash the password first. Then, in one transaction, re-check the account cap and the username/email, insert the user, and do a conditional reg-code increment. Map any UNIQUE violation to a 409.

Swap the call sites in `routes/auth.js`, `routes/spaces.js`, `routes/invites.js` and `gateway/chat.js`.

## Acceptance criteria
- [x] New `server/tests/transactions.test.js` passes:
  - [x] If `createChannel` is forced to throw (via jest spy), no space row is left behind.
  - [x] An invite with `max_uses = 1` and 2 joiners gives exactly one success and one 410.
  - [x] A reg code with `max_uses = 1` and 2 *concurrent* `/register` calls (`Promise.all`) gives exactly one 201.
  - [x] Two concurrent registrations with the same username give one 201 and one 409, with no SQLite text in the body.
- [x] `api.test.js` still passes.

## Expected Areas of Change
- `server/db/index.js` (+4 functions; the old ones stay exported for compatibility)
- `server/routes/{auth,spaces,invites}.js` and `server/gateway/chat.js` (call-site swaps)
- New `server/tests/transactions.test.js`

## Working Set / Blast Radius
The 4 handlers plus `db/index.js` lines 353-530. Blast radius is limited to the four write paths.

## Activation
- Activated 2026-10-15 on branch `claude/p1-06-transactions`, cut from main @ 89ccd4c (split + P1-07 merged).
- Baseline: 39/39 server tests passing (3 suites).

## Implementation notes
- `storeMessageWithMentions(space, channel, content, authorId, attachments, spoiler, spaceId, mentionNames)` takes the already-parsed mention names, so `db/` doesn't depend on `validate.js`.
- Registration still does its fast pre-checks before hashing (so bad requests stay cheap). After the hash, `createUserRedeemingCode` re-checks the cap, **conditionally** claims the code (`UPDATE … WHERE uses < max_uses AND not revoked AND not expired`) and inserts the user, all in one transaction. A UNIQUE violation maps to `{ error: 'exists' }` and then a 409.
- `redeemInvite` keeps the old check order (expired, then exhausted, then already-member) so existing responses are unchanged. It adds a conditional `uses + 1`.
- **AC wording deviation:** the "space create is atomic" test forces a failure with a duplicate default channel name (a UNIQUE violation part-way through the transaction), not a jest spy. A spy on the exported `createChannel` can't intercept the call inside the db module. The property checked is the same: no space row is left behind.

## Verification (AC → evidence)
| AC | Evidence |
|---|---|
| Atomic space create | `createSpaceWithDefaults('Boom', …, [general, general])` throws, and `getSpaceByName('Boom')` is undefined. The normal path makes the owner and `#general`. A taken name gives `null`. |
| Invite max_uses=1, 2 joiners | Concurrent `Promise.all` → statuses `[200, 410]`, `uses = 1`. |
| Reg code max_uses=1, concurrent sign-ups | 3 concurrent `/register` → `[201, 403, 403]`. **This failed on the old route code** (checked by restoring the old `routes/auth.js`). |
| Same username, concurrent | `[201, 409]`. The body is `{"error":"User already exists"}` with no SQLite text. **This also failed on the old code.** |
| `api.test.js` passes | Full run: 4 suites, 44/44. ESLint: clean. |
| (extra) sandbox | `POST /spaces` → 201 with `["general"]`, a duplicate name → 409, invite join → 200 (and 200 again for an existing member), duplicate sign-up → 409. |
