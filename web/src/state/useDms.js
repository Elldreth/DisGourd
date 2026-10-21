import { dmSince } from '../newMessages.js';
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
    ...(m.kind ? { kind: m.kind } : {}), // 'system': a group notice (P9-06d)
  };
}

// What a conversation is called (P9-06d): a group's name, else the other
// members' names ("bob, cara and dee"); a pair, the other person.
export function conversationTitle(c, me) {
  if (!c) return '';
  if (c.kind !== 'group') return c.username || '';
  if (c.name) return c.name;
  const names = (c.members || []).map((m) => m.username).filter((n) => n !== me);
  if (!names.length) return 'Just you';
  return names.length < 2 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
export const MAX_GROUP = 10;

// P9-06b: conversations are keyed `c:<id>`; one you're starting with someone
// you've never messaged is `@<username>` until its first message makes it.
export const convKey = (c) => (c.id != null ? `c:${c.id}` : `@${c.username}`);
export const frameKey = (f) => (f.conversation != null ? `c:${f.conversation}` : null);
// What the gateway ops take for a key: { conversation } or the other person's name.
function target(key, nameField = 'with') {
  return key.startsWith('c:') ? { conversation: Number(key.slice(2)) } : { [nameField]: key.slice(1) };
}
// A saved or requested place: a key, or (saved before P9-06b) a bare username.
const isKey = (k) => typeof k === 'string' && (k.startsWith('c:') || k.startsWith('@'));

// Direct messages: the conversation list, the open conversation's messages,
// per-conversation unread counts, typing, the gateway handlers that keep them
// live, and the actions that send.
//   active: the DM view is showing (not a server)
//   send:   gateway send; status: the gateway status
//   onIncoming(frame): told about every incoming DM (notifications, sounds)
// `onLeft({ conversation, reason, name })` (P9-06d): you left or were removed from a group.
// `onAdded(conversation)` (P10-08): someone else put you in a group.
export function useDms({ active, user, send, status, reconnects = 0, onIncoming, onLeft, onAdded }) {
  const [conversations, setConversations] = useState([]);
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const [current, setCurrent] = useState(''); // the open conversation's key ('' for none)
  const [messages, dispatch] = useReducer(messagesReducer, []);
  const [unread, setUnread] = useState({}); // key -> count
  const unreadNow = useRef(unread);
  unreadNow.current = unread;
  const [typing, setTyping] = useState({}); // username -> expires-at ms
  // The last refusal of a group action (P9-06d): { op, code, error } or null.
  const [groupError, setGroupError] = useState(null);
  const paging = useHistoryPaging(`dm:${current}`);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const loadedFor = useRef(null); // the conversation whose messages are showing
  // What was new when you opened the conversation ({ since, count } or null):
  // drives the "New" divider, once per visit (P3-20b).
  const [newMessages, setNewMessages] = useState(null);
  const capturedFor = useRef(null);

  // Handlers run outside render, so they read the latest state from refs.
  const activeRef = useRef(active);
  activeRef.current = active;
  const currentRef = useRef(current);
  currentRef.current = current;
  const userRef = useRef(user);
  userRef.current = user;

  // The server only lists conversations that have messages, so keep the one
  // you've just started (open() adds it as `@name`) until its first message
  // is sent; once the list has that pair, switch to its real key.
  function loadConversations() {
    api
      .getDms()
      .then((rows) => {
        const list = rows.map((d) => ({ ...d, key: convKey(d) }));
        const open = currentRef.current;
        const draft = open.startsWith('@') ? open.slice(1) : null;
        const made = draft && list.find((d) => d.kind === 'pair' && d.username === draft);
        if (made) setCurrent(made.key);
        setConversations((prev) => {
          const keep = draft && !made ? prev.filter((d) => d.key === open) : [];
          return [...keep, ...list];
        });
      })
      .catch(() => {});
  }

  const handlers = {
    dm: (m) => {
      if (m.kind !== 'system') onIncoming?.({ ...m, kind: 'dm' }); // a group's notices don't notify (P9-06d)
      const me = userRef.current;
      const partner = m.from === me ? m.to : m.from;
      const key = frameKey(m) || `@${partner}`;
      const open = currentRef.current;
      // The first message of a conversation you'd just started makes it real.
      const started = !!m.to && partner && open === `@${partner}` && key !== open; // pairs only: a group's frames have no `to`
      if (started) {
        currentRef.current = key;
        setCurrent(key);
      }
      const viewing = activeRef.current && (currentRef.current === key);
      if (viewing && !started) {
        // Reading older history: it's picked up by loadNewer / Jump to present.
        if (!paging.hasNewerRef.current) {
          dispatch({ type: 'merged', messages: [dmFrameToMessage(m)] });
          if (m.id) send({ op: 'dm_read', ...target(key), lastId: m.id });
        }
      } else if (!viewing && m.from !== me) {
        setUnread((prev) => ({ ...prev, [key]: (prev[key] || 0) + 1 }));
      }
      if (activeRef.current) loadConversations(); // refresh previews/order
    },
    dm_update: (u) => dispatch({ type: 'updated', id: u.id, content: u.content, editedAt: u.editedAt }),
    dm_delete: (d) => dispatch({ type: 'deleted', id: d.id }),
    dm_embeds: (e) => dispatch({ type: 'embeds', id: e.id, embeds: e.embeds }),
    dm_typing: (t) => {
      const open = currentRef.current;
      const here = frameKey(t) ? open === frameKey(t) : open === `@${t.from}`;
      if (activeRef.current && here) {
        setTyping((prev) => ({ ...prev, [t.from]: Date.now() + 4000 }));
      }
    },
    // P9-06d: a conversation's summary changed (or a group you were added to).
    dm_conversation: (f) => {
      const c = { ...f.conversation, key: `c:${f.conversation.id}` };
      // A group that's new to you, and not one you made: you were added.
      const owner = c.members?.find((m) => m.id === c.ownerId)?.username;
      if (c.kind === 'group' && owner !== userRef.current && !conversationsRef.current.some((d) => d.key === c.key)) onAdded?.(c);
      setConversations((prev) => (prev.some((d) => d.key === c.key) ? prev.map((d) => (d.key === c.key ? { ...d, ...c } : d)) : [c, ...prev]));
    },
    // The group you just made: open it.
    dm_group_created: (f) => {
      setGroupError(null);
      setCurrent(`c:${f.conversation}`);
    },
    // You left, or were removed: it goes from the list (and the view).
    dm_left: (f) => {
      const key = `c:${f.conversation}`;
      setConversations((prev) => prev.filter((d) => d.key !== key));
      setUnread((prev) => {
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      if (currentRef.current === key) setCurrent('');
      onLeft?.(f);
    },
    error: (f) => {
      if (typeof f.op === 'string' && (f.op.startsWith('dm_group_') || f.op === 'dm_mute')) setGroupError({ op: f.op, code: f.code, error: f.error });
    },
    dm_unread: (f) => {
      const map = {};
      for (const c of f.counts || []) map[frameKey(c) || `@${c.with}`] = c.count;
      setUnread(map);
    },
  };

  // Focus + load the open conversation (also on reconnect).
  useEffect(() => {
    if (!active || !current) {
      loadedFor.current = null;
      capturedFor.current = null;
      setNewMessages(null);
      dispatch({ type: 'reset', messages: [] });
      setTyping({});
      return undefined;
    }
    send({ op: 'focus' }); // clear any channel focus
    send({ op: 'dm_focus', ...target(current) });
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
        // Note what was new before marking it read (first load of this visit only).
        if (capturedFor.current !== current) {
          capturedFor.current = current;
          const count = unreadNow.current[current] || 0;
          const since = dmSince(msgs, count, user);
          setNewMessages(count > 0 && since != null ? { since, count } : null);
        }
        const maxId = msgs.reduce((mx, m) => Math.max(mx, m.id || 0), 0);
        if (maxId) send({ op: 'dm_read', ...target(current), lastId: maxId });
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

  // Open the conversation with someone, adding a placeholder if you've never
  // messaged them (it becomes real with the first message).
  function open(username) {
    if (!username || username === user) return;
    const pair = conversations.find((d) => d.kind !== 'group' && d.username === username);
    if (pair) return setCurrent(pair.key);
    const key = `@${username}`;
    setCurrent(key);
    setConversations((prev) => (prev.find((d) => d.key === key) ? prev : [{ key, id: null, kind: 'pair', username, members: [], unread: 0 }, ...prev]));
  }
  // Open by key; `@name` (or a bare username saved before P9-06b) opens the pair.
  function select(key) {
    if (!key) return setCurrent('');
    if (isKey(key) && key.startsWith('c:')) return setCurrent(key);
    open(key.startsWith('@') ? key.slice(1) : key);
  }

  // Fetch the page just older than the oldest message shown.
  function loadOlder() {
    const oldest = messages[0]?.id;
    if (!current || !oldest) return;
    const partner = current;
    paging.loadOlder(
      (limit) => api.getDmMessages(partner, { limit, before: oldest }), // `partner`: the key
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
      if (maxId) send({ op: 'dm_read', ...target(current), lastId: maxId });
    },
  });
  // The open conversation (or the placeholder for one you're starting).
  const currentConversation = !current
    ? null
    : conversations.find((d) => d.key === current) || (current.startsWith('@') ? { key: current, id: null, kind: 'pair', username: current.slice(1), members: [] } : null);

  return {
    history,
    conversations,
    current,
    currentConversation,
    select,
    open,
    loadConversations,
    messages,
    newMessages,
    unread,
    totalUnread: Object.values(unread).reduce((a, b) => a + b, 0),
    typingNames: Object.keys(typing),
    hasMore: paging.hasMore,
    loadingOlder: paging.loadingOlder,
    loadOlder,
    handlers,
    reset,
    send: (content, attachments, spoiler, replyTo) => {
      if (current) send({ op: 'dm', ...target(current, 'to'), content, attachments, spoiler, replyTo });
    },
    // ---- Groups (P9-06d) ----
    groupError,
    clearGroupError: () => setGroupError(null),
    createGroup: (members, name = '') => {
      setGroupError(null);
      send({ op: 'dm_group_create', members, name });
    },
    addToGroup: (conversationId, members) => {
      setGroupError(null);
      send({ op: 'dm_group_add', conversation: conversationId, members });
    },
    removeFromGroup: (conversationId, member) => send({ op: 'dm_group_remove', conversation: conversationId, member }),
    leaveGroup: (conversationId) => send({ op: 'dm_group_leave', conversation: conversationId }),
    renameGroup: (conversationId, name) => {
      setGroupError(null);
      send({ op: 'dm_group_rename', conversation: conversationId, name });
    },
    setMuted: (conversationId, muted) => send({ op: 'dm_mute', conversation: conversationId, muted }),
    title: (c) => conversationTitle(c, user),
    edit: (id, content) => send({ op: 'dm_edit', id, content }),
    remove: (id) => send({ op: 'dm_delete', id }),
    sendTyping: () => {
      if (current) send({ op: 'dm_typing', ...target(current) });
    },
  };
}
