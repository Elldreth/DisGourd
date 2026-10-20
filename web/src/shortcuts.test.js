import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { matchShortcut, stepChannel, useShortcuts } from './shortcuts.js';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

const key = (k, mods = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

test('matchShortcut names the app shortcuts and leaves others alone', () => {
  expect(matchShortcut(key('k', { ctrlKey: true }))).toBe('switcher');
  expect(matchShortcut(key('K', { metaKey: true }))).toBe('switcher');
  expect(matchShortcut(key('k', { ctrlKey: true, shiftKey: true }))).toBe('people'); // P4-04: new message
  expect(matchShortcut(key('ArrowDown', { altKey: true }))).toBe('next');
  expect(matchShortcut(key('ArrowUp', { altKey: true }))).toBe('prev');
  expect(matchShortcut(key('ArrowDown', { altKey: true, shiftKey: true }))).toBe('next-unread');
  expect(matchShortcut(key('ArrowUp', { altKey: true, shiftKey: true }))).toBe('prev-unread');
  expect(matchShortcut(key('ArrowDown'))).toBe(null);
  expect(matchShortcut(key('M', { ctrlKey: true, shiftKey: true }))).toBe(null); // voice mute stays voice's
  expect(matchShortcut(key('D', { ctrlKey: true, shiftKey: true }))).toBe(null);
});

test('stepChannel moves through channels and wraps around', () => {
  const list = ['general', 'random', 'memes'];
  expect(stepChannel(list, 'general', 1)).toBe('random');
  expect(stepChannel(list, 'memes', 1)).toBe('general');
  expect(stepChannel(list, 'general', -1)).toBe('memes');
  expect(stepChannel([], 'general', 1)).toBe(null);
  expect(stepChannel(['general'], 'general', 1)).toBe(null);
});

test('stepChannel can skip to the next unread one, or give up if none', () => {
  const list = ['general', 'random', 'memes', 'art'];
  const unread = (c) => c === 'art' || c === 'random';
  expect(stepChannel(list, 'random', 1, unread)).toBe('art');
  expect(stepChannel(list, 'art', 1, unread)).toBe('random');
  expect(stepChannel(list, 'general', -1, unread)).toBe('art');
  expect(stepChannel(list, 'general', 1, () => false)).toBe(null);
});

function fire(target, init) {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}

test('shortcuts run before a focused text field sees the key, and Ctrl+K skips the browser', () => {
  const onAction = vi.fn();
  renderHook(() => useShortcuts(onAction));
  const box = document.createElement('textarea');
  const boxSaw = vi.fn();
  box.addEventListener('keydown', boxSaw);
  document.body.append(box);
  box.focus();

  const e = fire(box, { key: 'k', ctrlKey: true });
  expect(onAction).toHaveBeenLastCalledWith('switcher');
  expect(e.defaultPrevented).toBe(true);

  fire(box, { key: 'ArrowUp', altKey: true });
  expect(onAction).toHaveBeenLastCalledWith('prev');
  expect(boxSaw).not.toHaveBeenCalled(); // the composer's own ArrowUp never fires

  fire(box, { key: 'ArrowUp' });
  expect(boxSaw).toHaveBeenCalledTimes(1); // plain keys still reach it
  expect(onAction).toHaveBeenCalledTimes(2);
});

test('while a dialog is open only Ctrl+K is blocked, nothing navigates', () => {
  const onAction = vi.fn();
  renderHook(() => useShortcuts(onAction));
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  document.body.append(dialog);
  const e = fire(document.body, { key: 'k', ctrlKey: true });
  expect(e.defaultPrevented).toBe(true);
  fire(document.body, { key: 'ArrowDown', altKey: true });
  expect(onAction).not.toHaveBeenCalled();
});

// P7-02: Ctrl/⌘+/ opens the shortcuts sheet, from inside the message box too.
test('Ctrl+/ and ⌘+/ open the shortcuts sheet; not with Shift or Alt, and not over a dialog', () => {
  expect(matchShortcut(key('/', { ctrlKey: true }))).toBe('help');
  expect(matchShortcut(key('/', { metaKey: true }))).toBe('help');
  expect(matchShortcut(key('/', { ctrlKey: true, shiftKey: true }))).toBeNull();
  expect(matchShortcut(key('/', { ctrlKey: true, altKey: true }))).toBeNull();
  expect(matchShortcut(key('/'))).toBeNull();

  const onAction = vi.fn();
  renderHook(() => useShortcuts(onAction));
  const box = document.createElement('textarea');
  document.body.append(box);
  box.focus();
  fire(box, { key: '/', ctrlKey: true });
  expect(onAction).toHaveBeenLastCalledWith('help');
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  document.body.append(dialog);
  fire(document.body, { key: '/', ctrlKey: true });
  expect(onAction).toHaveBeenCalledTimes(1);
});
