# P2-01 — Markdown rendering (inline formatting, code, quotes, autolinks)

- **Unit Type:** Implementation
- **Phase:** 2, rank 1 ("Markdown and code blocks with syntax highlighting"). This unit covers the markdown part. Highlighting is P2-02.
- **State:** PLANNED (READY after P1-19)
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
- [ ] `web/src/markdown.test.jsx` (Vitest) covers:
  - [ ] each construct
  - [ ] nesting (`**bold _italic_**`)
  - [ ] code suppressing formatting (`` `**x**` `` stays literal)
  - [ ] spoilers and mentions intact
  - [ ] `javascript:alert(1)` never becomes a link
  - [ ] `<img onerror>` renders as text
  - [ ] an unclosed `**` renders literally
  - [ ] a 4,000-character pathological input (`*`×4000) renders in under 50ms
- [ ] Manual: messages render the same as before when no markdown is used, and the "(edited)" marker still follows the text.
- [ ] Build passes.

## Expected Areas of Change
New `web/src/markdown.jsx`, new `web/src/markdown.test.jsx`, `web/src/components/MessageList.jsx` (swap the renderer, remove `renderRich`/`renderMentions`), `web/src/index.css`.

## Working Set / Blast Radius
MessageList.jsx (325 lines) and the new module. Blast radius: every rendered message. Tests mitigate it.
