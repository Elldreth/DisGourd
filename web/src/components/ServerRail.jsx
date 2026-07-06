import { useState } from 'react';
import { initials, colorForName } from '../util.js';
import Icon from './Icon.jsx';
import Gourd from './Gourd.jsx';

// The far-left rail of server (space) icons, Discord-style, plus create/join.
export default function ServerRail({
  spaces,
  currentSpace,
  unread = {},
  mentions = {},
  dmActive,
  dmUnread = 0,
  onSelectDms,
  onSelect,
  onCreate,
  onJoin,
  onReorder,
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState('');
  const [dragIndex, setDragIndex] = useState(null);
  const [dropIndex, setDropIndex] = useState(null);

  function handleDrop(toIndex) {
    if (dragIndex !== null && dragIndex !== toIndex && onReorder) {
      const names = spaces.map((s) => s.name);
      const [moved] = names.splice(dragIndex, 1);
      names.splice(toIndex, 0, moved);
      onReorder(names);
    }
    setDragIndex(null);
    setDropIndex(null);
  }

  async function submitCreate(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    await onCreate(trimmed);
    setName('');
    setAdding(false);
  }

  async function submitJoin(e) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    await onJoin(trimmed);
    setCode('');
    setJoining(false);
  }

  return (
    <nav className="relative flex w-[72px] flex-col items-center gap-2 bg-ink-900 py-3">
      <button
        onClick={onSelectDms}
        title="Direct Messages"
        className={`relative mb-1 flex h-12 w-12 items-center justify-center text-white transition-all hover:rounded-2xl active:scale-90 ${
          dmActive ? 'rounded-2xl bg-brand' : 'rounded-[26px] bg-ink-700 hover:bg-brand'
        }`}
      >
        <Gourd size={26} color="#fff" title="Direct Messages" />
        {dmUnread > 0 && !dmActive && (
          <span className="absolute -bottom-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full border-2 border-ink-900 bg-danger px-1 text-xs font-bold">
            {dmUnread > 99 ? '99+' : dmUnread}
          </span>
        )}
      </button>
      <div className="h-px w-8 bg-ink-500/50" />

      <div className="flex flex-1 flex-col items-center gap-2 overflow-y-auto">
        {spaces.map((s, i) => {
          const active = s.name === currentSpace;
          const count = unread[s.name] || 0;
          const mentionCount = mentions[s.name] || 0;
          return (
            <button
              key={s.name}
              onClick={() => onSelect(s.name)}
              title={`${s.name} — drag to reorder`}
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => { e.preventDefault(); if (dropIndex !== i) setDropIndex(i); }}
              onDrop={() => handleDrop(i)}
              onDragEnd={() => { setDragIndex(null); setDropIndex(null); }}
              className={`group relative flex h-12 w-12 items-center justify-center overflow-hidden font-semibold text-white transition-all duration-150 hover:rounded-2xl active:scale-90 ${
                active ? 'rounded-2xl' : 'rounded-[26px]'
              } ${dragIndex === i ? 'opacity-40' : ''} ${dropIndex === i && dragIndex !== i ? 'ring-2 ring-white/70' : ''}`}
              style={{ backgroundColor: s.icon ? undefined : active ? '#7d6ff3' : colorForName(s.name) }}
            >
              <span
                className={`absolute -left-3 z-10 w-1 rounded-r bg-white transition-all ${
                  active ? 'h-8' : count > 0 ? 'h-3' : 'h-0 group-hover:h-5'
                }`}
              />
              {s.icon ? (
                <img src={s.icon} alt={s.name} className="h-full w-full object-cover" />
              ) : (
                initials(s.name)
              )}
              {mentionCount > 0 && !active && (
                <span className="absolute -bottom-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full border-2 border-ink-900 bg-danger px-1 text-xs font-bold text-white">
                  {mentionCount > 99 ? '99+' : mentionCount}
                </span>
              )}
            </button>
          );
        })}

        {adding ? (
          <form onSubmit={submitCreate} className="px-1">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => !name && setAdding(false)}
              placeholder="name"
              className="w-14 rounded-lg bg-ink-700 px-1 py-1 text-center text-xs outline-none ring-1 ring-ink-500 focus:ring-brand"
            />
          </form>
        ) : (
          <button
            onClick={() => { setAdding(true); setJoining(false); }}
            title="Create a server"
            className="flex h-12 w-12 items-center justify-center rounded-[26px] bg-ink-700 text-online transition-all hover:rounded-2xl hover:bg-online hover:text-white active:scale-90"
          >
            <Icon name="plus" size={24} />
          </button>
        )}

        <button
          onClick={() => { setJoining((v) => !v); setAdding(false); }}
          title="Join a server with an invite"
          className="flex h-12 w-12 items-center justify-center rounded-[26px] bg-ink-700 text-gray-300 transition-all hover:rounded-2xl hover:bg-brand hover:text-white active:scale-90"
        >
          <Icon name="login" size={20} />
        </button>
      </div>

      {joining && (
        <div className="anim-pop absolute bottom-3 left-[76px] z-20 w-60 rounded-lg bg-ink-800 p-3 shadow-xl ring-1 ring-ink-500/50">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Join a server
          </div>
          <form onSubmit={submitJoin}>
            <input
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Paste invite code"
              className="input"
            />
            <div className="mt-2 flex justify-end gap-2 text-sm">
              <button
                type="button"
                onClick={() => setJoining(false)}
                className="rounded px-2 py-1 text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded bg-brand px-3 py-1 font-semibold text-white hover:bg-brand-hover"
              >
                Join
              </button>
            </div>
          </form>
        </div>
      )}
    </nav>
  );
}
