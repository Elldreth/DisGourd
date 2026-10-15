import { useEffect, useReducer, useRef, useState } from 'react';
import * as api from '../api.js';
import { mergeMessages } from '../util.js';

// Key for per-channel maps (unread, mentions, voice state).
export const unreadKey = (space, channel) => JSON.stringify([space, channel]);

// ---- Pure message-list reducer (no React; unit-testable) ----
// Actions:
//   { type: 'reset', messages }                       replace the transcript
//   { type: 'merged', messages }                      add/replace by id, keep order
//   { type: 'updated', id, content, editedAt }        an edit
//   { type: 'deleted', id }
//   { type: 'reaction', id, emoji, count, users }     one emoji's new total
export function messagesReducer(state, action) {
  switch (action.type) {
    case 'reset':
      return action.messages || [];
    case 'merged':
      return mergeMessages(state, action.messages);
    case 'updated':
      return state.map((m) => (m.id === action.id ? { ...m, content: action.content, editedAt: action.editedAt } : m));
    case 'deleted':
      return state.filter((m) => m.id !== action.id);
    case 'reaction':
      return state.map((m) => {
        if (m.id !== action.id) return m;
        const others = (m.reactions || []).filter((x) => x.emoji !== action.emoji);
        const next = action.count > 0 ? [...others, { emoji: action.emoji, count: action.count, users: action.users }] : others;
        return { ...m, reactions: next };
      });
    default:
      return state;
  }
}

// Drop entries whose expiry time has passed (typing indicators).
export function pruneExpired(prev) {
  const now = Date.now();
  const next = {};
  let changed = false;
  for (const [u, exp] of Object.entries(prev)) {
    if (exp > now) next[u] = exp;
    else changed = true;
  }
  return changed ? next : prev;
}

// Unread + mention badges per channel (for the current server) and per server.
export function badgeCounts({ unread, mentions, spaces, currentSpace, channels }) {
  const channelUnread = {};
  const channelMentions = {};
  for (const c of channels) {
    const n = unread[unreadKey(currentSpace, c)];
    if (n) channelUnread[c] = n;
    const mn = mentions[unreadKey(currentSpace, c)];
    if (mn) channelMentions[c] = mn;
  }
  const spaceUnread = {};
  const spaceMentions = {};
  for (const s of spaces) {
    let total = 0;
    let mtotal = 0;
    for (const c of s.channels) {
      total += unread[unreadKey(s.name, c)] || 0;
      mtotal += mentions[unreadKey(s.name, c)] || 0;
    }
    if (total) spaceUnread[s.name] = total;
    if (mtotal) spaceMentions[s.name] = mtotal;
  }
  return { channelUnread, channelMentions, spaceUnread, spaceMentions };
}

// Remove one key from a map state, keeping the same object if it's absent.
const withoutKey = (k) => (prev) => {
  if (!prev[k]) return prev;
  const next = { ...prev };
  delete next[k];
  return next;
};

// Everything about the open text channel's messages: the transcript, typing,
// unread/mention counts for every channel, the gateway handlers that keep them
// live, and the actions that send to it.
//   active: the server view is showing (not DMs)
//   send:   a stable send (see useLateSend); status: the gateway status
export function useChannelMessages({ space, channel, active, user, send, status }) {
  const [messages, dispatch] = useReducer(messagesReducer, []);
  const [typingUsers, setTypingUsers] = useState({}); // username -> expires-at ms
  const [unread, setUnread] = useState({}); // unreadKey -> count
  const [mentions, setMentions] = useState({}); // unreadKey -> mention count

  // Handlers run outside render, so they read the latest selection from refs.
  const spaceRef = useRef(space);
  spaceRef.current = space;
  const channelRef = useRef(channel);
  channelRef.current = channel;
  const userRef = useRef(user);
  userRef.current = user;
  const isOpen = (s, c) => s === spaceRef.current && c === channelRef.current;

  const handlers = {
    message: (m) => {
      if (isOpen(m.space, m.channel)) {
        dispatch({ type: 'merged', messages: [m] });
        if (m.id) send({ op: 'read', space: m.space, channel: m.channel, lastId: m.id });
      } else {
        const k = unreadKey(m.space, m.channel);
        setUnread((prev) => ({ ...prev, [k]: (prev[k] || 0) + 1 }));
        if (m.mentions && m.mentions.includes(userRef.current)) {
          setMentions((prev) => ({ ...prev, [k]: (prev[k] || 0) + 1 }));
        }
      }
    },
    unread: (f) => {
      const map = {};
      for (const c of f.counts || []) map[unreadKey(c.space, c.channel)] = c.count;
      setUnread(map);
      const mmap = {};
      for (const c of f.mentions || []) mmap[unreadKey(c.space, c.channel)] = c.count;
      setMentions(mmap);
    },
    message_update: (u) => {
      if (isOpen(u.space, u.channel)) dispatch({ type: 'updated', id: u.id, content: u.content, editedAt: u.editedAt });
    },
    message_delete: (d) => {
      if (isOpen(d.space, d.channel)) dispatch({ type: 'deleted', id: d.id });
    },
    reaction: (r) => {
      if (isOpen(r.space, r.channel)) dispatch({ type: 'reaction', id: r.id, emoji: r.emoji, count: r.count, users: r.users });
    },
    typing: (t) => {
      if (isOpen(t.space, t.channel)) setTypingUsers((prev) => ({ ...prev, [t.user]: Date.now() + 4000 }));
    },
  };

  // Clear the transcript immediately when switching channels.
  useEffect(() => {
    dispatch({ type: 'reset', messages: [] });
    setTypingUsers({});
  }, [space, channel]);

  // Focus the active channel and (re)load its history — also on reconnect.
  useEffect(() => {
    if (!active || !space || !channel) return undefined;
    send({ op: 'focus', space, channel });
    let cancelled = false;
    api
      .getMessages(space, channel)
      .then((msgs) => {
        if (cancelled) return;
        dispatch({ type: 'reset', messages: msgs });
        // This channel is now read up to its latest message.
        const maxId = msgs.reduce((mx, m) => Math.max(mx, m.id || 0), 0);
        send({ op: 'read', space, channel, lastId: maxId });
        const k = unreadKey(space, channel);
        setUnread(withoutKey(k));
        setMentions(withoutKey(k));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [active, space, channel, status, send]);

  // Expire typing indicators a few seconds after the last keystroke event.
  useEffect(() => {
    const iv = setInterval(() => setTypingUsers(pruneExpired), 1000);
    return () => clearInterval(iv);
  }, []);

  // Forget everything (on logout).
  function reset() {
    dispatch({ type: 'reset', messages: [] });
    setTypingUsers({});
    setUnread({});
    setMentions({});
  }

  return {
    messages,
    typingNames: Object.keys(typingUsers).filter((u) => u !== user),
    unread,
    mentions,
    handlers,
    reset,
    sendMessage: (content, attachments, spoiler, replyTo) =>
      send({ op: 'message', space, channel, content, attachments, spoiler, replyTo }),
    editMessage: (id, content) => send({ op: 'edit', id, content }),
    deleteMessage: (id) => send({ op: 'delete', id }),
    react: (id, emoji) => send({ op: 'react', id, emoji }),
    sendTyping: () => send({ op: 'typing', space, channel }),
  };
}
