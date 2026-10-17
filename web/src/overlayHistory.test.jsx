import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useOverlayHistory } from './overlayHistory.js';

// P4-07: on phones an open overlay (thread panel, member drawer, nav drawer)
// gets a history entry, so the hardware back button closes it instead of
// leaving the app. Closing it any other way takes that entry back out, so the
// stack stays balanced. On desktop nothing is pushed.

// A stand-in for window: a history stack and popstate listeners, deterministic.
function fakeWindow() {
  const stack = [null];
  const listeners = new Set();
  const win = {
    history: {
      get length() {
        return stack.length;
      },
      get state() {
        return stack[stack.length - 1];
      },
      pushState(state) {
        stack.push(state);
      },
      back() {
        if (stack.length > 1) stack.pop();
        listeners.forEach((fn) => fn({ state: win.history.state }));
      },
    },
    addEventListener: (type, fn) => type === 'popstate' && listeners.add(fn),
    removeEventListener: (type, fn) => type === 'popstate' && listeners.delete(fn),
  };
  return win;
}

function Probe({ open, onClose, win, enabled }) {
  useOverlayHistory('thread', open, onClose, { win, enabled });
  return null;
}

afterEach(cleanup);

test('opening pushes one entry; the back button closes the overlay; closing by hand pops the entry', () => {
  const win = fakeWindow();
  const onClose = vi.fn();
  const { rerender } = render(<Probe open={false} onClose={onClose} win={win} enabled={() => true} />);
  expect(win.history.length).toBe(1);

  rerender(<Probe open onClose={onClose} win={win} enabled={() => true} />);
  expect(win.history.length).toBe(2);
  expect(win.history.state).toEqual({ dgOverlay: 'thread' });

  // Hardware back: the entry is gone and the overlay is asked to close.
  act(() => win.history.back());
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(win.history.length).toBe(1);
  rerender(<Probe open={false} onClose={onClose} win={win} enabled={() => true} />);
  expect(win.history.length).toBe(1); // nothing left behind

  // Closed by its own UI instead: the entry is taken back out, onClose not called again.
  rerender(<Probe open onClose={onClose} win={win} enabled={() => true} />);
  expect(win.history.length).toBe(2);
  rerender(<Probe open={false} onClose={onClose} win={win} enabled={() => true} />);
  expect(win.history.length).toBe(1);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('three open/close rounds leave the history length where it started', () => {
  const win = fakeWindow();
  const { rerender } = render(<Probe open={false} onClose={() => {}} win={win} enabled={() => true} />);
  for (let i = 0; i < 3; i++) {
    rerender(<Probe open onClose={() => {}} win={win} enabled={() => true} />);
    rerender(<Probe open={false} onClose={() => {}} win={win} enabled={() => true} />);
  }
  expect(win.history.length).toBe(1);
});

test('on desktop nothing is pushed and back does nothing to the overlay', () => {
  const win = fakeWindow();
  const onClose = vi.fn();
  const { rerender } = render(<Probe open={false} onClose={onClose} win={win} enabled={() => false} />);
  rerender(<Probe open onClose={onClose} win={win} enabled={() => false} />);
  expect(win.history.length).toBe(1);
  act(() => win.history.back());
  expect(onClose).not.toHaveBeenCalled();
});

test('a back press that pops someone else\'s entry does not close this overlay', () => {
  const win = fakeWindow();
  const onClose = vi.fn();
  const { rerender } = render(<Probe open={false} onClose={onClose} win={win} enabled={() => true} />);
  rerender(<Probe open onClose={onClose} win={win} enabled={() => true} />);
  win.history.pushState({ dgOverlay: 'members' }); // another overlay on top
  act(() => win.history.back()); // pops the members entry; ours is on top again
  expect(onClose).not.toHaveBeenCalled();
  act(() => win.history.back());
  expect(onClose).toHaveBeenCalledTimes(1);
});
