import Avatar from './Avatar.jsx';

// Right-hand roster of the current server's members, grouped by online status,
// with an owner badge.
export default function MemberList({ members }) {
  const online = members.filter((m) => m.online);
  const offline = members.filter((m) => !m.online);

  return (
    <aside className="hidden w-56 flex-col bg-ink-800 lg:flex">
      <header className="flex h-12 items-center px-4 shadow-sm shadow-black/20">
        <h3 className="text-sm font-semibold text-gray-300">Members — {members.length}</h3>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
        {members.length === 0 && (
          <p className="px-2 text-sm text-gray-500">No members to show.</p>
        )}
        <Group label="Online" people={online} status="online" />
        <Group label="Offline" people={offline} status="offline" />
      </div>
    </aside>
  );
}

function Group({ label, people, status }) {
  if (people.length === 0) return null;
  return (
    <div>
      <div className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {label} — {people.length}
      </div>
      {people.map((p) => (
        <div
          key={p.username}
          className={`flex items-center gap-2 rounded px-2 py-1.5 hover:bg-ink-700/60 ${
            status === 'offline' ? 'opacity-50' : ''
          }`}
        >
          <Avatar name={p.username} size={30} status={status} src={p.avatar} />
          <span className="min-w-0 flex-1 truncate text-sm text-gray-200">{p.username}</span>
          {p.role === 'owner' && (
            <span className="shrink-0 rounded bg-brand/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-brand">
              Owner
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
