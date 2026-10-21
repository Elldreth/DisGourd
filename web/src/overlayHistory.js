import { useEffect, useRef } from 'react';

// Phones: an open overlay (the thread panel, the member drawer, the nav
// drawer) gets a history entry, so the hardware back button closes it instead
// of leaving the app. Closing it any other way takes that entry back out, so
// the stack stays balanced. From lg up the overlays are static columns, and
// nothing is pushed. The invite deep link only uses replaceState, so the two
// never interfere.
//
//   useOverlayHistory('thread', !!openThread, closeThread)
//
// `win` and `enabled` exist for tests (a fake window, a fixed answer).
const KEY = 'dgOverlay';
const phone = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1023px)').matches;

// history.back() is asynchronous. If one overlay closes as another opens
// (the nav drawer closing as Server settings opens on a phone, P10-01), the
// new overlay's pushState must wait for that back() to land, or the back
// would pop the new entry instead and close what just opened.
let backPending = false;
const waiting = new Set();
function takeEntryBack(win) {
  backPending = true;
  const done = () => {
    win.removeEventListener('popstate', done);
    clearTimeout(timer);
    if (!backPending) return;
    backPending = false;
    const ready = [...waiting];
    waiting.clear();
    ready.forEach((fn) => fn());
  };
  const timer = setTimeout(done, 400); // in case no popstate ever comes
  win.addEventListener('popstate', done);
  win.history.back();
}

export function useOverlayHistory(id, open, onClose, { win = typeof window !== 'undefined' ? window : null, enabled = phone } = {}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const pushed = useRef(false); // our entry is in the stack

  useEffect(() => {
    if (!win) return;
    if (open) {
      if (!enabled()) return;
      const onPop = () => {
        // Our entry was popped (by the back button) and no other overlay's
        // entry sits above it: close.
        if (win.history.state?.[KEY] === id) return;
        pushed.current = false;
        closeRef.current?.();
      };
      const start = () => {
        win.history.pushState({ [KEY]: id }, '');
        pushed.current = true;
        win.addEventListener('popstate', onPop);
      };
      if (backPending) waiting.add(start);
      else start();
      return () => {
        waiting.delete(start);
        win.removeEventListener('popstate', onPop);
        // Closed by its own UI (or unmounted) while our entry is still on top:
        // take the entry out without re-closing.
        if (pushed.current && win.history.state?.[KEY] === id) {
          pushed.current = false;
          takeEntryBack(win);
        }
      };
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id, win]);
}
