import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { applyTheme, getTheme, resolveTheme, setTheme, watchSystemTheme } from './theme.js';

// A controllable prefers-color-scheme: light media query.
let prefersLight;
let listeners;
beforeEach(() => {
  localStorage.clear();
  prefersLight = false;
  listeners = new Set();
  vi.stubGlobal('matchMedia', (q) => ({
    media: q,
    get matches() {
      return prefersLight;
    },
    addEventListener: (_, fn) => listeners.add(fn),
    removeEventListener: (_, fn) => listeners.delete(fn),
  }));
  document.head.innerHTML = '<meta name="theme-color" content="#0E0B1A">';
  delete document.documentElement.dataset.theme;
});
afterEach(() => vi.unstubAllGlobals());

const theme = () => document.documentElement.dataset.theme;
const metaColor = () => document.querySelector('meta[name="theme-color"]').getAttribute('content');
const osSwitch = (light) => {
  prefersLight = light;
  for (const fn of listeners) fn();
};

describe('choice', () => {
  test('dark by default, and nonsense in storage is ignored', () => {
    expect(getTheme()).toBe('dark');
    localStorage.setItem('disgourd.theme', 'neon');
    expect(getTheme()).toBe('dark');
  });

  test('setTheme saves the choice and applies it', () => {
    setTheme('light');
    expect(getTheme()).toBe('light');
    expect(theme()).toBe('light');
    expect(metaColor()).toBe('#EAE5F7');
    setTheme('dark');
    expect(theme()).toBe('dark');
    expect(metaColor()).toBe('#0E0B1A');
  });

  test('system follows the OS setting', () => {
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
    expect(resolveTheme('light', false)).toBe('light');
  });
});

test('in system mode, an OS theme change applies straight away, without a reload', () => {
  setTheme('system');
  const stop = watchSystemTheme();
  expect(theme()).toBe('dark');
  osSwitch(true);
  expect(theme()).toBe('light');
  osSwitch(false);
  expect(theme()).toBe('dark');
  stop();
  expect(listeners.size).toBe(0);
});

test('an OS change is ignored when you picked a theme yourself', () => {
  setTheme('dark');
  watchSystemTheme();
  osSwitch(true);
  expect(theme()).toBe('dark');
});

test('applyTheme with no argument uses the saved choice', () => {
  localStorage.setItem('disgourd.theme', 'light');
  expect(applyTheme()).toBe('light');
  expect(theme()).toBe('light');
});

// public/theme-init.js runs before the app (and before first paint) so a
// light-theme user never sees a dark flash. It must agree with theme.js.
describe('theme-init.js', () => {
  const run = () => new Function(readFileSync(resolvePath('public/theme-init.js'), 'utf8'))();
  test.each([
    [null, false, 'dark'],
    ['light', false, 'light'],
    ['dark', true, 'dark'],
    ['system', true, 'light'],
    ['system', false, 'dark'],
  ])('saved %s, OS light %s -> %s', (saved, osLight, expected) => {
    if (saved) localStorage.setItem('disgourd.theme', saved);
    prefersLight = osLight;
    run();
    expect(theme()).toBe(expected);
    expect(metaColor()).toBe(expected === 'light' ? '#EAE5F7' : '#0E0B1A');
    expect(theme()).toBe(resolveTheme(getTheme(), osLight));
  });
});
