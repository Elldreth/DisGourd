import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { renderMarkdown } from './markdown.jsx';

afterEach(cleanup);

// Render a message and return its container element.
function md(text, opts = { me: 'me', mentions: true }) {
  const { container } = render(<div>{renderMarkdown(text, opts)}</div>);
  return container.firstChild;
}

describe('plain text', () => {
  test('text without markdown renders unchanged, newlines included', () => {
    const el = md('hello world\nsecond line');
    expect(el.textContent).toBe('hello world\nsecond line');
    expect(el.querySelector('strong, em, code, a, blockquote')).toBeNull();
  });
});

describe('inline formatting', () => {
  test.each([
    ['**bold**', 'strong', 'bold'],
    ['*italic*', 'em', 'italic'],
    ['_italic_', 'em', 'italic'],
    ['~~gone~~', 's', 'gone'],
    ['__under__', 'u', 'under'],
    ['`code`', 'code', 'code'],
  ])('%s', (src, tag, text) => {
    const el = md(`a ${src} b`);
    expect(el.querySelector(tag).textContent).toBe(text);
    expect(el.textContent).toBe(`a ${text} b`);
  });

  test('nesting: bold containing italic', () => {
    const el = md('**bold _italic_**');
    expect(el.querySelector('strong em').textContent).toBe('italic');
    expect(el.querySelector('strong').textContent).toBe('bold italic');
  });

  test('code suppresses formatting inside it', () => {
    const el = md('`**not bold** _nor_ @me`');
    expect(el.querySelector('code').textContent).toBe('**not bold** _nor_ @me');
    expect(el.querySelector('strong, em, .md-mention')).toBeNull();
  });

  test('unclosed markers render literally', () => {
    expect(md('**not closed').textContent).toBe('**not closed');
    expect(md('a * b').textContent).toBe('a * b');
    expect(md('`open code').textContent).toBe('`open code');
    expect(md('**not closed').querySelector('strong')).toBeNull();
  });

  test('snake_case words are not italic', () => {
    const el = md('use my_var_name here');
    expect(el.querySelector('em')).toBeNull();
    expect(el.textContent).toBe('use my_var_name here');
  });

  test('backslash escapes show the character', () => {
    const el = md('\\*not italic\\* and \\`no code\\`');
    expect(el.querySelector('em, code')).toBeNull();
    expect(el.textContent).toBe('*not italic* and `no code`');
  });
});

describe('code blocks', () => {
  test('fenced block with a language label and copy button', () => {
    const el = md('look:\n```js\nconst a = 1;\nif (a) { **x** }\n```\nafter');
    const block = el.querySelector('.md-codeblock');
    expect(block.querySelector('pre code').textContent).toBe('const a = 1;\nif (a) { **x** }');
    expect(block.querySelector('.md-codeblock-lang').textContent).toBe('js');
    expect(block.querySelector('button[aria-label="Copy code"]')).toBeTruthy();
    expect(block.querySelector('strong')).toBeNull();
    expect(el.textContent).toContain('after');
  });

  test('fenced block without a language', () => {
    const block = md('```\nplain\n```').querySelector('.md-codeblock');
    expect(block.querySelector('pre code').textContent).toBe('plain');
    expect(block.querySelector('.md-codeblock-lang')).toBeNull();
  });

  test('an unclosed fence is literal text', () => {
    const el = md('```js\nno end');
    expect(el.querySelector('.md-codeblock')).toBeNull();
    expect(el.textContent).toBe('```js\nno end');
  });
});

describe('quotes', () => {
  test('consecutive "> " lines become one quote, with formatting inside', () => {
    const el = md('> first **line**\n> second\nnot quoted');
    const q = el.querySelector('blockquote');
    expect(q.textContent).toBe('first line\nsecond');
    expect(q.querySelector('strong').textContent).toBe('line');
    expect(el.textContent).toContain('not quoted');
  });
});

describe('spoilers and mentions', () => {
  test('spoilers stay hidden spans and can hold formatting', () => {
    const el = md('the end: ||**they win**||');
    const s = el.querySelector('.md-spoiler');
    expect(s).toBeTruthy();
    expect(s.querySelector('strong').textContent).toBe('they win');
  });

  test('mentions are highlighted, yours more strongly', () => {
    const el = md('hi @me and @bob');
    const ms = [...el.querySelectorAll('.md-mention')];
    expect(ms.map((m) => m.textContent)).toEqual(['@me', '@bob']);
    expect(ms[0].className).toContain('md-mention-me');
  });

  test('mentions are plain text when disabled (DMs)', () => {
    expect(md('hi @bob', { me: 'me', mentions: false }).querySelector('.md-mention')).toBeNull();
  });

  test('an email address is not a mention', () => {
    expect(md('mail bob@example.com').querySelector('.md-mention')).toBeNull();
  });
});

describe('links', () => {
  test('http(s) URLs become safe links, trailing punctuation excluded', () => {
    const el = md('see https://example.com/a?b=1. and (http://x.io/y)');
    const links = [...el.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://example.com/a?b=1', 'http://x.io/y']);
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer nofollow');
    }
    expect(el.textContent).toBe('see https://example.com/a?b=1. and (http://x.io/y)');
  });

  test('javascript: and other schemes never become links', () => {
    const el = md('javascript:alert(1) data:text/html,x vbscript:x ftp://x');
    expect(el.querySelector('a')).toBeNull();
  });

  test('URLs inside code are not links', () => {
    expect(md('`https://example.com`').querySelector('a')).toBeNull();
  });
});

describe('safety and performance', () => {
  test('HTML is shown as text, never parsed', () => {
    const el = md('<img src=x onerror="alert(1)"> <script>alert(2)</script>');
    expect(el.querySelector('img, script')).toBeNull();
    expect(el.textContent).toBe('<img src=x onerror="alert(1)"> <script>alert(2)</script>');
  });

  test.each([
    ['*', '*'.repeat(4000)],
    ['**a', '**a'.repeat(1333)],
    ['_', '_'.repeat(4000)],
    ['`', '`'.repeat(4000)],
    ['||', '|'.repeat(4000)],
  ])('4,000 characters of %s render quickly', (_name, text) => {
    const start = performance.now();
    const el = md(text);
    const ms = performance.now() - start;
    expect(el.textContent.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(50);
  });
});
