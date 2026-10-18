// The "New" divider: where you stopped reading a channel, and whether that
// spot is loaded yet. Pure helpers; the channel hook and MessageList use them.

// messages: the loaded transcript (oldest first). since: the last message id
// you had read (null = unknown, so no divider). hasMore: older history exists.
// Returns null (no divider), { id, loaded: true } (draw it before message
// `id`), or { id: null, loaded: false } (the first new message is further up).
export function newDivider(messages, since, me, hasMore) {
  if (since == null) return null;
  const first = messages.findIndex((x) => x.id > since);
  if (first === -1) return null;
  // Every loaded message is new and there's older history: the real first
  // new message hasn't been loaded yet.
  if (first === 0 && hasMore) return { id: null, loaded: false };
  const target = messages.slice(first).find((x) => x.author !== me);
  return target ? { id: target.id, loaded: true } : null;
}

// The divider's `since` for a DM you open with `count` unread (P3-20b): DMs
// keep no last-read id in the app, but the unread messages are the partner's
// newest `count`, so the divider goes before the first of them. When they go
// back further than what's loaded, `since` is just before the first loaded
// message (with older history, newDivider then says "not loaded yet").
export function dmSince(messages, count, me) {
  if (!count || count <= 0 || !messages.length) return null;
  const theirs = messages.filter((m) => m.author !== me);
  if (count > theirs.length) return (messages[0].id || 1) - 1;
  return theirs[theirs.length - count].id - 1;
}

// Combine last-read ids (unreadKey -> id), keeping the higher of each.
export function mergeLastRead(prev, next) {
  const out = { ...prev };
  for (const [k, id] of Object.entries(next)) out[k] = Math.max(out[k] || 0, id || 0);
  return out;
}
