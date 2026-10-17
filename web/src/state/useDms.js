import { useEffect, useReducer, useRef, useState } from 'react';
import * as api from '../api.js';
import { messagesReducer, pruneExpired, hasGap } from './useChannelMessages.js';
import { useHistoryPaging, PAGE_SIZE } from './useHistoryPaging.js';
import { historyWindow } from './historyWindow.js';

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
    replyTo: m.replyTo ?? null,
    timestamp: m.timestamp,
  };
}

// Direct messages: the conversation list, the open conversation's messages,
// per-conversation unread counts, typing, the gateway handlers that keep them
// live, and the actions that send.
//   active: the DM view is showing (not a server)
//   send:   gateway send; status: the gateway status
//   onIncoming(frame): told about every incoming DM (notifications, sounds)
export function useDms({ active, user, send, status, reconnects = 0, onIncoming }) {
  const [conversations, setConversations] = useState([]);
  const [current, setCurrent] = useState(''); // partner username
  const [messages, dispatch] = useReducer(messagesReducer, []);
  const [unread, setUnread] = useState({}); // username -> count
  const [typing, setTyping] = useState({}); // username -> expires-at ms
  const paging = useHistoryPaging(`dm:${current}`);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const loadedFor = useRef(null); // the partner whose messages are showing

  // Handlers run outside render, so they read the latest state from refs.
  const activeRef = useRef(active);
  activeRef.current = active;
  const currentRef = useRef(current);
  currentRef.current = current;
  const userRef = useRef(user);
  userRef.current = user;

  // The server only lists conversations that have messages, so keep the one
  // you've just started (open() adds it) until its first message is sent.
  function loadConversations() {
    api
      .getDms()
      .then((list) =>
        setConversations((prev) => {
          const open = currentRef.current;
          const keep = open && !list.some((d) => d.username === open) ? prev.filter((d) => d.username === open) : [];
          return [...keep, ...list];
        })
      )
      .catch(() => {});
  }

  const handlers = {
    dm: (m) => {
      onIncoming?.({ kind: 'dm', ...m });
      const me = userRef.current;
      const partner = m.from === me ? m.to : m.from;
      const viewing = activeRef.current && currentRef.current === partner;
      if (viewing) {
        // Reading older history: it's picked up by loadNewer / Jump to present.
        if (!paging.hasNewerRef.current) {
          dispatch({ type: 'merged', messages: [dmFrameToMessage(m)] });
          if (m.id) send({ op: 'dm_read', with: partner, lastId: m.id });
        }
      } else if (m.from !== me) {
        setUnread((prev) => ({ ...prev, [partner]: (prev[partner] || 0) + 1 }));
      }
      if (activeRef.current) loadConversations(); // refresh previews/order
    },
    dm_update: (u) => dispatch({ type: 'updated', id: u.id, content: u.content, editedAt: u.editedAt }),
    dm_delete: (d) => dispatch({ type: 'deleted', id: d.id }),
    dm_embeds: (e) => dispatch({ type: 'embeds', id: e.id, embeds: e.embeds }),
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
      loadedFor.current = null;
      dispatch({ type: 'reset', messages: [] });
      setTyping({});
      return undefined;
    }
    send({ op: 'focus' }); // clear any channel focus
    send({ op: 'dm_focus', with: current });
    // Reading older history (a jump): keep that window; Jump to present reloads.
    if (paging.hasNewerRef.current) return undefined;
    let cancelled = false;
    api
      .getDmMessages(current)
      .then((msgs) => {
        if (cancelled) return;
        // Same merge-or-reload rule as channels (see useChannelMessages).
        if (loadedFor.current === current && !hasGap(messagesRef.current, msgs, PAGE_SIZE)) {
          dispatch({ type: 'resynced', messages: msgs, full: msgs.length >= PAGE_SIZE });
          if (msgs.length < PAGE_SIZE) paging.pageLoaded(`dm:${current}`, msgs.length);
        } else {
          dispatch({ type: 'reset', messages: msgs });
          paging.pageLoaded(`dm:${current}`, msgs.length);
        }
        loadedFor.current = current;
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

  // Load the conversation list whenever the DM view opens, whichever way you
  // got there: the rail button, a notification, a restored view on reload,
  // or starting a DM from the member list.
  useEffect(() => {
    if (active) loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // After a reconnect, refresh the conversation list (new DMs, previews) if
  // it's showing or was loaded.
  const listLoaded = conversations.length > 0;
  useEffect(() => {
    if (reconnects && (active || listLoaded)) loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reconnects]);

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

  const key = `dm:${current}`;
  const history = historyWindow({
    key,
    isCurrent: () => `dm:${currentRef.current}` === key,
    fetchPage: (opts) => api.getDmMessages(current, opts),
    messages,
    dispatch,
    paging,
    onPresent: (rows) => {
      const maxId = rows.reduce((mx, m) => Math.max(mx, m.id || 0), 0);
      send({ op: 'dm_read', with: current, lastId: maxId });
    },
  });

  return {
    history,
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
    send: (content, attachments, spoiler, replyTo) => {
      if (current) send({ op: 'dm', to: current, content, attachments, spoiler, replyTo });
    },
    edit: (id, content) => send({ op: 'dm_edit', id, content }),
    remove: (id) => send({ op: 'dm_delete', id }),
    sendTyping: () => {
      if (current) send({ op: 'dm_typing', with: current });
    },
  };
}
