// Channel categories (P3-25b): grouping a server's channels by category in
// layout order, the moves managers make, and the body for PUT /layout. Pure
// functions over { categories, channelMeta }, so they're easy to test.

// Groups in order: the uncategorized top (id null), then each category.
// Each group: { id, name, items: [{ name, type }] } in position order.
// `channels` / `voiceChannels` are the names to show (in the server's order);
// a channel with no category info (older data) goes to the top.
export function buildGroups(categories = [], channelMeta = {}, channels = [], voiceChannels = []) {
  const groups = [{ id: null, name: null, items: [] }, ...categories.map((c) => ({ id: c.id, name: c.name, items: [] }))];
  const byId = new Map(groups.map((g) => [g.id, g]));
  const all = [...channels.map((name) => ({ name, type: 'text' })), ...voiceChannels.map((name) => ({ name, type: 'voice' }))];
  const pos = (i) => channelMeta[i.name]?.position ?? Number.MAX_SAFE_INTEGER;
  all.map((item, i) => ({ item, i })).sort((a, b) => pos(a.item) - pos(b.item) || a.i - b.i).forEach(({ item }) => {
    const group = byId.get(channelMeta[item.name]?.category ?? null) || byId.get(null);
    group.items.push(item);
  });
  return groups;
}

// The PUT /layout body for some groups.
export function layoutBody(groups) {
  return {
    categories: groups.filter((g) => g.id !== null).map((g) => g.id),
    channels: groups.flatMap((g) => g.items.map((i) => ({ name: i.name, category: g.id }))),
  };
}

const clone = (groups) => groups.map((g) => ({ ...g, items: [...g.items] }));
function locate(groups, name) {
  for (let gi = 0; gi < groups.length; gi++) {
    const ii = groups[gi].items.findIndex((i) => i.name === name);
    if (ii >= 0) return [gi, ii];
  }
  return [-1, -1];
}

// Move a channel one place up (-1) or down (+1). At the edge of its group it
// crosses into the neighbouring group (to its end going up, its start going
// down). Returns new groups, or null if it can't move.
export function moveChannel(groups, name, delta) {
  const next = clone(groups);
  const [gi, ii] = locate(next, name);
  if (gi < 0) return null;
  const items = next[gi].items;
  const target = ii + delta;
  if (target >= 0 && target < items.length) {
    [items[ii], items[target]] = [items[target], items[ii]];
    return next;
  }
  const ng = gi + delta;
  if (ng < 0 || ng >= next.length) return null;
  const [item] = items.splice(ii, 1);
  if (delta < 0) next[ng].items.push(item);
  else next[ng].items.unshift(item);
  return next;
}

// Move a channel to the end of a category (null: the uncategorized top).
export function moveChannelTo(groups, name, categoryId) {
  const next = clone(groups);
  const [gi, ii] = locate(next, name);
  const dest = next.find((g) => g.id === categoryId);
  if (gi < 0 || !dest || next[gi] === dest) return null;
  const [item] = next[gi].items.splice(ii, 1);
  dest.items.push(item);
  return next;
}

// Move a category one place up or down among the categories (the top group
// always stays first).
export function moveCategory(groups, id, delta) {
  const next = clone(groups);
  const i = next.findIndex((g) => g.id === id);
  const j = i + delta;
  if (i < 1 || j < 1 || j >= next.length) return null;
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

// ---- Drag and drop (P3-25c) ----
// Drop a channel into a group at `index`, counted in the list as shown (before
// the dragged channel is lifted out). Returns new groups, or null if nothing
// changes.
export function dropChannel(groups, name, groupId, index) {
  const next = clone(groups);
  const [gi, ii] = locate(next, name);
  const dest = next.find((g) => g.id === groupId);
  if (gi < 0 || !dest) return null;
  let at = Math.max(0, Math.min(index, dest.items.length));
  if (next[gi] === dest && ii < at) at -= 1;
  if (next[gi] === dest && ii === at) return null;
  const [item] = next[gi].items.splice(ii, 1);
  dest.items.splice(at, 0, item);
  return next;
}

// Drop a category before the group at `index` (as shown; the top group stays
// first, so 1 is the first category place). Returns new groups, or null.
export function dropCategory(groups, id, index) {
  const next = clone(groups);
  const from = next.findIndex((g) => g.id === id);
  if (from < 1) return null;
  let at = Math.max(1, Math.min(index, next.length));
  if (from < at) at -= 1;
  if (from === at) return null;
  const [g] = next.splice(from, 1);
  next.splice(at, 0, g);
  return next;
}

// Where a channel dropped at height `y` lands, from the shown rows and
// headings in page order: [{ kind: 'row' | 'heading', group, index, top, bottom }].
// Above a heading's middle is the end of the group before it; below, that
// category's start. Returns { group, index }.
export function channelDropTarget(targets, y, groups) {
  for (const t of targets) {
    if (y >= t.bottom) continue;
    const mid = (t.top + t.bottom) / 2;
    if (t.kind === 'row') return { group: t.group, index: y < mid ? t.index : t.index + 1 };
    if (y >= mid) return { group: t.group, index: 0 };
    const gi = groups.findIndex((g) => g.id === t.group);
    const before = groups[Math.max(0, gi - 1)];
    return { group: before.id, index: before.items.length };
  }
  const last = groups[groups.length - 1];
  return { group: last.id, index: last.items.length };
}

// Where a category dropped at `y` lands among the category sections
// ([{ index, top, bottom }] in order): the group index to go before.
export function categoryDropIndex(sections, y, groupCount) {
  for (const s of sections) {
    if (y < (s.top + s.bottom) / 2) return s.index;
  }
  return groupCount;
}

// Which channel a group shows while collapsed: the one you're in, and any with
// unread mentions (and the voice channel you're connected to).
export function visibleWhenCollapsed(item, { current, mentions = {}, voiceChannel }) {
  if (item.type === 'voice') return item.name === voiceChannel;
  return item.name === current || (mentions[item.name] || 0) > 0;
}

// Collapsed categories, per server, remembered on this device.
const KEY = 'dg.collapsed';
export function loadCollapsed(space) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || '{}');
    return new Set(Array.isArray(all[space]) ? all[space] : []);
  } catch {
    return new Set();
  }
}
export function saveCollapsed(space, ids) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || '{}');
    all[space] = [...ids];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable: just not remembered */
  }
}
