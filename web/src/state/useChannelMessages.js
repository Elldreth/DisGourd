import { useEffect, useReducer, useRef, useState } from 'react';
import * as api from '../api.js';
import { mergeMessages } from '../util.js';
import { useHistoryPaging, PAGE_SIZE } from './useHistoryPaging.js';
import { mergeLastRead } from '../newMessages.js';

// Key for per-channel maps (unread, mentions, voice state).
export const unreadKey = (space, channel) => JSON.stringify([space, channel]);

// ---- Pure message-list reducer (no React; unit-testable) ----
// Actions:
//   { type: 'reset', messages }                       replace the transcript
//   { type: 'merged', messages }                      add/replace by id, keep order
//   { type: 'updated', id, content, editedAt }        an edit
//   { type: 'deleted', id }
//   { type: 'reaction', id, emoji, count, users }     one emoji's new total
//   { type: 'embeds', id, embeds }                    a message's link-preview cards
//   { type: 'resynced', messages, full }              the newest page, refetched
//       after a reconnect: it replaces what we had in its range (picking up
//       edits, reactions and deletions) and keeps older loaded pages as they
//       were. `full` = a whole page came back, so there's older history; a
//       short page is the entire conversation.
export function messagesReducer(state, action) {
  switch (action.type) {
    case 'reset':
      return action.messages || [];
    case 'resynced': {
      const rows = action.messages || [];
      if (!action.full || !rows.length) return rows;
      const from = rows.reduce((mn, m) => Math.min(mn, m.id), Infinity);
      return mergeMessages(state.filter((m) => m.id < from), rows);
    }
    case 'merged':
      return mergeMessages(state, action.messages);
    case 'updated':
      return state.map((m) => (m.id === action.id ? { ...m, content: action.content, editedAt: action.editedAt } : m));
    case 'deleted':
      return state.filter((m) => m.id !== action.id);
    case 'embeds':
      return state.some((m) => m.id === action.id)
        ? state.map((m) => (m.id === action.id ? { ...m, embeds: action.embeds || [] } : m))
        : state;
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

// After a reconnect: did more than a page arrive while we were away? Then the
// refetched newest page doesn't reach back to what we had, and merging would
// leave a hole, so reload from scratch instead.
export function hasGap(state, rows, pageSize) {
  if (!state.length || rows.length < pageSize) return false;
  const newestHad = state.reduce((mx, m) => Math.max(mx, m.id), 0);
  const oldestNew = rows.reduce((mn, m) => Math.min(mn, m.id), Infinity);
  return oldestNew > newestHad;
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
//   onIncoming(frame): told about every incoming message (notifications, sounds)
export function useChannelMessages({ space, channel, active, user, send, status, onIncoming }) {
  const [messages, dispatch] = useReducer(messagesReducer, []);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const [typingUsers, setTypingUsers] = useState({}); // username -> expires-at ms
  const [unread, setUnread] = useState({}); // unreadKey -> count
  const [mentions, setMentions] = useState({}); // unreadKey -> mention count
  const paging = useHistoryPaging(unreadKey(space, channel));
  // Where you stopped reading each channel (unreadKey -> last read message id),
  // and, for the open channel, what was new when you opened it:
  // { since, count } or null. That drives the "New" divider.
  const lastRead = useRef({});
  const [newMessages, setNewMessages] = useState(null);
  const capturedFor = useRef(null); // the channel key newMessages was taken for
  const unreadRef = useRef(unread);
  unreadRef.current = unread;
  const noteRead = (k, id) => {
    lastRead.current = mergeLastRead(lastRead.current, { [k]: id });
  };

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
      onIncoming?.({ kind: 'message', ...m });
      if (isOpen(m.space, m.channel)) {
        dispatch({ type: 'merged', messages: [m] });
        if (m.id) {
          send({ op: 'read', space: m.space, channel: m.channel, lastId: m.id });
          noteRead(unreadKey(m.space, m.channel), m.id);
        }
      } else {
        const k = unreadKey(m.space, m.channel);
        // A channel missing from the connect-time unread frame had nothing
        // unread, so everything before this first new message was read.
        if (m.id && lastRead.current[k] == null) noteRead(k, m.id - 1);
        setUnread((prev) => ({ ...prev, [k]: (prev[k] || 0) + 1 }));
        if (m.mentions && m.mentions.includes(userRef.current)) {
          setMentions((prev) => ({ ...prev, [k]: (prev[k] || 0) + 1 }));
        }
      }
    },
    unread: (f) => {
      const map = {};
      const reads = {};
      for (const c of f.counts || []) {
        map[unreadKey(c.space, c.channel)] = c.count;
        if (c.lastReadId != null) reads[unreadKey(c.space, c.channel)] = c.lastReadId;
      }
      setUnread(map);
      lastRead.current = mergeLastRead(lastRead.current, reads);
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
    message_embeds: (e) => {
      if (isOpen(e.space, e.channel)) dispatch({ type: 'embeds', id: e.id, embeds: e.embeds });
    },
    typing: (t) => {
      if (isOpen(t.space, t.channel)) setTypingUsers((prev) => ({ ...prev, [t.user]: Date.now() + 4000 }));
    },
  };

  // Clear the transcript immediately when switching channels.
  useEffect(() => {
    dispatch({ type: 'reset', messages: [] });
    setTypingUsers({});
    setNewMessages(null); // the divider is only for the visit that found it
    capturedFor.current = null;
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
        const k = unreadKey(space, channel);
        // Reloading the channel we're already showing (a reconnect, or coming
        // back from DMs): merge, so older pages you scrolled to stay loaded.
        // Otherwise (or if too much arrived meanwhile to merge) start fresh.
        const reload = capturedFor.current === k;
        if (reload && !hasGap(messagesRef.current, msgs, PAGE_SIZE)) {
          dispatch({ type: 'resynced', messages: msgs, full: msgs.length >= PAGE_SIZE });
          if (msgs.length < PAGE_SIZE) paging.pageLoaded(k, msgs.length);
        } else {
          dispatch({ type: 'reset', messages: msgs });
          paging.pageLoaded(k, msgs.length);
        }
        // Note what was new before marking it read. Only on the first load of
        // this visit: a reconnect reload keeps the divider where it was.
        if (capturedFor.current !== k) {
          capturedFor.current = k;
          const count = unreadRef.current[k] || 0;
          const since = lastRead.current[k];
          setNewMessages(count > 0 && since != null ? { since, count } : null);
        }
        // This channel is now read up to its latest message.
        const maxId = msgs.reduce((mx, m) => Math.max(mx, m.id || 0), 0);
        send({ op: 'read', space, channel, lastId: maxId });
        noteRead(k, maxId);
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
    setNewMessages(null);
    lastRead.current = {};
    capturedFor.current = null;
  }

  // Fetch the page just older than the oldest message shown. Resolves once
  // that page is in (or straight away when there's nothing to load).
  function loadOlder() {
    const oldest = messages[0]?.id;
    if (!oldest) return Promise.resolve();
    return paging.loadOlder(
      (limit) => api.getMessages(space, channel, { limit, before: oldest }),
      (rows) => dispatch({ type: 'merged', messages: rows })
    );
  }

  return {
    messages,
    hasMore: paging.hasMore,
    loadingOlder: paging.loadingOlder,
    loadOlder,
    newMessages,
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
