# P10-09 — Code blocks in messages can be reached by keyboard

- **Unit Type:** Implementation
- **Phase:** 10
- **State:** REVIEW
- **Starting baseline:** main at 2817348 (#207 merged)
- **Effort:** S
- **Depends on:** none
- **Found in:** P10-07's accessibility check (recorded there as Discovered Work)

## Why
On a phone (375×812), axe-core 4.10.2 flags a serious `scrollable-region-focusable` violation. A fenced code block in a chat message with a long line scrolls sideways, but the `<pre>` can't take keyboard focus, so someone without a pointer can't scroll the hidden part into view.

## Change
- `web/src/markdown.jsx` (`CodeBlock`): the `<pre>` gets `tabIndex={0}`, `role="group"` and a name: "js code" when the fence names a language, otherwise "Code". The role is there because `aria-label` isn't allowed on a plain `<pre>`.
- `web/src/index.css`: the app's global focus ring stays, but on the code area it's drawn just inside the edge (`outline-offset: -2px`). The block rounds its corners with `overflow: hidden`, which would otherwise clip the ring.
- Every code block is focusable, not only the ones that overflow. That keeps it simple and testable (no layout measuring), at the cost of one extra Tab stop per code block.

## Acceptance
- [x] The `<pre>` is focusable and named (Vitest, `markdown.test.jsx`).
- [x] Web `npx vitest run`: 835 passed. Server `npx jest`: 461 passed.
- [x] Sandbox (:3005) at 375×812 with a long `js` line: axe reports the violation on the current build. With this change's attributes and CSS applied to that page, axe reports no `scrollable-region-focusable`, `aria-*` or `nested-interactive` violations, the focus ring shows (2 px, inset), and arrow keys scroll the block sideways.

## Verification note
Five dev servers were already running for this folder, so a fresh web-sandbox (:5174) couldn't be started. The sandbox on :3005 serves a `web/dist` built by another session, and rebuilding it would have changed what that session sees. So the axe check applied the exact rendered attributes and CSS rule to the live page instead of loading the new bundle.

## Discovered Work
- None.
