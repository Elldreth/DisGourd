import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import EmptyState, { ART } from './EmptyState.jsx';

// P4-03: one component for every empty state, with four flat spot
// illustrations drawn from the theme's colours.

afterEach(cleanup);

test('renders the art, a heading, a line of body text and an optional action', () => {
  const onClick = vi.fn();
  render(<EmptyState art="channel" title="Welcome to #general" body="Say hello!" action={{ label: 'Say hi', onClick }} />);
  expect(screen.getByRole('heading', { name: 'Welcome to #general' })).toBeTruthy();
  expect(screen.getByText('Say hello!')).toBeTruthy();
  const svg = document.querySelector('svg[data-art="channel"]');
  expect(svg.getAttribute('aria-hidden')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Say hi' }));
  expect(onClick).toHaveBeenCalled();
});

test('the seven illustrations exist, draw with theme colours only, and stay small', () => {
  expect(Object.keys(ART).sort()).toEqual(['channel', 'clear', 'dms', 'imagine', 'privacy', 'search', 'server']); // imagine: P5-06; clear: P10-01; privacy: P10-02
  for (const name of Object.keys(ART)) {
    cleanup();
    const { container } = render(<EmptyState art={name} title="t" />);
    const svg = container.querySelector(`svg[data-art="${name}"]`);
    expect(svg, name).toBeTruthy();
    const markup = svg.outerHTML;
    // Colours come from CSS variables, never literals, so the light theme works.
    expect(markup, name).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    expect(markup, name).toMatch(/var\(--color-brand-logo\)/);
    expect(markup, name).toMatch(/var\(--color-lime\)/);
    expect(markup.length, name).toBeLessThan(6000);
  }
});

test('a plain variant with an icon instead of art, for small panels', () => {
  render(<EmptyState icon="pin" title="No pinned messages yet" body="Pin one from its menu." compact />);
  expect(document.querySelector('svg[data-icon="pin"]')).toBeTruthy();
  expect(document.querySelector('svg[data-art]')).toBeNull();
  expect(screen.getByText('No pinned messages yet').tagName).toBe('P');
});

test('the heading level can be chosen, and no body means no empty paragraph', () => {
  render(<EmptyState art="server" title="No server selected" as="h2" />);
  expect(screen.getByRole('heading', { level: 2, name: 'No server selected' })).toBeTruthy();
  expect(document.querySelectorAll('p')).toHaveLength(0);
});
