import { useEffect, useRef, useState, useCallback } from 'react';

// A single resilient "gateway" WebSocket for the whole session. It carries
// events for every server/channel the user belongs to, so the client keeps one
// connection regardless of which channel is open.
//
//  - Auto-reconnects with exponential backoff + jitter after any unclean close.
//  - Queues outgoing frames while offline and flushes them on reconnect.
//  - Dispatches incoming frames to handlers keyed by the frame's `type`.
//
// Returns { status, send, reconnects } where status is one of:
//   'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'
// and reconnects counts how many times the socket has opened again after the
// first time (feature hooks resync when it changes).
export function useGateway({ token, handlers }) {
  const [status, setStatus] = useState('idle');
  const [reconnects, setReconnects] = useState(0);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const sendRef = useRef(() => false);

  useEffect(() => {
    if (!token) {
      setStatus('idle');
      return undefined;
    }

    let ws = null;
    let intentional = false;
    let attempt = 0;
    let openedBefore = false;
    let timer = null;
    const queue = [];

    const url = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${window.location.host}/gateway?token=${encodeURIComponent(token)}`;
    };

    const flush = () => {
      while (queue.length && ws && ws.readyState === WebSocket.OPEN) {
        const frame = queue.shift();
        try {
          ws.send(JSON.stringify(frame));
        } catch {
          queue.unshift(frame);
          break;
        }
      }
    };

    const scheduleReconnect = () => {
      if (intentional) return;
      setStatus('reconnecting');
      const delay = Math.min(15000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
      attempt += 1;
      timer = setTimeout(() => {
        timer = null;
        connect();
      }, delay);
    };

    const connect = () => {
      setStatus(attempt === 0 ? 'connecting' : 'reconnecting');
      try {
        ws = new WebSocket(url());
      } catch {
        scheduleReconnect();
        return;
      }

      ws.onopen = () => {
        attempt = 0;
        setStatus('open');
        if (openedBefore) setReconnects((n) => n + 1);
        openedBefore = true;
        flush();
      };

      ws.onmessage = (event) => {
        let frame;
        try {
          frame = JSON.parse(event.data);
        } catch {
          return;
        }
        const handler = (handlersRef.current || {})[frame.type];
        if (typeof handler === 'function') handler(frame);
      };

      ws.onerror = () => {
        try {
          ws && ws.close();
        } catch {
          /* ignore */
        }
      };

      ws.onclose = () => {
        ws = null;
        if (intentional) {
          setStatus('closed');
          return;
        }
        scheduleReconnect();
      };
    };

    sendRef.current = (obj) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify(obj));
          return true;
        } catch {
          /* fall through to queue */
        }
      }
      queue.push(obj);
      return false;
    };

    // The browser says the network is back: retry now rather than waiting out
    // the backoff timer (which can be up to 15s by then).
    const onOnline = () => {
      if (ws || intentional || !timer) return; // connected, connecting, or shut down
      clearTimeout(timer);
      timer = null;
      connect();
    };
    window.addEventListener('online', onOnline);

    connect();

    return () => {
      intentional = true;
      window.removeEventListener('online', onOnline);
      if (timer) clearTimeout(timer);
      sendRef.current = () => false;
      if (ws) {
        try {
          ws.close(1000, 'client navigating');
        } catch {
          /* ignore */
        }
      }
    };
  }, [token]);

  const send = useCallback((obj) => sendRef.current(obj), []);
  return { status, send, reconnects };
}
