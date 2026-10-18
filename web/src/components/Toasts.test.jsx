import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ToastProvider, useToasts } from './Toasts.jsx';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

let api;
function Grab() {
  api = useToasts();
  return <button>Somewhere else</button>;
}

function setup() {
  render(
    <ToastProvider>
      <Grab />
    </ToastProvider>
  );
}

test('toasts appear in a polite live region and go away after their duration', () => {
  setup();
  const region = screen.getByRole('status');
  expect(region.getAttribute('aria-live')).toBe('polite');
  act(() => api.show({ id: 'a', message: 'Message deleted', duration: 5000 }));
  expect(region.textContent).toContain('Message deleted');
  act(() => vi.advanceTimersByTime(5100));
  expect(region.textContent).not.toContain('Message deleted');
});

test('the action button works by keyboard and does not steal focus when it appears', () => {
  setup();
  const elsewhere = screen.getByRole('button', { name: 'Somewhere else' });
  elsewhere.focus();
  const onAction = vi.fn();
  act(() => api.show({ id: 'a', message: 'Message deleted', actionLabel: 'Undo', onAction, duration: 5000 }));
  expect(document.activeElement).toBe(elsewhere);
  const undo = screen.getByRole('button', { name: 'Undo' });
  fireEvent.click(undo);
  expect(onAction).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull(); // acting dismisses it
});

test('showing a toast with the same id replaces it; dismiss removes it', () => {
  setup();
  act(() => api.show({ id: 'a', message: 'one' }));
  act(() => api.show({ id: 'a', message: 'two' }));
  expect(screen.getByRole('status').textContent).toContain('two');
  expect(screen.getByRole('status').textContent).not.toContain('one');
  act(() => api.dismiss('a'));
  expect(screen.getByRole('status').textContent).not.toContain('two');
});

test('a top toast (the update notice) shows in the top list, clear of the composer; others stay at the bottom', () => {
  setup();
  act(() => api.show({ id: 'sw-update', message: 'A new version is ready.', actionLabel: 'Reload', placement: 'top', dismissible: true }));
  act(() => api.show({ id: 'del', message: 'Message deleted', actionLabel: 'Undo' }));
  const region = screen.getByRole('status');
  const top = region.querySelector('[data-placement="top"]');
  const bottom = region.querySelector('[data-placement="bottom"]');
  expect(top.className).toContain('top-14');
  expect(top.textContent).toContain('A new version is ready.');
  expect(top.textContent).not.toContain('Message deleted');
  expect(bottom.className).toContain('bottom-20');
  expect(bottom.textContent).toContain('Message deleted');
  expect(bottom.textContent).not.toContain('A new version is ready.');
});

test('P3-32: the top row (the update notice) sits below dialogs (z-50); quick notices at the bottom stay above them', () => {
  setup();
  const region = screen.getByRole('status');
  expect(region.querySelector('[data-placement="top"]').className).toMatch(/(^| )z-45( |$)/);
  expect(region.querySelector('[data-placement="bottom"]').className).toMatch(/(^| )z-60( |$)/);
});

test('a dismissible toast closes from its Dismiss button without running its action', () => {
  setup();
  const onAction = vi.fn();
  act(() => api.show({ id: 'sw-update', message: 'A new version is ready.', actionLabel: 'Reload', onAction, placement: 'top', dismissible: true }));
  expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(onAction).not.toHaveBeenCalled();
  expect(screen.getByRole('status').textContent).not.toContain('A new version is ready.');
});

test('toasts are not dismissible unless asked', () => {
  setup();
  act(() => api.show({ id: 'a', message: 'Message deleted', actionLabel: 'Undo' }));
  expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
});
