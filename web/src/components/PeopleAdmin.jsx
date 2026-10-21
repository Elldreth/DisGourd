import { useId, useState } from 'react';
import * as api from '../api.js';
import ConfirmDialog from './ConfirmDialog.jsx';

// Settings › Site admin › People (P11-09): find an account by name and
// suspend it (signed out everywhere, can't sign in) or lift the suspension.
// `me` is your own username: your row has no button (the server refuses it).
const day = (ts) => new Date(ts).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });

export default function PeopleAdmin({ me }) {
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(null); // the search whose results are listed
  const [people, setPeople] = useState([]);
  const [error, setError] = useState('');
  const [asking, setAsking] = useState(null); // { person, suspend }
  const [reason, setReason] = useState('');
  const reasonId = useId();

  async function find(e) {
    e.preventDefault();
    const text = q.trim();
    if (!text) return;
    setError('');
    try {
      const { users } = await api.searchUsers(text);
      setPeople(users);
      setShown(text);
    } catch (err) {
      setError(err.message || 'Could not search');
    }
  }

  async function confirm() {
    const { person, suspend } = asking;
    setAsking(null);
    setError('');
    try {
      const updated = await api.setSuspended(person.username, suspend, suspend ? reason.trim() || undefined : undefined);
      setPeople((list) => list.map((p) => (p.username === person.username ? updated : p)));
    } catch (err) {
      setError(err.message || 'Could not change that');
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-400">
        A suspended account is signed out everywhere and can’t sign in until you lift it. Its messages stay.
      </p>
      <form role="search" onSubmit={find} className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Find people"
          placeholder="Username"
          autoComplete="off"
          spellCheck={false}
          className="input flex-1"
        />
        <button type="submit" className="rounded-lg bg-ink-600 px-3 py-2 text-sm font-semibold text-gray-200 hover:bg-ink-500">
          Find
        </button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {shown !== null &&
        (people.length === 0 ? (
          <p className="text-sm text-gray-400">Nobody matches “{shown}”.</p>
        ) : (
          <ul aria-label="People" className="space-y-1">
            {people.map((p) => (
              <li key={p.username} className="flex items-center gap-3 rounded-lg bg-ink-900/60 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-sm text-gray-200">
                    <span className="truncate font-medium">{p.username}</span>
                    {p.siteAdmin && <span className="rounded-full bg-ink-700 px-2 py-0.5 text-xs text-gray-300">Site admin</span>}
                    {p.suspended && (
                      <span className="rounded-full bg-danger/15 px-2 py-0.5 text-xs text-danger">
                        Suspended{p.suspendedReason ? ` · ${p.suspendedReason}` : ''}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-400">{p.lastSeenAt ? `Last seen ${day(p.lastSeenAt)}` : 'Not signed in lately'}</div>
                </div>
                {p.username === me ? (
                  <span className="shrink-0 px-3 text-sm text-gray-400">You</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setReason('');
                      setAsking({ person: p, suspend: !p.suspended });
                    }}
                    aria-label={p.suspended ? `Lift suspension for ${p.username}` : `Suspend ${p.username}`}
                    className={`tap shrink-0 rounded-lg px-3 py-1.5 text-sm transition ${
                      p.suspended ? 'bg-ink-600 text-gray-200 hover:bg-ink-500' : 'text-danger ring-1 ring-danger/40 hover:bg-danger/10'
                    }`}
                  >
                    {p.suspended ? 'Lift suspension' : 'Suspend'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        ))}
      {asking &&
        (asking.suspend ? (
          <ConfirmDialog
            title={`Suspend ${asking.person.username}?`}
            body="They’re signed out everywhere and can’t sign in until you lift it. Their messages stay."
            confirmLabel="Suspend"
            danger
            onConfirm={confirm}
            onCancel={() => setAsking(null)}
          >
            <div className="mt-4">
              <label htmlFor={reasonId} className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">
                Reason (optional, only site admins see it)
              </label>
              <input id={reasonId} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} autoComplete="off" className="input" />
            </div>
          </ConfirmDialog>
        ) : (
          <ConfirmDialog
            title={`Lift ${asking.person.username}’s suspension?`}
            body="They can sign in again."
            confirmLabel="Lift suspension"
            onConfirm={confirm}
            onCancel={() => setAsking(null)}
          />
        ))}
    </div>
  );
}
