# P2-02 — Syntax highlighting for fenced code blocks (lazy-loaded)

- **Unit Type:** Implementation
- **Phase:** 2, rank 1 (second half)
- **State:** COMPLETE (merged in Elldreth/DisGourd#58)
- **Effort:** S
- **Depends on:** P2-01
- **Serialize with:** web/package.json units, index.css units
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 2 #1

## Scope
- Use `lowlight` (it outputs a hast tree, which we render to React elements, so there is still no innerHTML) with a curated language set: js/ts/jsx, json, bash/shell, python, css, xml/html, sql, diff, yaml, go, rust, java, c/cpp, csharp, plus aliases.
- Load it with a dynamic `import()` the first time a code block with a known language renders. Show plain monospace until it loads, then upgrade.
- Map token classes to Neon Calabash colours in `index.css`: violet keywords, lime strings, pink numbers, and gray-400 comments. All must reach ≥ 4.5:1 on the code background.

## Acceptance criteria
- [x] Main chunk size grows by < 5 KB gzip. The highlighter is a separate chunk (check the build output).
- [x] ```` ```js ```` blocks highlight. Unknown languages render plain. A block with no language renders plain, with no auto-detect, to save CPU.
- [x] A Vitest test covers the hast→React renderer: no `dangerouslySetInnerHTML`, and `<script>` inside code renders as text.
- [x] Token colours pass contrast; list the ratios in the PR.

## Expected Areas of Change
`web/package.json`/lockfile, `web/src/markdown.jsx` (code-block component), new `web/src/highlight.js`, `web/src/index.css`, and a test.

## Working Set / Blast Radius
Small. Only affects code blocks.

## Activation
- Activated 2026-10-16 on branch `claude/p2-02-syntax-highlighting`, cut from main @ 25276ea (P2-01 merged).

## Implementation notes
- Dependencies: `lowlight@3.1.0` and `highlight.js@11.9.0` (language definitions only).
- **`web/src/highlight.js`** (lazy chunk) registers 16 languages and their aliases: js/jsx/mjs, ts/tsx, json, bash/sh/shell/zsh, python/py, css, xml/html/svg, sql, diff, yaml/yml, go, rust/rs, java, c, cpp/c++, csharp/cs/c#. No auto-detect.
- **`web/src/hastToReact.jsx`** keeps only `<span className>` and text. Any other element is dropped but its text is kept.
- **`markdown.jsx` `CodeBlock`** renders plain text first. If the language is in `HIGHLIGHT_LANGS` (a static list, so unknown or no language never triggers a download), it loads the shared highlighter promise once, then swaps in tokens.
- **Token colours** (in `index.css`, Neon Calabash): keywords/tags violet `brand.hi`, strings lime, numbers/meta pink, titles/attributes amber (`idle`), variables gray-200, comments gray-400 italic.

## Verification (AC → evidence)
| AC | Evidence |
|---|---|
| Main chunk grows < 5 KB gzip; highlighter in a separate chunk | Main `index-*.js` gzip **86.83 → 87.76 kB (+0.93 kB)**. New chunk `highlight-*.js` is 84.38 kB (26.05 kB gzip). |
| `js` highlights; unknown and no language stay plain | `highlight.test.jsx`: a js block upgrades (keyword plus comment tokens, text unchanged). `wat` and no-language blocks have no `hljs` classes. Aliases `ts`, `py`, `sh`, `html`, `yml`, `rs`, `cs`, `c++` and `JSON` resolve. Sandbox: py and sql highlighted (10 tokens each); wat and none plain. |
| Lazy load | Sandbox: after a reload on `#random` (no code) the highlight chunk was **not** fetched. When Bob posted code blocks, it loaded and highlighted them. |
| hast→React is safe | Tests: a crafted tree with `<script>`/`<img onError>` yields no script or img elements (text kept), and highlighted `<script>alert(1)</script>` HTML stays text. No `dangerouslySetInnerHTML`. |
| Token contrast ≥ 4.5:1 | On the code background (#131024): violet **6.53**, lime **14.16**, pink **6.57**, amber **11.59**, comments **8.95**, variables **14.03**, plain **16.37**. On a mention-tinted row the lowest is violet at 6.12. |
| Suite | Web 5 files, 68/68 (including the App smoke test). Build passes. |
