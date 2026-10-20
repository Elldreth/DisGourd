import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Modal from './Modal.jsx';
import Mascot from './Mascot.jsx';

// Ctrl+K "go anywhere": channels in every server, the servers themselves and
// your DMs. Items:
//   { kind: 'channel', space, channel, unread?, mention? }
//   { kind: 'server', name, unread?, mention? }
//   { kind: 'dm', key, username, unread? }  (key: the conversation's, P9-06b)
//   { kind: 'person', username }       (people mode: a member you haven't messaged yet)
//
// `mode="people"` is the "New message" picker: the same dialog, listing only
// people (your conversations, then everyone you share a server with).

export const itemKey = (it) =>
  it.kind === 'channel' ? `c:${JSON.stringify([it.space, it.channel])}` : it.kind === 'server' ? `s:${it.name}` : `d:${it.key || it.username}`;

// The people-mode list: your conversations (with their unread counts) first,
// then members of your servers you haven't messaged, never yourself, no repeats.
export function peopleItems({ me, conversations = [], unread = {}, members = [] }) {
  const seen = new Set([me]);
  const items = [];
  for (const c of conversations) {
    if (c.kind === 'group' || !c.username || seen.has(c.username)) continue; // people only (groups: the go-anywhere list)
    seen.add(c.username);
    items.push({ kind: 'dm', key: c.key, username: c.username, unread: unread[c.key] || 0 });
  }
  for (const m of members) {
    if (seen.has(m.username)) continue;
    seen.add(m.username);
    items.push({ kind: 'person', username: m.username });
  }
  return items;
}

const itemName = (it) => (it.kind === 'channel' ? it.channel : it.kind === 'server' ? it.name : it.username);

// ---- Recently visited (per user, last 10, newest first) ----
const MAX_RECENT = 10;
const recentStorageKey = (who) => `disgourd.recent.${who}`;

export function loadRecent(who) {
  try {
    const list = JSON.parse(localStorage.getItem(recentStorageKey(who)) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function recordVisit(key, who) {
  if (!key || !who) return;
  try {
    const next = [key, ...loadRecent(who).filter((k) => k !== key)].slice(0, MAX_RECENT);
    localStorage.setItem(recentStorageKey(who), JSON.stringify(next));
  } catch {
    // storage unavailable (private window): recents just aren't remembered
  }
}

// ---- Matching and ranking ----
// How well `q` matches `text`: 4 starts with it, 3 a word starts with it,
// 2 contains it, 1 has its letters in order, 0 no match.
function matchTier(text, q) {
  const t = text.toLowerCase();
  if (t.startsWith(q)) return 4;
  if (t.split(/[\s\-_.]+/).some((w) => w.startsWith(q))) return 3;
  if (t.includes(q)) return 2;
  let i = 0;
  for (const ch of t) if (ch === q[i]) i++;
  return i === q.length ? 1 : 0;
}

// Better matches first; among equals: mentions, then unread, then the ones
// you visited most recently, then the order given (server order).
export function rankItems(items, query, recent) {
  const q = query.trim().toLowerCase();
  const recency = new Map(recent.map((k, i) => [k, recent.length - i]));
  const scored = [];
  items.forEach((it, order) => {
    const tier = q ? matchTier(itemName(it), q) : 1;
    if (!tier) return;
    scored.push({ it, order, tier, mention: it.mention ? 1 : 0, unread: it.unread || 0, recent: recency.get(itemKey(it)) || 0 });
  });
  scored.sort(
    (a, b) => b.tier - a.tier || b.mention - a.mention || b.unread - a.unread || b.recent - a.recent || a.order - b.order
  );
  return scored.map((s) => s.it);
}

const MAX_SHOWN = 50;

// `onNewGroup` (people mode, P9-06d): a "Start a group" button.
export default function QuickSwitcher({ items, recent, onPick, onClose, mode = 'go', onNewGroup }) {
  const people = mode === 'people';
  const prompt = people ? 'Message who?' : 'Where do you want to go?';
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listId = useId();
  const optionId = (i) => `${listId}-opt-${i}`;
  const results = useMemo(() => rankItems(items, query, recent).slice(0, MAX_SHOWN), [items, query, recent]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  function onKeyDown(e) {
    const n = results.length;
    if (e.key === 'ArrowDown' && n) {
      e.preventDefault();
      setActive((a) => (a + 1) % n);
    } else if (e.key === 'ArrowUp' && n) {
      e.preventDefault();
      setActive((a) => (a - 1 + n) % n);
    } else if (e.key === 'Enter' && n) {
      e.preventDefault();
      onPick(results[active]);
    }
  }

  return (
    <Modal
      onClose={onClose}
      label={people ? 'New message' : 'Quick switcher'}
      initialFocusRef={inputRef}
      backdropClassName="flex items-start justify-center bg-black/60 p-4 pt-20"
      panelClassName="flex max-h-[70vh] w-full max-w-lg flex-col rounded-xl bg-ink-800 shadow-2xl ring-1 ring-ink-500/50"
    >
      <div className="border-b border-ink-500/40 p-3">
        <input
          ref={inputRef}
          role="combobox"
          aria-label={prompt}
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={results.length ? optionId(active) : undefined}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={prompt}
          autoComplete="off"
          spellCheck={false}
          className="w-full bg-transparent text-lg text-gray-100 outline-hidden placeholder:text-gray-500"
        />
      </div>
      <ul id={listId} role="listbox" aria-label={people ? 'People' : 'Destinations'} className="flex-1 overflow-y-auto p-2">
        {results.map((it, i) => (
          <li
            key={itemKey(it)}
            id={optionId(i)}
            role="option"
            aria-selected={i === active}
            onMouseMove={() => i !== active && setActive(i)}
            onClick={() => onPick(it)}
            className={`flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm ${
              i === active ? 'bg-ink-600 text-fg' : 'text-gray-300'
            }`}
          >
            <span className="w-4 shrink-0 text-center text-gray-500" aria-hidden="true">
              {it.kind === 'channel' ? '#' : it.kind === 'dm' || it.kind === 'person' ? '@' : '◆'}
            </span>
            <span className={`truncate ${it.unread || it.mention ? 'font-semibold text-gray-100' : ''}`}>{itemName(it)}</span>
            {it.kind === 'channel' && <span className="truncate text-xs text-gray-500">{it.space}</span>}
            {it.kind === 'server' && <span className="text-xs text-gray-500">server</span>}
            {it.kind === 'dm' && <span className="text-xs text-gray-500">direct message</span>}
            {it.kind === 'person' && <span className="text-xs text-gray-500">member</span>}
            {(it.mention || it.unread) > 0 && (
              <span className="ml-auto rounded-full bg-danger px-1.5 text-xs font-bold text-ink-900">
                {it.mention ? `@${it.mention}` : it.unread}
              </span>
            )}
          </li>
        ))}
      </ul>
      {results.length === 0 && (
        <p className="flex flex-col items-center gap-2 p-4 text-center text-sm text-gray-500">
          <Mascot pose="confused" size={48} />
          {people ? 'No one by that name in your servers. People you share a server with show up here.' : 'No matches. Try another name.'}
        </p>
      )}
      <div className="flex items-center justify-between gap-2 border-t border-ink-500/40 px-3 py-2 text-xs text-gray-500">
        <span>{people ? '↑↓ to choose · Enter to message · Esc to close' : '↑↓ to choose · Enter to go · Esc to close · Alt+↑↓ switches channels'}</span>
        {people && onNewGroup && (
          <button type="button" onClick={onNewGroup} className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-brand-hi hover:bg-ink-700">
            Start a group
          </button>
        )}
      </div>
    </Modal>
  );
}
