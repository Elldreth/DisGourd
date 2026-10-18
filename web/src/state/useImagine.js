import { useCallback, useRef } from 'react';

// /imagine requests from this tab (P2-20d). `imagine(fields)` sends the op and
// resolves when the server queues it ({ jobId, messageId, … }), or rejects
// with the server's reason (err.code is NOT_ALLOWED, DISABLED, NO_ENGINE,
// NO_PERMISSION, BAD_PROMPT, BAD_OPTION, LIMIT or REFUSED). The server answers
// every request in order, so answers match requests first in, first out.
// `onQueued` runs after each accepted request (to refresh "left today").
export function useImagine({ send, onQueued }) {
  const pending = useRef([]);
  const queuedRef = useRef(onQueued);
  queuedRef.current = onQueued;

  const imagine = useCallback(
    (fields) =>
      new Promise((resolve, reject) => {
        pending.current.push({ resolve, reject });
        send({ op: 'imagine', ...fields }); // queued by the socket while it reconnects
      }),
    [send]
  );

  const handlers = {
    imagine_queued: (f) => {
      pending.current.shift()?.resolve(f);
      queuedRef.current?.(f);
    },
    error: (f) => {
      if (f.op !== 'imagine') return;
      pending.current.shift()?.reject(Object.assign(new Error(f.error || 'Could not generate'), { code: f.code }));
    },
  };

  return { imagine, handlers };
}
