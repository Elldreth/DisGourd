# P7-04 — Phones: full visible height, and a gap above the home bar

- **Unit Type:** Implementation
- **Phase:** 7 (UX review follow-ups)
- **State:** REVIEW
- **Effort:** S
- **Depends on:** none
- **Serialize with:** none
- **Requirement Source:** `design/UX-REVIEW-2026-10.md` M3; recorded as a follow-up in `P4-00`.

## Scope
- **Full visible height.** The app's outer box uses the *visible* screen height (`100dvh`), with `100%` kept as a fallback for older browsers. Today `html, body, #root` are `height: 100%` (`web/src/index.css`). On phone browsers that counts the space behind the address bar, so the message box can sit below the visible area until you scroll.
- **A gap above the home bar.** The message box gets `padding-bottom: env(safe-area-inset-bottom)`, so it clears the home indicator on iPhones and gesture-navigation phones. The page's viewport meta needs `viewport-fit=cover` for that value to be non-zero; check `web/index.html`.
- **The user footer too:** it sits at the bottom of the phone nav drawer, so it gets the same bottom gap. Also, with `viewport-fit=cover` the page reaches the side notches in landscape, so the root gets left/right safe-area padding.
- **Nothing changes on desktop.** All the safe-area values are 0 there.

## Acceptance criteria
- [x] AC-1: the app's outer box uses `100dvh`, with a `100%` fallback; no page scroll at 375×812 or at 1280×800.
- [x] AC-2: the message box has `env(safe-area-inset-bottom)` padding at the bottom, and `index.html` declares `viewport-fit=cover`.
- [x] AC-3: desktop is unchanged (same screenshot as before at 1280×800).
- [x] AC-4: a web test checks the composer's safe-area class and the viewport meta. The suite stays green.
- [x] AC-5: a sandbox check at 375×812 in the pane, with screenshots. **A real phone can't be tested from here**: the pane has no address bar to collapse and no home indicator. The owner checks on a phone, or this is merged as "can't be fully verified here".

## Expected Areas of Change
`web/src/index.css`, `web/index.html`, `web/src/components/Composer.jsx`, plus a test.

## Out of Scope
Making Send an icon button on phones (also in M3). Ask separately if wanted.

## Starting Baseline
Revision: `ee16b7e` (main after #168).

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | Vitest `PhoneViewport.test.jsx` + sandbox | The `#root` rule is `height: 100dvh` after the `100%` rule. At 375×812: root 812 px, document 812 px, no page scroll (`design/p6-actions/shots/p7-04-phone.jpg`). At 1280×800: root 800 px, no scroll. |
| AC-2 | Verified | Vitest + the built CSS | The composer is `pb-[max(1.25rem,env(safe-area-inset-bottom))]` and the user footer `pb-[max(0.5rem,…)]`; both are compiled into `dist`. `index.html` has `viewport-fit=cover` (also read live in the sandbox). |
| AC-3 | Verified | Sandbox, computed styles at 1280×800 | Composer bottom padding 20 px, the same as the old `pb-5`. Footer 8 px, the same as the old `py-2`. Root side padding 0 (`p7-04-desktop.jpg`). There's no "before" screenshot, because the build had already been replaced; the computed values show nothing moved. |
| AC-4 | Verified | Vitest, Vite | 3 tests. Web 95 files / 744 tests green. `vite build` clean. |
| AC-5 | Partly verified | Sandbox (a fresh install on :3008) at 375×812 | Layout fine in the pane. **Not verifiable here:** the pane has no collapsing address bar and no home indicator, so `env(safe-area-inset-*)` is 0 and `100dvh` equals `100%`. It needs a look on a real phone (iPhone Safari, Android Chrome). |
