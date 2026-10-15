# P2-02 — Syntax highlighting for fenced code blocks (lazy-loaded)

- **Unit Type:** Implementation
- **Phase:** 2, rank 1 (second half)
- **State:** PLANNED (READY after P2-01)
- **Effort:** S
- **Depends on:** P2-01
- **Serialize with:** web/package.json units, index.css units
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 2 #1

## Scope
- Use `lowlight` (it outputs a hast tree, which we render to React elements, so there is still no innerHTML) with a curated language set: js/ts/jsx, json, bash/shell, python, css, xml/html, sql, diff, yaml, go, rust, java, c/cpp, csharp, plus aliases.
- Load it with a dynamic `import()` the first time a code block with a known language renders. Show plain monospace until it loads, then upgrade.
- Map token classes to Neon Calabash colours in `index.css`: violet keywords, lime strings, pink numbers, and gray-400 comments. All must reach ≥ 4.5:1 on the code background.

## Acceptance criteria
- [ ] Main chunk size grows by < 5 KB gzip. The highlighter is a separate chunk (check the build output).
- [ ] ```` ```js ```` blocks highlight. Unknown languages render plain. A block with no language renders plain, with no auto-detect, to save CPU.
- [ ] A Vitest test covers the hast→React renderer: no `dangerouslySetInnerHTML`, and `<script>` inside code renders as text.
- [ ] Token colours pass contrast; list the ratios in the PR.

## Expected Areas of Change
`web/package.json`/lockfile, `web/src/markdown.jsx` (code-block component), new `web/src/highlight.js`, `web/src/index.css`, and a test.

## Working Set / Blast Radius
Small. Only affects code blocks.
