import { useEffect, useRef } from 'react';

// App-wide keyboard shortcuts:
//   Ctrl/Cmd+K          open the quick switcher ('switcher')
//   Ctrl/Cmd+Shift+K    new direct message: the people picker ('people')
//   Alt+↑ / Alt+↓       previous / next text channel ('prev' / 'next')
//   Alt+Shift+↑ / ↓     previous / next unread channel ('prev-unread' / 'next-unread')
//   Ctrl/Cmd+/          the keyboard shortcuts sheet ('help', P7-02)
// Voice owns Ctrl+Shift+M/D and the push-to-talk key; none of these overlap.
export function matchShortcut(e) {
  const k = e.key;
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && k === '/') return 'help';
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (k === 'k' || k === 'K')) return e.shiftKey ? 'people' : 'switcher';
  if (e.altKey && !e.ctrlKey && !e.metaKey && (k === 'ArrowUp' || k === 'ArrowDown')) {
    const dir = k === 'ArrowUp' ? 'prev' : 'next';
    return e.shiftKey ? `${dir}-unread` : dir;
  }
  return null;
}

// Every shortcut, for the sheet (P7-02). 'Mod' is Ctrl, or ⌘ on a Mac. Keep
// this in step with matchShortcut above, the composer, the message editor and
// the voice shortcuts (useVoiceCall).
export const SHORTCUT_GROUPS = [
  {
    title: 'Navigation',
    items: [
      { keys: ['Mod', 'K'], label: 'Jump to a channel, server or person' },
      { keys: ['Mod', 'Shift', 'K'], label: 'New direct message' },
      { keys: ['Alt', '↑'], label: 'Previous channel' },
      { keys: ['Alt', '↓'], label: 'Next channel' },
      { keys: ['Alt', 'Shift', '↑'], label: 'Previous unread channel' },
      { keys: ['Alt', 'Shift', '↓'], label: 'Next unread channel' },
      { keys: ['Mod', '/'], label: 'Keyboard shortcuts' },
      { keys: ['Esc'], label: 'Close a dialog or panel' },
    ],
  },
  {
    title: 'Messages',
    items: [
      { keys: ['Enter'], label: 'Send' },
      { keys: ['Shift', 'Enter'], label: 'New line' },
      { keys: ['↑'], label: 'Edit your last message (empty message box)' },
      { keys: ['Esc'], label: 'Cancel an edit' },
    ],
  },
  {
    title: 'Voice',
    items: [
      { keys: ['Ctrl', 'Shift', 'M'], label: 'Mute or unmute' },
      { keys: ['Ctrl', 'Shift', 'D'], label: 'Deafen or undeafen' },
    ],
  },
];

// Apple keyboards show ⌘ for the Ctrl/Cmd shortcuts.
export function isMac() {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
}

// Key names as shown: 'Mod' becomes ⌘ on a Mac and Ctrl elsewhere; on a Mac,
// Alt is ⌥ and Shift is ⇧.
export function keyNames(keys, mac) {
  const MAC = { Mod: '⌘', Alt: '⌥', Shift: '⇧' };
  return keys.map((k) => (k === 'Mod' ? (mac ? '⌘' : 'Ctrl') : mac && MAC[k] ? MAC[k] : k));
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
