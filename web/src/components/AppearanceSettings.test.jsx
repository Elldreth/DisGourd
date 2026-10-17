import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import AppearanceSettings from './AppearanceSettings.jsx';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('shows the saved choice, and picking one applies and saves it', () => {
  localStorage.setItem('disgourd.theme', 'system');
  render(<AppearanceSettings />);
  expect(screen.getByLabelText('Match my system').checked).toBe(true);

  fireEvent.click(screen.getByLabelText('Light'));
  expect(document.documentElement.dataset.theme).toBe('light');
  expect(localStorage.getItem('disgourd.theme')).toBe('light');
  expect(screen.getByLabelText('Light').checked).toBe(true);

  fireEvent.click(screen.getByLabelText('Dark'));
  expect(document.documentElement.dataset.theme).toBe('dark');
});
