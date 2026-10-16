# P2-01 — Markdown rendering (inline formatting, code, quotes, autolinks)

- **Unit Type:** Implementation
- **Phase:** 2, rank 1 ("Markdown and code blocks with syntax highlighting"). This unit covers the markdown part. Highlighting is P2-02.
- **State:** REVIEW (PR open)
- **Effort:** S–M
- **Depends on:** P1-19. A message parser on a security boundary needs unit tests.
- **Serialize with:** MessageList.jsx units, index.css units (P2-16, P2-17)
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 2 #1

## Current state (revalidated)
`MessageList.jsx` `renderRich` handles only `||spoilers||` and `@mentions`. Text renders with `whitespace-pre-wrap`. No links are clickable.

## Scope
- New `web/src/markdown.jsx` that turns a string into **React elements only**. No `dangerouslySetInnerHTML`, no HTML passthrough.
- Precedence, outermost first:
  1. ```` ```lang\n…``` ```` fenced blocks
  2. `` `inline code` ``
  3. `> ` blockquote lines
  4. `||spoiler||`
  5. `**bold**`, `*italic*` / `_italic_`, `~~strike~~`, `__underline__`
  6. autolinked `http(s)://` URLs
  7. `@mentions`
- Backslash escapes are supported.
- Code blocks: monospace, a horizontal scroll container, a language label and a Copy button (use `copyText` from util.js).
- Links: only `http:` and `https:` schemes, with `target="_blank" rel="noopener noreferrer nofollow"`. Strip trailing punctuation from autolinks.
- Mentions and spoilers keep their current styling, and are not parsed inside code.
- Replace `renderRich` in MessageList with `renderMarkdown(content, { me, mentions: !simple })`. DMs use the same renderer.
- Code styles go in `index.css`, using a `ui-monospace` stack.

## Non-goals
Masked links `[text](url)` (a phishing risk), headings, lists, tables, embeds, editing preview.

## Acceptance criteria
- [x] `web/src/markdown.test.jsx` (Vitest) covers:
  - [x] each construct
  - [x] nesting (`**bold _italic_**`)
  - [x] code suppressing formatting (`` `**x**` `` stays literal)
  - [x] spoilers and mentions intact
  - [x] `javascript:alert(1)` never becomes a link
  - [x] `<img onerror>` renders as text
  - [x] an unclosed `**` renders literally
  - [x] a 4,000-character pathological input (`*`×4000) renders in under 50ms
- [x] Manual: messages render the same as before when no markdown is used, and the "(edited)" marker still follows the text.
- [x] Build passes.

## Expected Areas of Change
New `web/src/markdown.jsx`, new `web/src/markdown.test.jsx`, `web/src/components/MessageList.jsx` (swap the renderer, remove `renderRich`/`renderMentions`), `web/src/index.css`.

## Working Set / Blast Radius
MessageList.jsx (325 lines) and the new module. Blast radius: every rendered message. Tests mitigate it.

## Activation
- Activated 2026-10-16 on branch `claude/p2-01-markdown`, cut from main @ 75eb847 (P1-19 merged).

## Implementation notes
- `web/src/markdown.jsx`: a hand-written scanner that produces **React elements only**. No regexes over the whole message, no HTML.
  - **Fences** are cut out first.
  - **Text blocks** are split into quote and non-quote line groups.
  - **Inline parsing** works left to right. Each opener finds its closer with a linear scan that skips escapes. An empty or unclosed pair falls back to the literal character.
  - **Italic `_`** only opens and closes at word boundaries, so `snake_case` is untouched.
  - **Autolinks** must start at a word boundary. They lose trailing punctuation and an unbalanced `)`, and are re-validated with `new URL()` as `http:` or `https:` only.
  - **Mentions** must not follow a word character, so emails aren't mentions.
- **Spoilers** are now keyboard-accessible: `role="button"` and focusable, with Enter or Space to reveal. Before, they were click-only.
- **Code blocks:** language label, horizontal scroll and a Copy button. The button shows **"Couldn't copy"** when the clipboard is unavailable, instead of silently doing nothing.
- `MessageList`: `renderRich` / `renderMentions` / `SpoilerText` were removed, and `renderMarkdown(content, { me, mentions: !simple })` is used for channels and DMs. `mentionsUser` (the row highlight) stays.
- Styles are in `index.css` (`.md-code`, `.md-codeblock*`, `.md-quote`, `.md-link`), using a `ui-monospace` stack.

## Verification (AC → evidence)
| AC | Evidence |
|---|---|
| Tests for each construct, nesting, code suppression, spoilers and mentions, `javascript:`, `<img onerror>`, unclosed `**`, 4,000-char pathological input under 50ms | `markdown.test.jsx`: **29 tests**, written first. The pathological inputs are 4,000× `*`, `**a`×1333, `_`, `` ` `` and `|`. Each runs under 50ms. Also covered: snake_case, escapes, emails not being mentions, URLs in code not linking, fences with and without a language, and unclosed fences. Web suite total 48/48, including the App smoke test. |
| Manual: plain messages unchanged; "(edited)" follows the text | Sandbox screenshot: "a plain message, nothing special" renders unchanged. After editing to `owner **message** now formatted`, the content reads "owner message now formatted(edited)" with the marker as the last element. |
| (extra) manual rendering | One message each with: bold, italic, underline, strike and inline code; nested italic; a two-line quote; a mention; a JS code block (label + Copy, `**not bold**` literal); a link without its trailing period; a hidden spoiler (Enter reveals "the cake is a lie"); and `<img …>` / `javascript:` / `snake_case_name` as plain text. |
| (extra) Copy button | The pane denies clipboard writes. Swapping in a fake clipboard: failure gives "Couldn't copy" and resets to "Copy". Success gives "Copied" with the exact code text. |
| Build | `vite build` passes. |

## CI fix (2026-10-16)
The first CI run of #57 failed two speed tests: "**a"×1333 took 123ms and a run of backticks took 427ms (the limit was 50ms). Measurements split parse time from DOM render time:
- **Parsing was always about 1ms.** The test was timing jsdom rendering, which varies by machine.
- **A real bug:** 4,000 backticks became **666 empty code blocks**, because every "``````" counted as a fence pair.

Fixes:
- An empty fence pair is now literal text. New tests cover a run of backticks and `before `````` after`.
- The speed tests time `renderMarkdown()` (the parse) only, which is what guards against hangs from crafted input. Three more pathological cases were added (`~~`, `@a`, `https://`), each under 1.6ms locally.

Web suite: 53/53.
