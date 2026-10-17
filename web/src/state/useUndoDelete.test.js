import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useUndoDelete } from './useUndoDelete.js';

let toast;
beforeEach(() => {
  vi.useFakeTimers();
  toast = { show: vi.fn(), dismiss: vi.fn() };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup() {
  return renderHook(() => useUndoDelete({ toast }));
}

test('delete hides the message at once but sends nothing for 5 seconds', () => {
  const { result } = setup();
  const send = vi.fn();
  act(() => result.current.request('c:7', { send, exists: () => true }));
  expect(result.current.isHidden('c:7')).toBe(true);
  expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ id: 'c:7', message: 'Message deleted', actionLabel: 'Undo' }));
  act(() => vi.advanceTimersByTime(4900));
  expect(send).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(200));
  expect(send).toHaveBeenCalledTimes(1);
});

test('Undo within 5 seconds restores it and never sends the delete', () => {
  const { result } = setup();
  const send = vi.fn();
  act(() => result.current.request('c:7', { send, exists: () => true }));
  const { onAction } = toast.show.mock.calls[0][0];
  act(() => onAction());
  expect(result.current.isHidden('c:7')).toBe(false);
  expect(toast.dismiss).toHaveBeenCalledWith('c:7');
  act(() => vi.advanceTimersByTime(20000));
  expect(send).not.toHaveBeenCalled();
});

test('leaving the page sends pending deletes straight away', () => {
  const { result } = setup();
  const send = vi.fn();
  act(() => result.current.request('d:3', { send, exists: () => false }));
  act(() => window.dispatchEvent(new Event('pagehide')));
  expect(send).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(20000));
  expect(send).toHaveBeenCalledTimes(1); // not again
});

test('once the server removes it, it stays gone', () => {
  const { result } = setup();
  let present = true;
  act(() => result.current.request('c:7', { send: () => (present = false), exists: () => present }));
  act(() => vi.advanceTimersByTime(5000)); // sent
  act(() => vi.advanceTimersByTime(5000)); // confirmation window
  expect(toast.show).toHaveBeenCalledTimes(1); // just "Message deleted"
});

test('if the server keeps it (no permission, already gone…), it comes back with an error', () => {
  const { result } = setup();
  act(() => result.current.request('c:7', { send: () => {}, exists: () => true }));
  act(() => vi.advanceTimersByTime(5000)); // sent
  expect(result.current.isHidden('c:7')).toBe(true); // still hidden while we wait to hear back
  act(() => vi.advanceTimersByTime(5000));
  expect(result.current.isHidden('c:7')).toBe(false);
  expect(toast.show).toHaveBeenLastCalledWith(expect.objectContaining({ message: "Couldn't delete that message", tone: 'error' }));
});
