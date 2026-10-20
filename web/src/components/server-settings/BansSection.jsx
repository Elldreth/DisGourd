import { useEffect, useState } from 'react';
import * as api from '../../api.js';
import { formatDay } from '../../util.js';

// Server settings › Bans (P3-26b; a section since P5-04): who is banned, by
// whom and why, with Unban. Unbanning doesn't bring them back; they can rejoin
// with an invite.
export default function BansSection({ space }) {
  const [bans, setBans] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getBans(space).then((r) => setBans(r.bans), (err) => setError(err.message || 'Could not load the bans'));
  }, [space]);

  async function unban(username) {
    setError('');
    try {
      await api.unbanMember(space, username);
      setBans((list) => list.filter((b) => b.username !== username));
    } catch (err) {
      setError(err.message || 'Could not unban');
    }
  }

  return (
    <div>
      <p className="mb-3 text-sm text-gray-400">Unbanning doesn’t bring someone back; they can rejoin with an invite.</p>
      <div className="rounded-xl bg-ink-900/60 px-4 py-2">
        {error && <div role="alert" className="mb-2 text-sm text-danger">{error}</div>}
        {bans === null && !error && <p className="py-6 text-center text-sm text-gray-400">Loading…</p>}
        {bans && bans.length === 0 && <p className="py-6 text-center text-sm text-gray-400">Nobody is banned.</p>}
        <ul className="divide-y divide-ink-500/30">
          {(bans || []).map((b) => (
            <li key={b.username} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-semibold text-fg">{b.username}</div>
                <div className="truncate text-xs text-gray-400">
                  {b.by ? `by ${b.by} · ` : ''}{formatDay(b.createdAt)}
                  {b.reason ? ` · ${b.reason}` : ''}
                </div>
              </div>
              <button
                onClick={() => unban(b.username)}
                aria-label={`Unban ${b.username}`}
                className="rounded-lg px-3 py-1.5 text-sm text-gray-200 ring-1 ring-ink-500 hover:bg-ink-700"
              >
                Unban
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
