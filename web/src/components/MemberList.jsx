import Avatar from './Avatar.jsx';

// Right-hand roster. The backend tracks presence via the friends graph, so this
// panel shows your friends and whether they're currently online.
export default function MemberList({ friends }) {
  const online = friends.filter((f) => f.online);
  const offline = friends.filter((f) => !f.online);

  return (
    <aside className="hidden w-56 flex-col bg-ink-800 lg:flex">
      <header className="flex h-12 items-center px-4 shadow-sm shadow-black/20">
        <h3 className="text-sm font-semibold text-gray-300">Friends</h3>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
        {friends.length === 0 && (
          <p className="px-2 text-sm text-gray-500">
            No friends yet. Presence appears here once you add friends.
          </p>
        )}
        <Group label="Online" count={online.length} people={online} status="online" />
        <Group label="Offline" count={offline.length} people={offline} status="offline" />
      </div>
    </aside>
  );
}

function Group({ label, count, people, status }) {
  if (count === 0) return null;
  return (
    <div>
      <div className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {label} — {count}
      </div>
      {people.map((p) => (
        <div
          key={p.username}
          className={`flex items-center gap-2 rounded px-2 py-1.5 hover:bg-ink-700/60 ${
            status === 'offline' ? 'opacity-50' : ''
          }`}
        >
          <Avatar name={p.username} size={30} status={status} />
          <span className="truncate text-sm text-gray-200">{p.username}</span>
        </div>
      ))}
    </div>
  );
}
