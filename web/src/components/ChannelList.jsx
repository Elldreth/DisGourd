import { useState } from 'react';
import UserFooter from './UserFooter.jsx';

export default function ChannelList({
  space,
  channels,
  currentChannel,
  unread = {},
  mentions = {},
  onSelect,
  onCreateChannel,
  canManage,
  isOwner,
  onInvite,
  onDeleteServer,
  user,
  avatar,
  onOpenProfile,
  status,
  onLogout,
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const trimmed = name.trim().replace(/\s+/g, '-').toLowerCase();
    if (!trimmed) return;
    await onCreateChannel(trimmed);
    setName('');
    setAdding(false);
  }

  return (
    <div className="flex w-60 flex-col bg-ink-800">
      <header className="relative flex h-12 items-center shadow-sm shadow-black/20">
        <button
          onClick={() => space && setMenuOpen((v) => !v)}
          className="flex h-full w-full items-center justify-between px-4 hover:bg-ink-700/40"
        >
          <h2 className="truncate font-bold">{space || 'No server'}</h2>
          {space && <span className="text-gray-400">{menuOpen ? '✕' : '⌄'}</span>}
        </button>

        {menuOpen && space && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="absolute left-2 right-2 top-11 z-20 rounded-lg bg-ink-900 p-1.5 shadow-xl ring-1 ring-ink-500/50">
              <MenuItem
                onClick={() => {
                  setMenuOpen(false);
                  onInvite();
                }}
              >
                <span className="text-brand">＋</span> Invite people
              </MenuItem>
              {isOwner && (
                <MenuItem
                  danger
                  onClick={() => {
                    setMenuOpen(false);
                    if (window.confirm(`Delete the server “${space}” for everyone? This cannot be undone.`)) {
                      onDeleteServer();
                    }
                  }}
                >
                  🗑 Delete server
                </MenuItem>
              )}
            </div>
          </>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-2 py-3">
        <div className="mb-1 flex items-center justify-between px-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            Text channels
          </span>
          {space && canManage && (
            <button
              onClick={() => setAdding((v) => !v)}
              title="Create channel"
              className="text-lg leading-none text-gray-400 hover:text-white"
            >
              +
            </button>
          )}
        </div>

        {adding && (
          <form onSubmit={submit} className="mb-1 px-1">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => !name && setAdding(false)}
              placeholder="new-channel"
              className="w-full rounded bg-ink-900 px-2 py-1 text-sm outline-none ring-1 ring-ink-500 focus:ring-brand"
            />
          </form>
        )}

        {channels.map((c) => {
          const active = c === currentChannel;
          const hasUnread = (unread[c] || 0) > 0 && !active;
          const mentionCount = active ? 0 : mentions[c] || 0;
          return (
            <button
              key={c}
              onClick={() => onSelect(c)}
              className={`mb-0.5 flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm transition ${
                active
                  ? 'bg-ink-600 text-white'
                  : hasUnread || mentionCount
                    ? 'font-semibold text-white hover:bg-ink-700/60'
                    : 'text-gray-400 hover:bg-ink-700/60 hover:text-gray-200'
              }`}
            >
              <span className="text-gray-500">#</span>
              <span className="flex-1 truncate">{c}</span>
              {mentionCount > 0 ? (
                <span className="shrink-0 rounded-full bg-danger px-1.5 text-xs font-bold text-white">
                  {mentionCount}
                </span>
              ) : hasUnread ? (
                <span className="h-2 w-2 shrink-0 rounded-full bg-gray-300" />
              ) : null}
            </button>
          );
        })}

        {space && channels.length === 0 && !adding && (
          <p className="px-2 py-1 text-sm text-gray-500">No channels yet.</p>
        )}
      </div>

      <UserFooter
        user={user}
        avatar={avatar}
        status={status}
        onOpenProfile={onOpenProfile}
        onLogout={onLogout}
      />
    </div>
  );
}

function MenuItem({ children, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition hover:bg-ink-600 ${
        danger ? 'text-danger' : 'text-gray-200'
      }`}
    >
      {children}
    </button>
  );
}
