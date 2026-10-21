// Desktop notifications and message sounds: who gets alerted about what.
// The rules are pure functions (unit-tested); useNotifications wires them to
// incoming gateway frames, the settings in audio.js, and the browser API.
import { useEffect, useRef } from 'react';
import { getNotifyLevel, getMessageSounds } from './audio.js';
import { playMessage, playMention } from './sounds.js';

// A frame is { kind: 'message', author, space, channel, mentions, thread? }
// (thread: { name, parentChannel } for a reply in a thread) or
// { kind: 'dm', from, to }. ctx is where you are and what you've chosen:
// { me, focused, view: 'server'|'dm', space, channel, thread, dm, level, sounds }
// (thread: the '~tN' channel open in the thread panel, if any).

// A DM frame's conversation key (P9-06b), or `@<sender>` without one.
export const dmKeyOf = (frame) => (frame.conversation != null ? `c:${frame.conversation}` : `@${frame.from}`);

// What an incoming message is to you: 'mention' | 'dm' | 'message', or null
// when it's yours or you're looking right at it (window focused, that
// channel or DM open).
export function attentionKind(frame, ctx) {
  // P9-07b: no notifications or sounds from someone I've blocked.
  if (ctx.blocked?.(frame.kind === 'dm' ? frame.from : frame.author)) return null;
  if (frame.kind === 'dm') {
    if (frame.from === ctx.me) return null;
    if (ctx.dmMuted?.(dmKeyOf(frame))) return null; // P9-06d: a muted conversation
    // P9-06b: ctx.dm is the open conversation's key (`c:<id>`, or `@name`).
    if (ctx.focused && ctx.view === 'dm' && ctx.dm === dmKeyOf(frame)) return null;
    return 'dm';
  }
  if (frame.author === ctx.me) return null;
  const looking = ctx.channel === frame.channel || (!!ctx.thread && ctx.thread === frame.channel);
  if (ctx.focused && ctx.view === 'server' && ctx.space === frame.space && looking) return null;
  return (frame.mentions || []).includes(ctx.me) ? 'mention' : 'message';
}

// Whether to show a desktop notification, by level: 'off' | 'mentions'
// (mentions and DMs) | 'all'. Returns the kind, or null.
export function shouldNotify(frame, ctx) {
  if (ctx.dnd) return null; // Do Not Disturb: badges still count, nothing pops up
  const kind = attentionKind(frame, ctx);
  if (!kind || ctx.level === 'off' || !ctx.level) return null;
  if (kind === 'message' && ctx.level !== 'all') return null;
  return kind;
}

// Which sound to play, if any: 'mention' (mentions and DMs) or 'message'
// (other messages, only at the "all messages" level). Independent of whether
// desktop notifications are on.
export function soundFor(frame, ctx) {
  if (!ctx.sounds || ctx.dnd) return null;
  const kind = attentionKind(frame, ctx);
  if (kind === 'mention' || kind === 'dm') return 'mention';
  if (kind === 'message' && ctx.level === 'all') return 'message';
  return null;
}

// Plain-text preview for a notification body: markdown markers removed,
// spoilers hidden, code blocks summarised, at most 120 characters.
export function notificationText(content, attachments = []) {
  let text = String(content || '')
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/\|\|[\s\S]+?\|\|/g, 'Spoiler')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/(^|[^\w])[*_](\S(?:[^*_]*?\S)?)[*_](?=[^\w]|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
  const n = attachments.length;
  if (n) text = text ? `${text} (${n === 1 ? 'attachment' : `${n} attachments`})` : n === 1 ? 'Sent an attachment' : `Sent ${n} attachments`;
  return text.length > 120 ? `${text.slice(0, 119)}…` : text;
}

// Where a channel message is, for the title: "#general · Server", or for a
// reply in a thread "Thread name (#general) · Server".
export function notificationPlace(frame) {
  const where = frame.thread ? `${frame.thread.name} (#${frame.thread.parentChannel})` : `#${frame.channel}`;
  return `${where} · ${frame.space}`;
}

const canNotify = () => typeof Notification !== 'undefined' && Notification.permission === 'granted';

// Hook: returns onIncoming(frame) for the channel and DM hooks to call with
// every incoming message. App keeps `update(...)` current with where you are
// and how to open a conversation when a notification is clicked:
//   update({ me, view, space, channel, thread, dm, dnd, openChannel(space, channel), openDm(name), openThread(space, thread) })
// (dnd: your status is Do Not Disturb, so no notifications or sounds)
export function useNotifications() {
  const where = useRef({});
  const update = (next) => {
    where.current = next;
  };

  // Close stale notifications when you come back to the window.
  const open = useRef(new Set());
  useEffect(() => {
    const clear = () => {
      for (const n of open.current) n.close();
      open.current.clear();
    };
    window.addEventListener('focus', clear);
    return () => window.removeEventListener('focus', clear);
  }, []);

  function onIncoming(frame) {
    const w = where.current;
    const ctx = {
      ...w,
      focused: document.visibilityState === 'visible' && document.hasFocus(),
      level: getNotifyLevel(),
      sounds: getMessageSounds(),
    };
    const sound = soundFor(frame, ctx);
    if (sound === 'mention') playMention();
    else if (sound === 'message') playMessage();

    const kind = shouldNotify(frame, ctx);
    if (!kind || !canNotify()) return;
    const isDm = frame.kind === 'dm';
    const author = isDm ? frame.from : frame.author;
    try {
      const group = isDm ? w.dmTitle?.(dmKeyOf(frame)) : null; // P9-06d: a group's name
      const n = new Notification(isDm ? (group ? `${author} in ${group}` : `${author}`) : `${author} in ${notificationPlace(frame)}`, {
        body: notificationText(frame.content, frame.attachments || []),
        icon: '/icon-192.png',
        // One notification per conversation: a newer one replaces the older.
        tag: isDm ? `dm:${dmKeyOf(frame)}` : `ch:${frame.space}:${frame.channel}`,
      });
      open.current.add(n);
      n.onclose = () => open.current.delete(n);
      n.onclick = () => {
        window.focus();
        if (isDm) w.openDm?.(dmKeyOf(frame));
        else if (frame.thread) w.openThread?.(frame.space, { channel: frame.channel, name: frame.thread.name, parentChannel: frame.thread.parentChannel });
        else w.openChannel?.(frame.space, frame.channel);
        n.close();
      };
    } catch {
      /* some browsers only allow notifications from a service worker */
    }
  }

  return { onIncoming, update };
}
