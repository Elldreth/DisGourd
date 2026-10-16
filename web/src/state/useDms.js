import { useEffect, useReducer, useRef, useState } from 'react';
import * as api from '../api.js';
import { messagesReducer, pruneExpired } from './useChannelMessages.js';
import { useHistoryPaging } from './useHistoryPaging.js';

// Normalize a live `dm` frame to the shared message shape (author/authorAvatar).
function dmFrameToMessage(m) {
  return {
    id: m.id,
    author: m.from,
    authorAvatar: m.fromAvatar,
    content: m.content,
    attachment: m.attachment,
    attachments: m.attachments,
    spoiler: m.spoiler,
    timestamp: m.timestamp,
  };
}

// Direct messages: the conversation list, the open conversation's messages,
// per-conversation unread counts, typing, the gateway handlers that keep them
// live, and the actions that send.
//   active: the DM view is showing (not a server)
//   send:   gateway send; status: the gateway status
//   onIncoming(frame): told about every incoming DM (notifications, sounds)
export function useDms({ active, user, send, status, onIncoming }) {
  const [conversations, setConversations] = useState([]);
  const [current, setCurrent] = useState(''); // partner username
  const [messages, dispatch] = useReducer(messagesReducer, []);
  const [unread, setUnread] = useState({}); // username -> count
  const [typing, setTyping] = useState({}); // username -> expires-at ms
  const paging = useHistoryPaging(`dm:${current}`);

  // Handlers run outside render, so they read the latest state from refs.
  const activeRef = useRef(active);
  activeRef.current = active;
  const currentRef = useRef(current);
  currentRef.current = current;
  const userRef = useRef(user);
  userRef.current = user;

  function loadConversations() {
    api.getDms().then(setConversations).catch(() => {});
  }

  const handlers = {
    dm: (m) => {
      onIncoming?.({ kind: 'dm', ...m });
      const me = userRef.current;
      const partner = m.from === me ? m.to : m.from;
      const viewing = activeRef.current && currentRef.current === partner;
      if (viewing) {
        dispatch({ type: 'merged', messages: [dmFrameToMessage(m)] });
        if (m.id) send({ op: 'dm_read', with: partner, lastId: m.id });
      } else if (m.from !== me) {
        setUnread((prev) => ({ ...prev, [partner]: (prev[partner] || 0) + 1 }));
      }
      if (activeRef.current) loadConversations(); // refresh previews/order
    },
    dm_update: (u) => dispatch({ type: 'updated', id: u.id, content: u.content, editedAt: u.editedAt }),
    dm_delete: (d) => dispatch({ type: 'deleted', id: d.id }),
    dm_typing: (t) => {
      if (activeRef.current && currentRef.current === t.from) {
        setTyping((prev) => ({ ...prev, [t.from]: Date.now() + 4000 }));
      }
    },
    dm_unread: (f) => {
      const map = {};
      for (const c of f.counts || []) map[c.with] = c.count;
      setUnread(map);
    },
  };

  // Focus + load the open conversation (also on reconnect).
  useEffect(() => {
    if (!active || !current) {
      dispatch({ type: 'reset', messages: [] });
      setTyping({});
      return undefined;
    }
    send({ op: 'focus' }); // clear any channel focus
    send({ op: 'dm_focus', with: current });
    let cancelled = false;
    api
      .getDmMessages(current)
      .then((msgs) => {
        if (cancelled) return;
        dispatch({ type: 'reset', messages: msgs });
        paging.pageLoaded(`dm:${current}`, msgs.length);
        const maxId = msgs.reduce((mx, m) => Math.max(mx, m.id || 0), 0);
        send({ op: 'dm_read', with: current, lastId: maxId });
        setUnread((prev) => {
          if (!prev[current]) return prev;
          const next = { ...prev };
          delete next[current];
          return next;
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, current, status, send]);

  // Expire typing indicators a few seconds after the last keystroke event.
  useEffect(() => {
    const iv = setInterval(() => setTyping(pruneExpired), 1000);
    return () => clearInterval(iv);
  }, []);

  // Open a conversation, adding it to the list if it's new.
  function open(username) {
    if (!username || username === user) return;
    setCurrent(username);
    setConversations((prev) => (prev.find((d) => d.username === username) ? prev : [{ username, unread: 0 }, ...prev]));
  }

  // Fetch the page just older than the oldest message shown.
  function loadOlder() {
    const oldest = messages[0]?.id;
    if (!current || !oldest) return;
    const partner = current;
    paging.loadOlder(
      (limit) => api.getDmMessages(partner, { limit, before: oldest }),
      (rows) => dispatch({ type: 'merged', messages: rows })
    );
  }

  // Forget everything (on logout).
  function reset() {
    setConversations([]);
    setCurrent('');
    dispatch({ type: 'reset', messages: [] });
    setUnread({});
    setTyping({});
  }

  return {
    conversations,
    current,
    select: setCurrent,
    open,
    loadConversations,
    messages,
    unread,
    totalUnread: Object.values(unread).reduce((a, b) => a + b, 0),
    typingNames: Object.keys(typing),
    hasMore: paging.hasMore,
    loadingOlder: paging.loadingOlder,
    loadOlder,
    handlers,
    reset,
    send: (content, attachments, spoiler) => {
      if (current) send({ op: 'dm', to: current, content, attachments, spoiler });
    },
    edit: (id, content) => send({ op: 'dm_edit', id, content }),
    remove: (id) => send({ op: 'dm_delete', id }),
    sendTyping: () => {
      if (current) send({ op: 'dm_typing', with: current });
    },
  };
}
