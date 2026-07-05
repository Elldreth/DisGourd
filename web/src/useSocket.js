import { useEffect, useRef, useState, useCallback } from 'react';

// A resilient channel WebSocket.
//
//  - Auto-reconnects with exponential backoff + jitter after any unclean close
//    (crash, dropped wifi, server restart) until it gets back in.
//  - Tracks the last message id it has seen and reconnects with ?after=<id> so
//    the server backfills exactly what was missed — no gaps, no duplicates.
//  - Queues outgoing messages while offline and flushes them on reconnect, so a
//    message typed during a blip is never silently lost.
//
// Returns { status, send } where status is one of:
//   'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'
export function useChannelSocket({ space, channel, token, handlers }) {
  const [status, setStatus] = useState('idle');
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers; // always call the latest handlers
  const sendRef = useRef(() => false);

  useEffect(() => {
    if (!space || !channel || !token) {
      setStatus('idle');
      return undefined;
    }

    let ws = null;
    let intentional = false;
    let attempt = 0;
    let timer = null;
    let lastId = 0; // highest message id seen this channel session
    const queue = [];

    const buildUrl = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const params = new URLSearchParams({ token });
      // Fresh open loads recent history; a reconnect backfills only what we missed.
      if (lastId > 0) params.set('after', String(lastId));
      else params.set('history', '50');
      const s = encodeURIComponent(space);
      const c = encodeURIComponent(channel);
      return `${proto}//${window.location.host}/ws/${s}/${c}?${params}`;
    };

    const noteId = (id) => {
      if (typeof id === 'number' && id > lastId) lastId = id;
    };

    const flush = () => {
      while (queue.length && ws && ws.readyState === WebSocket.OPEN) {
        const msg = queue.shift();
        try {
          ws.send(JSON.stringify(msg));
        } catch {
          queue.unshift(msg);
          break;
        }
      }
    };

    const scheduleReconnect = () => {
      if (intentional) return;
      setStatus('reconnecting');
      const delay = Math.min(15000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
      attempt += 1;
      timer = setTimeout(connect, delay);
    };

    const connect = () => {
      setStatus(attempt === 0 ? 'connecting' : 'reconnecting');
      try {
        ws = new WebSocket(buildUrl());
      } catch {
        scheduleReconnect();
        return;
      }

      ws.onopen = () => {
        attempt = 0;
        setStatus('open');
        flush();
      };

      ws.onmessage = (event) => {
        let frame;
        try {
          frame = JSON.parse(event.data);
        } catch {
          return;
        }
        const h = handlersRef.current || {};
        switch (frame.type) {
          case 'message':
            noteId(frame.id);
            h.onMessage && h.onMessage(frame);
            break;
          case 'history':
            (frame.messages || []).forEach((m) => noteId(m.id));
            h.onHistory && h.onHistory(frame.messages || []);
            break;
          case 'message_update':
            h.onMessageUpdate && h.onMessageUpdate(frame);
            break;
          case 'message_delete':
            h.onMessageDelete && h.onMessageDelete(frame);
            break;
          case 'reaction':
            h.onReaction && h.onReaction(frame);
            break;
          case 'typing':
            h.onTyping && h.onTyping(frame);
            break;
          case 'presence':
            h.onPresence && h.onPresence(frame);
            break;
          case 'friend_list':
            h.onFriendList && h.onFriendList(frame.friends || []);
            break;
          case 'system':
            h.onSystem && h.onSystem(frame);
            break;
          default:
            break;
        }
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

    connect();

    return () => {
      intentional = true;
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
  }, [space, channel, token]);

  const send = useCallback((obj) => sendRef.current(obj), []);
  return { status, send };
}
