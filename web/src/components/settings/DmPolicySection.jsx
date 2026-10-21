import { useEffect, useState } from 'react';
import * as api from '../../api.js';

// Settings › Privacy & safety › Who can message you (P11-09): who can start a
// new DM with you or add you to a group. Conversations you already have keep
// working either way.
const CHOICES = [
  { id: 'friends_and_servers', label: 'Friends and people in your servers', hint: 'The default.' },
  { id: 'everyone', label: 'Anyone on this site', hint: 'Including people you don’t share a server with.' },
];

export default function DmPolicySection() {
  const [policy, setPolicy] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    api.getMe().then((me) => live && setPolicy(me.dmPolicy || 'friends_and_servers')).catch(() => live && setPolicy('friends_and_servers'));
    return () => {
      live = false;
    };
  }, []);

  async function choose(next) {
    const before = policy;
    setPolicy(next);
    setError('');
    try {
      await api.updateMe({ dmPolicy: next });
    } catch {
      setPolicy(before);
      setError('Couldn’t save that. Try again.');
    }
  }

  return (
    <section className="rounded-xl bg-ink-900/60 p-4" aria-labelledby="dm-policy-heading">
      <h3 id="dm-policy-heading" className="text-xs font-semibold uppercase tracking-wide text-gray-500">Who can message you</h3>
      <p className="mt-1 text-xs text-gray-500">Who can start a DM with you or add you to a group. Conversations you already have keep working.</p>
      <div role="radiogroup" aria-label="Who can start a DM with you" className="mt-3 space-y-1">
        {CHOICES.map((c) => (
          <label key={c.id} className="flex cursor-pointer items-start gap-3 rounded-md px-1 py-1.5">
            <input
              type="radio"
              name="dm-policy"
              value={c.id}
              checked={policy === c.id}
              disabled={policy === null}
              onChange={() => choose(c.id)}
              className="mt-0.5 accent-brand"
            />
            <span className="text-sm text-gray-200">
              {c.label}
              <span className="block text-xs text-gray-500">{c.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
