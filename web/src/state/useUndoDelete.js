import { useEffect, useRef, useState } from 'react';

// Delete with undo. Deleting a message hides it here at once and shows
// "Message deleted · Undo"; the delete is only sent after `delay` (so Undo
// means nobody else ever saw it go). Leaving the page sends pending deletes
// straight away (best effort: the socket may already be closing). The server
// doesn't answer a refused delete, so after sending we wait `confirmWait` for
// the message to drop out of the list; if it's still there, it comes back
// with an error toast.
//
//   const undo = useUndoDelete({ toast });
//   undo.request(key, { send, exists })   key: unique per message (e.g. 'c:12')
//   undo.isHidden(key)
export function useUndoDelete({ toast, delay = 5000, confirmWait = 5000 }) {
  const [hidden, setHidden] = useState(() => new Set());
  const pending = useRef(new Map()); // key -> { timer, send, exists }
  const waiting = useRef(new Map()); // key -> timer (sent, waiting to see it go)
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const hide = (key) => setHidden((s) => new Set(s).add(key));
  const unhide = (key) =>
    setHidden((s) => {
      if (!s.has(key)) return s;
      const next = new Set(s);
      next.delete(key);
      return next;
    });

  function commit(key) {
    const p = pending.current.get(key);
    if (!p) return;
    clearTimeout(p.timer);
    pending.current.delete(key);
    p.send();
    waiting.current.set(
      key,
      setTimeout(() => {
        waiting.current.delete(key);
        unhide(key);
        if (p.exists()) toastRef.current.show({ message: "Couldn't delete that message", tone: 'error' });
      }, confirmWait)
    );
  }

  function undo(key) {
    const p = pending.current.get(key);
    if (!p) return;
    clearTimeout(p.timer);
    pending.current.delete(key);
    unhide(key);
    toastRef.current.dismiss(key);
  }

  function request(key, { send, exists }) {
    if (pending.current.has(key)) return;
    hide(key);
    pending.current.set(key, { timer: setTimeout(() => commit(key), delay), send, exists });
    toastRef.current.show({ id: key, message: 'Message deleted', actionLabel: 'Undo', onAction: () => undo(key), duration: delay });
  }

  // Send whatever is still waiting when the page goes away or this unmounts.
  const flushRef = useRef(null);
  flushRef.current = () => [...pending.current.keys()].forEach(commit);
  useEffect(() => {
    const flush = () => flushRef.current();
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
      waiting.current.forEach(clearTimeout);
    };
  }, []);

  return { request, undo, isHidden: (key) => hidden.has(key) };
}
