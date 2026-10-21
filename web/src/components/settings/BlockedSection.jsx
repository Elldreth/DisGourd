import Avatar from '../Avatar.jsx';
import { useBlocked } from '../../state/useBlocks.js';

// Settings › My account › Blocked people (P9-07b): who I've blocked, with Unblock.
export default function BlockedSection() {
  const { list, unblock } = useBlocked();
  return (
    <section className="rounded-xl bg-ink-900/60 p-4" aria-labelledby="blocked-heading">
      <h3 id="blocked-heading" className="text-xs font-semibold uppercase tracking-wide text-gray-500">Blocked people</h3>
      <p className="mt-1 text-xs text-gray-500">They can’t message you or add you to groups, and their messages are hidden behind “Show”. They aren’t told.</p>
      {list.length === 0 ? (
        <p className="mt-3 text-sm text-gray-400">You haven’t blocked anyone.</p>
      ) : (
        <ul aria-label="Blocked people" className="mt-3 space-y-1">
          {list.map((u) => (
            <li key={u.id} className="flex items-center gap-2 rounded-md py-1">
              <Avatar name={u.username} src={u.avatar} size={28} />
              <span className="min-w-0 flex-1 truncate text-sm text-gray-200">{u.username}</span>
              {unblock && (
                <button type="button" onClick={() => unblock(u.username)} className="tap shrink-0 rounded-lg bg-ink-600 px-3 py-1.5 text-sm text-gray-200 transition hover:bg-ink-500">
                  Unblock
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
