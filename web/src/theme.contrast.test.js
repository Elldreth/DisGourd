// Every text / background pair the UI uses must reach WCAG AA (4.5:1) in both
// themes. The colours are read straight from index.css, so changing the
// palette re-checks this.
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

// Tests run from web/ (npm test --prefix web).
const css = readFileSync(resolvePath('src/index.css'), 'utf8');

function vars(block) {
  const out = {};
  for (const [, name, value] of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[name] = value.trim();
  return out;
}
const dark = vars(css.match(/@theme\s*\{([\s\S]*?)\n\}/)[1]);
const light = { ...dark, ...vars(css.match(/\[data-theme='light'\]\s*\{([\s\S]*?)\n\}/)[1]) };

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = ([r, g, b]) => {
  const c = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
// `fg` at `alpha` over `bg` (what bg-brand/15 etc. look like on a surface).
const over = (fg, alpha, bg) => fg.map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha)));

// [label, text, background]; colours are theme names, or [name, alpha, surface].
const PAIRS = [];
const SURFACES = ['ink-700', 'ink-800', 'ink-600', 'ink-900'];
for (const s of SURFACES) {
  for (const t of ['gray-100', 'gray-200', 'gray-300', 'gray-400', 'gray-500', 'fg', 'brand-hi', 'online', 'pink', 'danger', 'idle']) {
    PAIRS.push([`${t} text on ${s}`, t, s]);
  }
}
PAIRS.push(
  ['white on brand buttons', '#ffffff', 'brand'],
  ['white on brand hover', '#ffffff', 'brand-hover'],
  ['ink-900 text on danger fill', 'ink-900', 'danger'],
  ['ink-900 text on danger/80 fill (Leave)', 'ink-900', ['danger', 0.8, 'ink-800']],
  ['@mention (brand-hi on brand/15)', 'brand-hi', ['brand', 0.15, 'ink-700']],
  ['@you (fg on brand/40)', 'fg', ['brand', 0.4, 'ink-700']],
  ['your reaction (fg on brand/25)', 'fg', ['brand', 0.25, 'ink-700']],
  ['message mentioning you (gray-200 on pink/10)', 'gray-200', ['pink', 0.1, 'ink-700']],
  ['notice (idle on idle/10)', 'idle', ['idle', 0.1, 'ink-700']],
);

function resolve(theme, c) {
  if (Array.isArray(c)) return over(resolve(theme, c[0]), c[1], resolve(theme, c[2]));
  if (c.startsWith('#')) return rgb(c);
  const v = theme[`color-${c}`];
  if (!v) throw new Error(`no --color-${c}`);
  return rgb(v);
}

describe.each([
  ['dark', dark],
  ['light', light],
])('%s theme', (name, theme) => {
  test.each(PAIRS)('%s >= 4.5:1', (_, text, bg) => {
    expect(ratio(resolve(theme, text), resolve(theme, bg))).toBeGreaterThanOrEqual(4.5);
  });
});

test('the light theme overrides every theme colour', () => {
  const themed = Object.keys(dark).filter((k) => k.startsWith('color-'));
  const overridden = Object.keys(vars(css.match(/\[data-theme='light'\]\s*\{([\s\S]*?)\n\}/)[1]));
  const missing = themed.filter((k) => !overridden.includes(k) && k !== 'color-brand' && k !== 'color-brand-hover' && k !== 'color-brand-logo');
  expect(missing).toEqual([]);
});
