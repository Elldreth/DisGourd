# P3-26c — Timeout

- **Unit Type:** Implementation (child of P3-26)
- **Phase:** 3
- **State:** PLANNED (READY once P3-26a merges)
- **Effort:** M
- **Depends on:** P3-26a

## Scope
- **The `timeout_members` permission** (Admin by default), shown as "Time out members".
- **Migration:** `space_members.timeout_until INTEGER`, `timeout_reason TEXT`.
- **Routes:**
  - **`PUT /spaces/:s/members/:user/timeout { minutes: 5 | 60 | 1440 | 10080, reason? }`:** rank-checked; logged.
  - **`DELETE /spaces/:s/members/:user/timeout`:** removes it; logged.
- **The member list / GET /spaces** carry `timedOutUntil`.
- **While timed out (until > now):** these are refused with `TIMED_OUT` (+ until):
  - sending messages (channels, threads), editing, reacting;
  - creating threads, /imagine;
  - speaking in voice (they join muted and can't unmute).

  Reading, DMs and listening are unaffected. Lifting is automatic, by comparing against now.
- **App:**
  - **The member menu:** "Time out…" with a duration and reason, and "Remove timeout".
  - **A ⏱** next to the name, with a tooltip of the end time.
  - **The composer** is replaced by "You're timed out in this server until 4:30 PM" (+ reason), and comes back when it ends.

## Acceptance criteria
- [ ] Server: set / remove with rank rules; every guarded path refused while active and allowed after (clock faked); logged.
- [ ] Web: the dialog, the ⏱, the composer notice and its return.
- [ ] Sandbox: sandy times bob out for 5 minutes; bob can't post or react and sees the notice; remove → he can post.
