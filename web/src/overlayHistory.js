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

export function useOverlayHistory(id, open, onClose, { win = typeof window !== 'undefined' ? window : null, enabled = phone } = {}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const pushed = useRef(false); // our entry is in the stack

  useEffect(() => {
    if (!win) return;
    if (open) {
      if (!enabled()) return;
      win.history.pushState({ [KEY]: id }, '');
      pushed.current = true;
      const onPop = () => {
        // Our entry was popped (by the back button) and no other overlay's
        // entry sits above it: close.
        if (win.history.state?.[KEY] === id) return;
        pushed.current = false;
        closeRef.current?.();
      };
      win.addEventListener('popstate', onPop);
      return () => {
        win.removeEventListener('popstate', onPop);
        // Closed by its own UI (or unmounted) while our entry is still on top:
        // take the entry out without re-closing.
        if (pushed.current && win.history.state?.[KEY] === id) {
          pushed.current = false;
          win.history.back();
        }
      };
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id, win]);
}
