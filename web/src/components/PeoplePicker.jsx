import { useId, useMemo, useRef, useState } from 'react';
import Modal from './Modal.jsx';
import Avatar from './Avatar.jsx';
import BlockedMatches, { blockedMatching } from './BlockedMatches.jsx';

// Pick several people (P9-06d): for a new group, for one started from a
// 1-to-1 (that person comes already picked and stays), or to add to a group.
//   people:    [{ username, avatar? }] who can be picked (people you share a
//              server with, and friends; the caller leaves out who's already in)
//   locked:    usernames already picked that can't be unpicked
//   min / max: how many to pick, counting `locked`
//   withName:  ask for an optional group name
//   note:      a line under the list
//   confirmLabel(count): the button's words for that many picked
//   onConfirm({ members, name }) / onClose
export default function PeoplePicker({
  title, people = [], locked = [], min = 1, max = 9, withName = false, note, confirmLabel = (n) => `Add ${n}`, onConfirm, onClose,
  blocked = [], onUnblock, // P10-03: blocked people matching the search, greyed, with Unblock
}) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(locked);
  const [name, setName] = useState('');
  const inputRef = useRef(null);
  const nameId = useId();
  const listId = useId();
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people.filter((p) => !q || p.username.toLowerCase().includes(q)).slice(0, 50);
  }, [people, query]);
  const full = picked.length >= max;
  const toggle = (username) => {
    if (locked.includes(username)) return;
    setPicked((prev) => (prev.includes(username) ? prev.filter((u) => u !== username) : prev.length >= max ? prev : [...prev, username]));
  };
  const ready = picked.length >= min && picked.length <= max;

  return (
    <Modal
      onClose={onClose}
      initialFocusRef={inputRef}
      backdropClassName="flex items-start justify-center bg-black/60 p-4 pt-20"
      panelClassName="flex max-h-[75vh] w-full max-w-md flex-col rounded-xl bg-ink-800 shadow-2xl ring-1 ring-ink-500/50"
    >
      <div className="space-y-3 border-b border-ink-500/40 p-4">
        <Modal.Title>{title}</Modal.Title>
        {picked.length > 0 && (
          <ul aria-label="Picked" className="flex flex-wrap gap-1.5">
            {picked.map((u) => (
              <li key={u} className="flex items-center gap-1 rounded-full bg-ink-600 py-0.5 pl-1 pr-2 text-xs text-gray-200">
                <Avatar name={u} size={18} />
                {u}
                {!locked.includes(u) && (
                  <button type="button" onClick={() => toggle(u)} aria-label={`Unpick ${u}`} className="ml-0.5 rounded px-0.5 text-gray-400 hover:text-fg">
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <input
          ref={inputRef}
          aria-label="Find people"
          aria-controls={listId}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find people"
          autoComplete="off"
          spellCheck={false}
          className="input"
        />
      </div>
      <ul id={listId} aria-label="People" className="flex-1 overflow-y-auto p-2">
        {shown.map((p) => {
          const on = picked.includes(p.username);
          const fixed = locked.includes(p.username);
          return (
            <li key={p.username}>
              <label className={`flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm ${on ? 'bg-ink-600 text-fg' : 'text-gray-300 hover:bg-ink-700'}`}>
                <input
                  type="checkbox"
                  aria-label={p.username}
                  checked={on}
                  disabled={fixed || (!on && full)}
                  onChange={() => toggle(p.username)}
                  className="accent-brand"
                />
                <Avatar name={p.username} src={p.avatar} size={24} />
                <span className="truncate">{p.username}</span>
              </label>
            </li>
          );
        })}
        {shown.length === 0 && !blockedMatching(blocked, query).length && <li className="p-4 text-center text-sm text-gray-500">No one by that name. People you share a server with, and friends, show up here.</li>}
      </ul>
      <BlockedMatches query={query} blocked={blocked} onUnblock={onUnblock} returnFocusTo={inputRef} />
      <div className="space-y-3 border-t border-ink-500/40 p-4">
        {withName && (
          <div>
            <label htmlFor={nameId} className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">Group name (optional)</label>
            <input id={nameId} value={name} maxLength={50} onChange={(e) => setName(e.target.value)} className="input" placeholder="e.g. Gourd Club" />
          </div>
        )}
        {note && <p className="text-xs text-gray-400">{note}</p>}
        {full && <p className="text-xs text-gray-500">That’s as many as a group can hold.</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:text-fg">
            Cancel
          </button>
          <button
            type="button"
            disabled={!ready}
            onClick={() => onConfirm({ members: picked, name: name.trim() })}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {confirmLabel(picked.length)}
          </button>
        </div>
      </div>
    </Modal>
  );
}
