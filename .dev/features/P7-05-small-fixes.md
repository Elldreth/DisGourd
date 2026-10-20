# P7-05 — Small fixes: kie.ai spend on the overview, the dev-server font note, closing old questions

- **Unit Type:** Implementation
- **Phase:** 7
- **State:** COMPLETE (merged #174)
- **Starting baseline:** main at ef006a8 (#173 merged)
- **Effort:** S
- **Depends on:** none
- **Requirement Source:** the follow-up list after P6/P7 (2026-10-20), items 8, 9 and 11. The owner agreed to "bundle the small fixes into one PR".

## Scope
1. **kie.ai spend this month on Image generation › Overview.**
   - `GET /admin/imagine` adds `spentThisMonth` (credits since the 1st, rounded to 2 places) for engines that charge, which today is kie.ai. It uses the same sum as the monthly cap (`imagineCreditsSince`, which leaves out failed jobs).
   - The kie.ai card's second line, which said "Cap: 100 credits a month", becomes "54.1 of 100 credits used this month", or "1 credit used this month · no cap" without a cap. A separate line was cut off in the narrow card in the sandbox, so it's one line. Without a key it still says "No API key yet".
2. **Dev-server fonts in worktrees.** P5-02 noted a 403 for fonts behind a linked `node_modules`, and a fix was tried: allowing `node_modules`' real path in Vite's `server.fs.allow`.
   - I couldn't reproduce the 403. In a throwaway git worktree whose `web/node_modules` was a link to the main checkout's, the dev server served an Inter font file both by its linked path and by `/@fs/<real path>` (200), with the fix and without it.
   - The fix wasn't shipped. If it shows up again, note the exact URL that fails and how the worktree was made.
3. **Close the old open questions** in INDEX, with what was built or decided.
4. **Bookkeeping:**
   - P6-04 (#169) and P7-01–P7-04 (#170–#173) marked COMPLETE;
   - P7 rows added to the feature table, where they were missing.

## Acceptance criteria
- [x] Server: `spentThisMonth` for kie.ai counts this month's done jobs only (not failed, not last month); no figure for ComfyUI.
- [x] Web: the overview card shows the figure, against the cap when one is set.
- [x] Fonts: checked in a real worktree; outcome recorded (not reproducible, no change).
- [x] INDEX: the questions are closed with their answers, and the packet states are right.
- [x] All suites pass; `vite build` is clean.

## Evidence (2026-10-20)
| Acceptance criterion | Evidence |
|---|---|
| Server | `imagine-kie.test.js` (+1): jobs of 0.8 and 1.25 credits now, 5 failed and 9 last month → `spentThisMonth` rises by 2.05; ComfyUI has none |
| Web | `SiteAdminPages.test.jsx` (+1): cap 200 and 12.4 used → "12.4 of 200 credits used this month"; no cap and 1 used → "1 credit used this month · no cap"; no key → "No API key yet" and no spend line |
| Sandbox (:3005, restarted on this branch) | `GET /admin/imagine` as sandy: kie.ai `spentThisMonth: 54.1`, cap 100. Settings › Image generation › Overview: the kie.ai card reads "Grok Imagine" and "54.1 of 100 credits used this month", on one line (a first try as a separate line was cut off and was changed) |
| Fonts | `font_check.mjs` (scratch): Vite started in the throwaway worktree on :5199. `/node_modules/@fontsource-variable/inter/files/…woff2` and `/@fs/H:/repos/DisGourd/web/node_modules/…woff2` both → 200, with and without the `fs.allow` change. The worktree was removed afterwards; the main `node_modules` was untouched |
| Suites | Server 46 files, 419 tests; web 98 files, 762 tests; `vite build` clean |
