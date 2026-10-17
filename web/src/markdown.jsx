// Message markdown → React elements. Never produces HTML strings and never
// uses dangerouslySetInnerHTML, so message text can't inject markup.
//
// Supported, outermost first:
//   ```lang\n…```  fenced code blocks (language label + Copy button)
//   > quote        consecutive "> " lines
//   `code`         inline code (no formatting inside)
//   ||spoiler||    hidden until clicked
//   **bold**  __underline__  ~~strike~~  *italic*  _italic_
//   http(s)://…    autolinks (only these two schemes)
//   @name          mentions (optional)
//   \*            backslash escapes
// Not supported on purpose: masked links [text](url) (phishing), headings,
// lists, tables, raw HTML.
import { useEffect, useState } from 'react';
import { copyText } from './util.js';
import { hastToReact } from './hastToReact.jsx';

// Languages (and aliases) the lazily-loaded highlighter knows. Checked before
// loading it, so a block with an unknown or no language never pulls it in.
const HIGHLIGHT_LANGS = new Set([
  'bash', 'sh', 'shell', 'zsh', 'console', 'c', 'cpp', 'c++', 'hpp', 'cc', 'cxx', 'csharp', 'cs', 'c#', 'css',
  'diff', 'go', 'golang', 'java', 'javascript', 'js', 'jsx', 'mjs', 'cjs', 'json', 'python', 'py', 'rust', 'rs',
  'sql', 'typescript', 'ts', 'tsx', 'xml', 'html', 'svg', 'xhtml', 'yaml', 'yml',
]);
let highlighter = null; // the highlight.js module promise, shared by all blocks
const loadHighlighter = () => (highlighter ||= import('./highlight.js'));

const ESCAPABLE = new Set(['\\', '*', '_', '~', '|', '`', '>', '@', '[', ']', '(', ')', '#', '-']);
const isWordChar = (c) => !!c && /[A-Za-z0-9]/.test(c);
const URL_START = /^https?:\/\//i;
const URL_STOP = new Set([' ', '\t', '\n', '\r', '<', '>', '"', '`']);
const TRAILING_PUNCT = new Set(['.', ',', ';', ':', '!', '?', "'", '"']);

// Index of the next unescaped `delim` at or after `from`, or -1.
function findCloser(text, delim, from) {
  for (let i = from; i <= text.length - delim.length; i++) {
    if (text[i] === '\\') {
      i += 1;
      continue;
    }
    if (text.startsWith(delim, i)) return i;
  }
  return -1;
}

// The http(s) URL starting at `i`, minus trailing punctuation and an
// unbalanced closing parenthesis; null if it isn't a usable URL.
function readUrl(text, i) {
  let end = i;
  while (end < text.length && !URL_STOP.has(text[end])) end += 1;
  let url = text.slice(i, end);
  for (;;) {
    const last = url[url.length - 1];
    if (TRAILING_PUNCT.has(last)) url = url.slice(0, -1);
    else if (last === ')' && (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length) url = url.slice(0, -1);
    else break;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (url.length <= parsed.protocol.length + 2) return null;
  } catch {
    return null;
  }
  return url;
}

function Spoiler({ children }) {
  const [revealed, setRevealed] = useState(false);
  const reveal = () => setRevealed(true);
  return (
    <span
      className={`md-spoiler ${
        revealed
          ? 'rounded-sm bg-ink-600/40 px-0.5'
          : 'cursor-pointer select-none rounded-sm bg-ink-500 px-0.5 text-transparent hover:bg-ink-600 **:text-transparent'
      }`}
      onClick={revealed ? undefined : reveal}
      onKeyDown={revealed ? undefined : (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), reveal())}
      role={revealed ? undefined : 'button'}
      tabIndex={revealed ? undefined : 0}
      title={revealed ? undefined : 'Spoiler — click to reveal'}
      aria-label={revealed ? undefined : 'Spoiler, press to reveal'}
    >
      {children}
    </span>
  );
}

function CodeBlock({ code, lang }) {
  const [label, setLabel] = useState('Copy');
  // Plain text first; swapped for highlighted tokens once the highlighter loads.
  const [tokens, setTokens] = useState(null);
  useEffect(() => {
    const name = String(lang || '').toLowerCase();
    if (!HIGHLIGHT_LANGS.has(name)) return undefined;
    let live = true;
    loadHighlighter()
      .then((m) => {
        const tree = m.highlight(code, name);
        if (live && tree) setTokens(hastToReact(tree));
      })
      .catch(() => {}); // stay plain if it can't load
    return () => {
      live = false;
    };
  }, [code, lang]);
  async function copy() {
    setLabel((await copyText(code)) ? 'Copied' : "Couldn't copy");
    setTimeout(() => setLabel('Copy'), 1500);
  }
  return (
    <div className="md-codeblock">
      <div className="md-codeblock-bar">
        {lang ? <span className="md-codeblock-lang">{lang}</span> : <span />}
        <button type="button" onClick={copy} className="md-codeblock-copy" aria-label="Copy code">
          {label}
        </button>
      </div>
      <pre><code className={tokens ? 'hljs' : undefined}>{tokens || code}</code></pre>
    </div>
  );
}

// ---- Inline ----
// Paired delimiters, checked in this order at each position.
const PAIRS = [
  { delim: '||', render: (kids, key) => <Spoiler key={key}>{kids}</Spoiler> },
  { delim: '**', render: (kids, key) => <strong key={key}>{kids}</strong> },
  { delim: '__', render: (kids, key) => <u key={key}>{kids}</u> },
  { delim: '~~', render: (kids, key) => <s key={key}>{kids}</s> },
];

function parseInline(text, opts, keys) {
  const out = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push(buf);
    buf = '';
  };
  const key = () => `m${keys.n++}`;

  let i = 0;
  while (i < text.length) {
    const c = text[i];

    // Backslash escape: the next character is literal.
    if (c === '\\' && ESCAPABLE.has(text[i + 1])) {
      buf += text[i + 1];
      i += 2;
      continue;
    }

    // Inline code: everything up to the next backtick, unformatted.
    if (c === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push(<code key={key()} className="md-code">{text.slice(i + 1, end)}</code>);
        i = end + 1;
        continue;
      }
      buf += c;
      i += 1;
      continue;
    }

    // Two-character pairs: spoiler, bold, underline, strike.
    const pair = PAIRS.find((p) => text.startsWith(p.delim, i));
    if (pair) {
      const end = findCloser(text, pair.delim, i + 2);
      if (end > i + 2) {
        flush();
        out.push(pair.render(parseInline(text.slice(i + 2, end), opts, keys), key()));
        i = end + 2;
        continue;
      }
      buf += c;
      i += 1;
      continue;
    }

    // Italic: *x* anywhere; _x_ only at word boundaries (so snake_case stays).
    if (c === '*' || (c === '_' && !isWordChar(text[i - 1]))) {
      let end = findCloser(text, c, i + 1);
      if (c === '_') {
        while (end !== -1 && isWordChar(text[end + 1])) end = findCloser(text, c, end + 1);
      }
      const inner = end === -1 ? '' : text.slice(i + 1, end);
      if (inner && inner.trim() === inner) {
        flush();
        out.push(<em key={key()}>{parseInline(inner, opts, keys)}</em>);
        i = end + 1;
        continue;
      }
      buf += c;
      i += 1;
      continue;
    }

    // Autolink: http(s) URLs at a word boundary.
    if ((c === 'h' || c === 'H') && !isWordChar(text[i - 1]) && URL_START.test(text.slice(i, i + 8))) {
      const url = readUrl(text, i);
      if (url) {
        flush();
        out.push(
          <a key={key()} href={url} target="_blank" rel="noopener noreferrer nofollow" className="md-link">
            {url}
          </a>
        );
        i += url.length;
        continue;
      }
    }

    // Mention: @name at a word boundary (so emails aren't mentions).
    if (c === '@' && opts.mentions && !/[A-Za-z0-9_.]/.test(text[i - 1] || '')) {
      const m = /^@([A-Za-z0-9_.-]{1,32})/.exec(text.slice(i, i + 34));
      if (m) {
        const name = m[1].replace(/\.+$/, '');
        if (name) {
          flush();
          const isMe = name === opts.me;
          out.push(
            <span
              key={key()}
              className={`md-mention rounded px-0.5 font-medium ${
                isMe ? 'md-mention-me bg-brand/40 text-fg' : 'bg-brand/15 text-brand-hi'
              }`}
            >
              @{name}
            </span>
          );
          i += name.length + 1;
          continue;
        }
      }
    }

    buf += c;
    i += 1;
  }
  flush();
  return out;
}

// ---- Blocks: quotes, then inline ----
function parseTextBlock(text, opts, keys, out) {
  const lines = text.split('\n');
  let group = [];
  let quoting = false;
  const emit = () => {
    if (!group.length) return;
    const body = group.join('\n');
    if (quoting) {
      out.push(
        <blockquote key={`q${keys.n++}`} className="md-quote">
          {parseInline(body, opts, keys)}
        </blockquote>
      );
    } else {
      out.push(...parseInline(body, opts, keys));
    }
    group = [];
  };
  for (const line of lines) {
    const isQuote = line.startsWith('> ') || line === '>';
    if (isQuote !== quoting) {
      emit();
      quoting = isQuote;
    }
    group.push(isQuote ? line.replace(/^> ?/, '') : line);
  }
  emit();
}

// Render message text. opts: { me: your username, mentions: highlight @names }
export function renderMarkdown(text, opts = {}) {
  const options = { me: opts.me || '', mentions: !!opts.mentions };
  const keys = { n: 0 };
  const out = [];
  const src = String(text || '');
  let textStart = 0; // start of text not yet rendered
  let searchFrom = 0; // where to look for the next fence
  for (;;) {
    const open = src.indexOf('```', searchFrom);
    const close = open === -1 ? -1 : src.indexOf('```', open + 3);
    if (open === -1 || close === -1) break;
    let body = src.slice(open + 3, close);
    let lang = '';
    const langLine = /^([A-Za-z0-9+#._-]{1,20})\n/.exec(body);
    if (langLine) {
      lang = langLine[1];
      body = body.slice(langLine[0].length);
    } else if (body.startsWith('\n')) {
      body = body.slice(1);
    }
    const code = body.replace(/\n$/, '');
    // An empty fence (``````) is just text, not an empty code block.
    if (!code.trim()) {
      searchFrom = close + 3;
      continue;
    }
    // Text before the fence (drop the newline the block replaces).
    if (open > textStart) parseTextBlock(src.slice(textStart, open).replace(/\n$/, ''), options, keys, out);
    out.push(<CodeBlock key={`c${keys.n++}`} code={code} lang={lang} />);
    textStart = close + 3;
    if (src[textStart] === '\n') textStart += 1;
    searchFrom = textStart;
  }
  if (textStart < src.length) parseTextBlock(src.slice(textStart), options, keys, out);
  return out;
}
