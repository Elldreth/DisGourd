import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { highlight } from './highlight.js';
import { hastToReact } from './hastToReact.jsx';
import { renderMarkdown } from './markdown.jsx';

afterEach(cleanup);

const classesIn = (tree) => {
  const out = new Set();
  const walk = (n) => {
    if (n.type === 'element') (n.properties.className || []).forEach((c) => out.add(c));
    (n.children || []).forEach(walk);
  };
  walk(tree);
  return out;
};

describe('highlight', () => {
  test('known languages produce keyword and string tokens', () => {
    const cls = classesIn(highlight('const name = "gourd";', 'js'));
    expect(cls.has('hljs-keyword')).toBe(true);
    expect(cls.has('hljs-string')).toBe(true);
  });

  test.each(['ts', 'py', 'sh', 'html', 'yml', 'rs', 'cs', 'c++', 'JSON'])('alias %s is recognised', (lang) => {
    expect(highlight('x', lang)).not.toBeNull();
  });

  test('unknown or missing languages are not highlighted', () => {
    expect(highlight('x', 'brainfudge')).toBeNull();
    expect(highlight('x', '')).toBeNull();
    expect(highlight('x', undefined)).toBeNull();
  });
});

describe('hastToReact', () => {
  test('keeps coloured spans and text, drops any other element but keeps its text', () => {
    const tree = {
      type: 'root',
      children: [
        { type: 'element', tagName: 'span', properties: { className: ['hljs-keyword'] }, children: [{ type: 'text', value: 'let' }] },
        { type: 'text', value: ' x = ' },
        { type: 'element', tagName: 'script', properties: {}, children: [{ type: 'text', value: 'alert(1)' }] },
        { type: 'element', tagName: 'img', properties: { src: 'x', onError: 'alert(2)' }, children: [] },
      ],
    };
    const { container } = render(<code>{hastToReact(tree)}</code>);
    expect(container.querySelector('script, img')).toBeNull();
    expect(container.querySelector('span.hljs-keyword').textContent).toBe('let');
    expect(container.textContent).toBe('let x = alert(1)');
  });

  test('markup inside highlighted code stays text', () => {
    const { container } = render(<code>{hastToReact(highlight('<script>alert(1)</script>', 'html'))}</code>);
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toBe('<script>alert(1)</script>');
  });
});

describe('code blocks', () => {
  const block = (text) => render(<div>{renderMarkdown(text)}</div>).container;

  test('a known language upgrades to highlighted once the highlighter loads', async () => {
    const el = block('```js\nconst a = 1; // hi\n```');
    await waitFor(() => expect(el.querySelector('.hljs-keyword')).toBeTruthy());
    expect(el.querySelector('pre code').textContent).toBe('const a = 1; // hi');
    expect(el.querySelector('.hljs-comment').textContent).toBe('// hi');
  });

  test('unknown language and no language stay plain', async () => {
    const el = block('```wat\nconst a = 1;\n```\n```\nconst b = 2;\n```');
    await new Promise((r) => setTimeout(r, 50));
    expect(el.querySelector('[class^="hljs"]')).toBeNull();
    expect([...el.querySelectorAll('pre code')].map((c) => c.textContent)).toEqual(['const a = 1;', 'const b = 2;']);
  });
});
