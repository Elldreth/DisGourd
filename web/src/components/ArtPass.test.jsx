// P8 art pass: mascot poses, the sign-in art, ready-made server icons.
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../serverGlyphs.js', async (orig) => {
  const real = await orig();
  // jsdom can't draw to a canvas: hand back a small PNG file instead.
  return { ...real, glyphToPng: vi.fn(async (g) => new File(['png'], `${g.id}.png`, { type: 'image/png' })) };
});
const { default: Mascot } = await import('./Mascot.jsx');
const { default: LoginArt } = await import('./LoginArt.jsx');
const { default: GlyphPicker } = await import('./GlyphPicker.jsx');
const { default: AuthShell } = await import('./AuthShell.jsx');
const { POSE_NAMES, mascotSvg } = await import('../mascotParts.js');
const { SERVER_GLYPHS, glyphTileSvg } = await import('../serverGlyphs.js');

afterEach(cleanup);

test('seven poses, each drawn only with the theme colours, no face, and small', () => {
  expect(POSE_NAMES).toEqual(['wave', 'sleep', 'music', 'search', 'confused', 'party', 'shush']);
  for (const pose of POSE_NAMES) {
    cleanup();
    const { container } = render(<Mascot pose={pose} size={80} />);
    const svg = container.querySelector('svg');
    expect(svg.getAttribute('data-pose')).toBe(pose);
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    const markup = svg.outerHTML;
    expect(markup, pose).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    expect(markup, pose).toMatch(/var\(--color-brand-logo\)/);
    expect(markup, pose).toMatch(/var\(--color-lime\)/);
    expect(markup.length, pose).toBeLessThan(5000);
  }
});

test('a pose can be named for screen readers, or drawn in one colour', () => {
  const { container } = render(<Mascot pose="party" title="Celebrating" color="currentColor" />);
  expect(screen.getByRole('img', { name: 'Celebrating' })).toBeTruthy();
  expect(container.innerHTML).not.toMatch(/var\(--color/);
});

test('the static copy (offline page) matches the shapes, with plain colours', () => {
  const svg = mascotSvg('sleep', { size: 96 });
  expect(svg).toMatch(/^<svg [^>]*viewBox="-12 -4 120 108"/);
  expect(svg).toContain('#9466FF');
  expect(svg).toContain('rotate(-14 50 92)');
});

test('the sign-in art draws a garland for wide screens and a ground vine for phones, from the theme', () => {
  const { container } = render(<LoginArt />);
  const wide = container.querySelector('[data-art="login-wide"]');
  const tall = container.querySelector('[data-art="login-tall"]');
  expect(wide.getAttribute('class')).toMatch(/\bmd:block\b/);
  expect(tall.getAttribute('class')).toMatch(/\bmd:hidden\b/);
  expect(container.firstChild.getAttribute('aria-hidden')).toBe('true');
  expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,6}\b/i);
});

test('the sign-in card shows the waving mascot; the setup wizard can ask for another pose', () => {
  render(<AuthShell title="Welcome" subtitle="Sign in"><p>form</p></AuthShell>);
  expect(document.querySelector('svg[data-pose="wave"]')).toBeTruthy();
  cleanup();
  render(<AuthShell title="Done" subtitle="" pose="party"><p>x</p></AuthShell>);
  expect(document.querySelector('svg[data-pose="party"]')).toBeTruthy();
});

test('twelve ready-made icons; picking one hands over a PNG file', async () => {
  expect(SERVER_GLYPHS).toHaveLength(12);
  expect(new Set(SERVER_GLYPHS.map((g) => g.id)).size).toBe(12);
  for (const g of SERVER_GLYPHS) expect(glyphTileSvg(g)).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  const onPick = vi.fn();
  render(<GlyphPicker onPick={onPick} />);
  const group = screen.getByRole('group', { name: 'Ready-made icons' });
  expect(within(group).getAllByRole('button')).toHaveLength(12);
  fireEvent.click(within(group).getByRole('button', { name: 'Use the rocket icon' }));
  await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
  const [file, glyph] = onPick.mock.calls[0];
  expect(file.type).toBe('image/png');
  expect(glyph.id).toBe('rocket');
});
