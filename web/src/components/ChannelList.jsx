import { useState } from 'react';
import Avatar from './Avatar.jsx';

const STATUS_LABEL = {
  idle: { text: 'Not connected', color: 'bg-gray-500' },
  connecting: { text: 'Connecting…', color: 'bg-idle animate-pulse' },
  open: { text: 'Connected', color: 'bg-online' },
  reconnecting: { text: 'Reconnecting…', color: 'bg-idle animate-pulse' },
  closed: { text: 'Disconnected', color: 'bg-danger' },
};

export default function ChannelList({
  space,
  channels,
  currentChannel,
  onSelect,
  onCreateChannel,
  user,
  status,
  onLogout,
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  async function submit(e) {
    e.preventDefault();
    const trimmed = name.trim().replace(/\s+/g, '-').toLowerCase();
    if (!trimmed) return;
    await onCreateChannel(trimmed);
    setName('');
    setAdding(false);
  }

  const st = STATUS_LABEL[status] || STATUS_LABEL.idle;

  return (
    <div className="flex w-60 flex-col bg-ink-800">
      <header className="flex h-12 items-center px-4 shadow-sm shadow-black/20">
        <h2 className="truncate font-bold">{space || 'No server'}</h2>
      </header>

      <div className="flex-1 overflow-y-auto px-2 py-3">
        <div className="mb-1 flex items-center justify-between px-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            Text channels
          </span>
          {space && (
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
          return (
            <button
              key={c}
              onClick={() => onSelect(c)}
              className={`mb-0.5 flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm transition ${
                active
                  ? 'bg-ink-600 text-white'
                  : 'text-gray-400 hover:bg-ink-700/60 hover:text-gray-200'
              }`}
            >
              <span className="text-gray-500">#</span>
              <span className="truncate">{c}</span>
            </button>
          );
        })}

        {space && channels.length === 0 && !adding && (
          <p className="px-2 py-1 text-sm text-gray-500">No channels yet. Create one with +</p>
        )}
      </div>

      {/* Current-user footer with live connection status */}
      <div className="flex items-center gap-2 bg-ink-900/60 px-2 py-2">
        <Avatar name={user} size={32} status="online" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{user}</div>
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <span className={`h-2 w-2 rounded-full ${st.color}`} />
            {st.text}
          </div>
        </div>
        <button
          onClick={onLogout}
          title="Sign out"
          className="rounded p-1.5 text-gray-400 transition hover:bg-ink-600 hover:text-white"
        >
          ⎋
        </button>
      </div>
    </div>
  );
}
