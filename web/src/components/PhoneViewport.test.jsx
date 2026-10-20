// P7-04: phones — the app is as tall as the visible screen, the page reaches
// the screen edges (viewport-fit=cover), and the message box and user footer
// keep clear of the home bar.
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

vi.mock('../api.js', () => ({ uploadFile: vi.fn() }));
const { default: Composer } = await import('./Composer.jsx');
const { default: UserFooter } = await import('./UserFooter.jsx');

afterEach(cleanup);
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('the viewport meta asks for the whole screen', () => {
  expect(read('../../index.html')).toMatch(/<meta name="viewport" content="[^"]*viewport-fit=cover/);
});

test('the app root uses the visible height (100% stays as the fallback) and clears side notches', () => {
  const css = read('../index.css');
  expect(css).toMatch(/html,\s*body,\s*#root\s*\{\s*height: 100%;/);
  const root = css.match(/#root\s*\{\s*height: 100dvh;[^}]*\}/);
  expect(root).toBeTruthy();
  expect(root[0]).toContain('padding-left: env(safe-area-inset-left)');
  expect(root[0]).toContain('padding-right: env(safe-area-inset-right)');
});

test('the message box and the user footer keep clear of the home bar', () => {
  const { container } = render(<Composer channel="general" disabled={false} onSend={() => {}} onTyping={() => {}} />);
  expect(container.firstChild.className).toContain('pb-[max(1.25rem,env(safe-area-inset-bottom))]');
  cleanup();
  const footer = render(<UserFooter user="sandy" status="open" presence="online" onSetPresence={() => {}} onOpenProfile={() => {}} onLogout={() => {}} />);
  expect(footer.container.firstChild.className).toContain('pb-[max(0.5rem,env(safe-area-inset-bottom))]');
});
