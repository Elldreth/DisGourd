// P10-06: the /imagine panel's chip groups are labelled, and a group that
// doesn't apply stays in place saying why, so the panel keeps its shape.
import { afterEach, expect, test } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import ImaginePanel from './ImaginePanel.jsx';

afterEach(cleanup);

const imagine = {
  available: true,
  remaining: 69,
  engines: [{ id: 'comfyui', name: 'ComfyUI (local)' }, { id: 'kie', name: 'kie.ai' }],
  styles: [{ id: 'default', name: 'Default' }, { id: 'anime', name: 'Anime' }],
  defaultStyle: 'default',
  pictures: { comfyui: { strength: true } },
};
const props = { imagine, shape: 'square', quality: 'standard', engine: 'comfyui', style: 'default', onShape() {}, onQuality() {}, onEngine() {}, onStyle() {}, onPickPicture() {} };
const rows = (c) => [...c.querySelectorAll('[data-option]')].map((r) => r.dataset.option);

test('each group has a visible label that names it for screen readers', () => {
  const { container } = render(<ImaginePanel {...props} />);
  expect(rows(container)).toEqual(['shape', 'quality', 'engine', 'style']);
  for (const name of ['Shape', 'Quality', 'Engine', 'Style']) {
    const group = screen.getByRole('group', { name });
    expect(group.getAttribute('aria-labelledby')).toBeTruthy();
  }
  expect(within(screen.getByRole('group', { name: 'Style' })).getByRole('button', { name: 'Anime' })).toBeTruthy();
});

test('with kie.ai, Style stays and says "ComfyUI only"; with a picture, Shape says it follows the picture', () => {
  const { container, rerender } = render(<ImaginePanel {...props} engine="kie" />);
  expect(rows(container)).toEqual(['shape', 'quality', 'engine', 'style']);
  expect(screen.queryByRole('group', { name: 'Style' })).toBeNull();
  expect(screen.getByText('ComfyUI only')).toBeTruthy();
  rerender(<ImaginePanel {...props} picture={{ url: 'blob:x', name: 'cat.png' }} />);
  expect(rows(container)).toEqual(['shape', 'quality', 'engine', 'style']);
  expect(screen.queryByRole('group', { name: 'Shape' })).toBeNull();
  expect(screen.getByText('follows the picture')).toBeTruthy();
});

test('one engine and one style: no Engine or Style rows at all', () => {
  const { container } = render(<ImaginePanel {...props} imagine={{ ...imagine, engines: [imagine.engines[0]], styles: [imagine.styles[0]] }} />);
  expect(rows(container)).toEqual(['shape', 'quality']);
});
