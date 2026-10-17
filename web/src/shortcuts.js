import { useEffect, useRef } from 'react';

// App-wide keyboard shortcuts:
//   Ctrl/Cmd+K          open the quick switcher ('switcher')
//   Ctrl/Cmd+Shift+K    new direct message: the people picker ('people')
//   Alt+↑ / Alt+↓       previous / next text channel ('prev' / 'next')
//   Alt+Shift+↑ / ↓     previous / next unread channel ('prev-unread' / 'next-unread')
// Voice owns Ctrl+Shift+M/D and the push-to-talk key; none of these overlap.
export function matchShortcut(e) {
  const k = e.key;
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (k === 'k' || k === 'K')) return e.shiftKey ? 'people' : 'switcher';
  if (e.altKey && !e.ctrlKey && !e.metaKey && (k === 'ArrowUp' || k === 'ArrowDown')) {
    const dir = k === 'ArrowUp' ? 'prev' : 'next';
    return e.shiftKey ? `${dir}-unread` : dir;
  }
  return null;
}

// The channel `dir` (+1 / -1) steps from `current`, wrapping around. With
// `want`, skip to the nearest channel it accepts. null when there's nowhere to go.
export function stepChannel(channels, current, dir, want = () => true) {
  const n = channels.length;
  const at = channels.indexOf(current);
  for (let step = 1; step <= n; step++) {
    // Not in the list (e.g. a voice channel): start from the first or last one.
    const i = at < 0 ? (dir > 0 ? step - 1 : n - step) : (((at + dir * step) % n) + n) % n;
    const c = channels[i];
    if (c !== current && want(c)) return c;
  }
  return null;
}

// Listen on window in the capture phase so shortcuts work from inside the
// composer and never reach it (Alt+↑ must not also mean "edit last message").
// While a modal dialog is open nothing navigates, but Ctrl+K is still kept
// from the browser.
export function useShortcuts(onAction) {
  const ref = useRef(onAction);
  ref.current = onAction;
  useEffect(() => {
    const onKey = (e) => {
      const action = matchShortcut(e);
      if (!action) return;
      e.preventDefault();
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      e.stopPropagation();
      ref.current(action);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}
