import { useState } from 'react';
import { initials, colorForName } from '../util.js';
import Icon from './Icon.jsx';
import Gourd from './Gourd.jsx';
import CreateServerDialog from './CreateServerDialog.jsx';

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
  const [dialogTab, setDialogTab] = useState(null); // 'create' | 'join' | null
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

  return (
    <nav className="relative flex w-[72px] flex-col items-center gap-2 bg-ink-900 py-3">
      <button
        onClick={onSelectDms}
        title="Direct Messages"
        className={`relative mb-1 flex h-12 w-12 items-center justify-center transition-all hover:rounded-2xl active:scale-90 ${
          dmActive ? 'rounded-2xl bg-brand text-white' : 'rounded-[26px] bg-ink-700 text-fg hover:bg-brand hover:text-white'
        }`}
      >
        <Gourd size={34} color="currentColor" title="Direct Messages" />
        {dmUnread > 0 && !dmActive && (
          <span className="absolute -bottom-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full border-2 border-ink-900 bg-danger px-1 text-xs font-bold text-ink-900">
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
              } ${!s.icon && active ? 'bg-brand' : ''} ${dragIndex === i ? 'opacity-40' : ''} ${dropIndex === i && dragIndex !== i ? 'ring-2 ring-fg/70' : ''}`}
              style={{ backgroundColor: s.icon || active ? undefined : colorForName(s.name) }}
            >
              <span
                className={`absolute -left-3 z-10 w-1 rounded-r bg-fg transition-all ${
                  active ? 'h-8' : count > 0 ? 'h-3' : 'h-0 group-hover:h-5'
                }`}
              />
              {s.icon ? (
                <img src={s.icon} alt={s.name} className="h-full w-full object-cover" />
              ) : (
                initials(s.name)
              )}
              {mentionCount > 0 && !active && (
                <span className="absolute -bottom-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full border-2 border-ink-900 bg-danger px-1 text-xs font-bold text-ink-900">
                  {mentionCount > 99 ? '99+' : mentionCount}
                </span>
              )}
            </button>
          );
        })}

        <button
          onClick={() => setDialogTab('create')}
          title="Create a server"
          aria-label="Create a server"
          className="flex h-12 w-12 items-center justify-center rounded-[26px] bg-ink-700 text-online transition-all hover:rounded-2xl hover:bg-online hover:text-ink-900 active:scale-90"
        >
          <Icon name="plus" size={24} />
        </button>

        <button
          onClick={() => setDialogTab('join')}
          title="Join a server with an invite"
          aria-label="Join a server with an invite"
          className="flex h-12 w-12 items-center justify-center rounded-[26px] bg-ink-700 text-gray-300 transition-all hover:rounded-2xl hover:bg-brand hover:text-white active:scale-90"
        >
          <Icon name="login" size={20} />
        </button>
      </div>

      {dialogTab && (
        <CreateServerDialog
          initialTab={dialogTab}
          onCreate={onCreate}
          onJoin={onJoin}
          onClose={() => setDialogTab(null)}
        />
      )}
    </nav>
  );
}
