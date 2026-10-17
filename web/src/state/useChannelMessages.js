import { useEffect, useReducer, useRef, useState } from 'react';
import * as api from '../api.js';
import { mergeMessages } from '../util.js';
import { useHistoryPaging, PAGE_SIZE } from './useHistoryPaging.js';
import { historyWindow } from './historyWindow.js';
import { mergeLastRead } from '../newMessages.js';

// Key for per-channel maps (unread, mentions, voice state).
export const unreadKey = (space, channel) => JSON.stringify([space, channel]);

// A thread is a hidden channel named ~t<root message id> (P2-22).
export const isThreadChannel = (channel) => typeof channel === 'string' && channel.startsWith('~t');
export const threadRootId = (channel) => (isThreadChannel(channel) ? parseInt(channel.slice(2), 10) : null);

// ---- Pure message-list reducer (no React; unit-testable) ----
// Actions:
//   { type: 'reset', messages }                       replace the transcript
//   { type: 'merged', messages }                      add/replace by id, keep order
//   { type: 'updated', id, content, editedAt }        an edit
//   { type: 'deleted', id }
//   { type: 'reaction', id, emoji, count, users }     one emoji's new total
//   { type: 'embeds', id, embeds }                    a message's link-preview cards
//   { type: 'pinned', id, pinned }                    pinned or unpinned
//   { type: 'thread', id, thread }                    a root message's thread summary
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
    case 'pinned':
      return state.map((m) => (m.id === action.id ? { ...m, pinned: !!action.pinned } : m));
    case 'thread':
      return state.map((m) => (m.id === action.id ? { ...m, thread: action.thread || null } : m));
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
// `threads` (unreadKey -> { parent, followed }) are the threads we know of:
// their counts roll up into the parent channel and the server, and
// `channelThreads` says how many threads in each channel have something unread.
export function badgeCounts({ unread, mentions, spaces, currentSpace, channels, threads = {} }) {
  const add = (map, key, n) => {
    if (n) map[key] = (map[key] || 0) + n;
  };
  const channelUnread = {};
  const channelMentions = {};
  const channelThreads = {};
  for (const c of channels) {
    add(channelUnread, c, unread[unreadKey(currentSpace, c)]);
    add(channelMentions, c, mentions[unreadKey(currentSpace, c)]);
  }
  const spaceUnread = {};
  const spaceMentions = {};
  for (const s of spaces) {
    for (const c of s.channels) {
      add(spaceUnread, s.name, unread[unreadKey(s.name, c)]);
      add(spaceMentions, s.name, mentions[unreadKey(s.name, c)]);
    }
  }
  for (const [k, info] of Object.entries(threads)) {
    const n = unread[k] || 0;
    const mn = mentions[k] || 0;
    if (!n && !mn) continue;
    const [space] = JSON.parse(k);
    add(spaceUnread, space, n);
    add(spaceMentions, space, mn);
    if (space === currentSpace && info.parent) {
      add(channelUnread, info.parent, n);
      add(channelMentions, info.parent, mn);
      add(channelThreads, info.parent, 1);
    }
  }
  return { channelUnread, channelMentions, spaceUnread, spaceMentions, channelThreads };
}

// The part of a thread shown under its root message.
const summaryOf = (t) => ({ id: t.id, channel: t.channel, name: t.name, messageCount: t.messageCount, lastActivityAt: t.lastActivityAt });

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
//   threadOnly: this instance shows an open thread (channel = '~tN'). It only
//     handles frames for that thread: no unread or mention counts, no
//     notifications, and it doesn't take the gateway focus from the channel.
//   openThread: the channel instance is told which thread ('~tN') is open in
//     the panel, so replies there don't count as unread.
export function useChannelMessages({ space, channel, active, user, send, status, onIncoming, threadOnly = false, openThread = '' }) {
  const [messages, dispatch] = useReducer(messagesReducer, []);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const [typingUsers, setTypingUsers] = useState({}); // username -> expires-at ms
  const [pinsVersion, setPinsVersion] = useState(0); // bumps when this channel's pins change
  const [threadsVersion, setThreadsVersion] = useState(0); // bumps when this channel's threads change
  const [unread, setUnread] = useState({}); // unreadKey -> count
  const [mentions, setMentions] = useState({}); // unreadKey -> mention count
  // Threads we know of: unreadKey -> { parent, name, followed }. Followed ones
  // count as unread and notify; a mention in any thread counts (P2-22c).
  const [threads, setThreads] = useState({});
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const noteThread = (k, info) => {
    const next = { ...threadsRef.current, [k]: { followed: false, ...threadsRef.current[k], ...info } };
    threadsRef.current = next; // handlers may run again before the next render
    setThreads(next);
  };
  const openThreadRef = useRef(openThread);
  openThreadRef.current = openThread;
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

  // The thread summary under a root message changed (a thread started, or a
  // reply came in or went).
  const threadChanged = (space, channel, rootMessageId, thread) => {
    if (!isOpen(space, channel)) return;
    dispatch({ type: 'thread', id: rootMessageId, thread: thread && summaryOf(thread) });
    setThreadsVersion((v) => v + 1); // an open threads list reloads
  };

  // A reply in a thread (the channel instance): it counts and notifies only
  // if you follow the thread, except that an @mention always counts. The open
  // thread's own instance shows and reads it.
  const threadReply = (m) => {
    const k = unreadKey(m.space, m.channel);
    if (m.thread) noteThread(k, { parent: m.thread.parentChannel, name: m.thread.name });
    const followed = !!threadsRef.current[k]?.followed;
    const mentioned = !!(m.mentions && m.mentions.includes(userRef.current));
    if (!followed && !mentioned) return;
    onIncoming?.({ kind: 'message', ...m });
    if (m.space === spaceRef.current && m.channel === openThreadRef.current) return;
    if (m.id && lastRead.current[k] == null) noteRead(k, m.id - 1);
    if (followed) setUnread((prev) => ({ ...prev, [k]: (prev[k] || 0) + 1 }));
    if (mentioned) setMentions((prev) => ({ ...prev, [k]: (prev[k] || 0) + 1 }));
  };

  const handlers = {
    message: (m) => {
      if (threadOnly) {
        if (!isOpen(m.space, m.channel)) return;
      } else if (isThreadChannel(m.channel)) return threadReply(m);
      else onIncoming?.({ kind: 'message', ...m });
      if (isOpen(m.space, m.channel)) {
        // Reading older history: it's picked up by loadNewer / Jump to present.
        if (paging.hasNewerRef.current) return;
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
      if (threadOnly) return;
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
      // The threads you follow, plus any thread with a count (a mention in
      // one you don't follow); thread rows name their parent channel.
      const tmap = {};
      for (const t of f.threads || []) tmap[unreadKey(t.space, t.channel)] = { parent: t.parent, name: t.name, followed: true };
      for (const c of [...(f.counts || []), ...(f.mentions || [])]) {
        if (!c.parent) continue;
        const k = unreadKey(c.space, c.channel);
        tmap[k] = { followed: false, parent: c.parent, ...tmap[k] };
      }
      threadsRef.current = tmap;
      setThreads(tmap);
    },
    // You started following a thread (or stopped). Unfollowed threads never badge.
    thread_follow: (f) => {
      if (threadOnly) return;
      const k = unreadKey(f.space, f.channel);
      noteThread(k, { parent: f.parentChannel, name: f.name, followed: !!f.followed });
      if (!f.followed) setUnread(withoutKey(k));
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
    message_pinned: (p) => {
      if (!isOpen(p.space, p.channel)) return;
      dispatch({ type: 'pinned', id: p.id, pinned: p.pinned });
      setPinsVersion((v) => v + 1); // an open pins panel reloads
    },
    message_embeds: (e) => {
      if (isOpen(e.space, e.channel)) dispatch({ type: 'embeds', id: e.id, embeds: e.embeds });
    },
    typing: (t) => {
      if (isOpen(t.space, t.channel)) setTypingUsers((prev) => ({ ...prev, [t.user]: Date.now() + 4000 }));
    },
    thread_created: (f) => threadChanged(f.space, f.channel, f.thread?.rootMessageId, f.thread),
    thread_updated: (f) => threadChanged(f.space, f.channel, f.rootMessageId, f.thread),
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
    // The channel keeps the gateway focus (typing indicators) while a thread is open.
    if (!threadOnly) send({ op: 'focus', space, channel });
    // Reading older history (a jump): keep that window; Jump to present reloads.
    if (paging.hasNewerRef.current) return undefined;
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
    setThreads({});
    threadsRef.current = {};
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

  const key = unreadKey(space, channel);
  const history = historyWindow({
    key,
    isCurrent: () => unreadKey(spaceRef.current, channelRef.current) === key,
    fetchPage: (opts) => api.getMessages(space, channel, opts),
    messages,
    dispatch,
    paging,
    onPresent: (rows) => {
      const maxId = rows.reduce((mx, m) => Math.max(mx, m.id || 0), 0);
      send({ op: 'read', space, channel, lastId: maxId });
      noteRead(key, maxId);
      setUnread(withoutKey(key));
      setMentions(withoutKey(key));
    },
  });

  return {
    messages,
    hasMore: paging.hasMore,
    loadingOlder: paging.loadingOlder,
    loadOlder,
    history,
    newMessages,
    typingNames: Object.keys(typingUsers).filter((u) => u !== user),
    unread,
    mentions,
    threads,
    // Opening a thread in the panel: its badge goes (its own instance tells the server).
    clearUnread: (s, c) => {
      const k = unreadKey(s, c);
      setUnread(withoutKey(k));
      setMentions(withoutKey(k));
    },
    handlers,
    reset,
    pinsVersion,
    threadsVersion,
    setPinned: (id, pinned) => send({ op: pinned ? 'pin' : 'unpin', id }),
    sendMessage: (content, attachments, spoiler, replyTo) =>
      send({ op: 'message', space, channel, content, attachments, spoiler, replyTo }),
    editMessage: (id, content) => send({ op: 'edit', id, content }),
    deleteMessage: (id) => send({ op: 'delete', id }),
    react: (id, emoji) => send({ op: 'react', id, emoji }),
    sendTyping: () => send({ op: 'typing', space, channel }),
  };
}
