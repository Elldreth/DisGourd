import { useEffect, useState } from 'react';
import * as api from '../../api.js';
import Icon from '../Icon.jsx';
import ConfirmDialog from '../ConfirmDialog.jsx';
import { formatAgo } from '../../util.js';

// Settings › Privacy & safety › Signed-in devices (P9-03; moved out of My
// account in P10-02): each device you're signed in on, with "This device" on
// yours and Sign out on the others, and "Sign out all other devices".
// `onToken(token)` takes this device's fresh token after signing out the others.
// P10-02: this device comes first; then the others by activity, five at a
// time ("Show n more"); a sign-in with no browser name reads "Unknown browser".
const SHOWN = 5;
export const deviceLabel = (device) => (!device || device === 'Unknown device' ? 'Unknown browser' : device);
const isMobile = (label) => /iPhone|iPad|Android/.test(label || '');
const day = (ts) => new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
// "Active now" within two minutes, else "Active 5 minutes ago".
export function activeWords(ts, now = Date.now()) {
  return now - ts < 2 * 60 * 1000 ? 'Active now' : `Active ${formatAgo(ts, now)}`;
}

export default function DevicesSection({ onToken }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [confirmAll, setConfirmAll] = useState(false);
  const [note, setNote] = useState('');
  const [showAll, setShowAll] = useState(false);

  async function load() {
    try {
      setData(await api.getSessions());
    } catch (err) {
      setError(err.message || 'Could not load your devices');
    }
  }
  useEffect(() => {
    load();
    // A device signed in or out somewhere (the server tells open windows).
    window.addEventListener('disgourd:sessions-changed', load);
    return () => window.removeEventListener('disgourd:sessions-changed', load);
  }, []);

  async function signOut(id) {
    setError('');
    try {
      await api.signOutSession(id);
      setNote('Signed out.');
      await load();
    } catch (err) {
      setError(err.message || 'Could not sign that device out');
    }
  }

  async function signOutOthers() {
    setConfirmAll(false);
    setError('');
    try {
      const { token } = await api.signOutOtherSessions();
      onToken?.(token);
      setNote('Your other devices were signed out.');
      await load();
    } catch (err) {
      setError(err.message || 'Could not sign out your other devices');
    }
  }

  const sessions = data?.sessions || [];
  const others = sessions.filter((s) => !s.current);
  const shown = [...sessions.filter((s) => s.current), ...(showAll ? others : others.slice(0, SHOWN))];
  const hiddenCount = others.length - (showAll ? others.length : Math.min(others.length, SHOWN));
  return (
    <div className="rounded-xl bg-ink-900/60 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Signed-in devices</div>
      {error && <div role="alert" className="mt-2 text-sm text-danger">{error}</div>}
      {!data && !error && <p className="mt-2 text-sm text-gray-400">Loading…</p>}
      <ul aria-label="Signed-in devices" className="mt-2 divide-y divide-ink-500/30">
        {shown.map((s) => (
          <li key={s.id} className="flex items-center gap-3 py-2">
            <Icon name={isMobile(s.device) ? 'phone' : 'monitor'} size={20} className="shrink-0 text-gray-400" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-fg">{deviceLabel(s.device)}</div>
              <div className="text-xs text-gray-500">
                Signed in {day(s.createdAt)} · {s.current ? 'Active now' : activeWords(s.lastSeenAt)}
              </div>
            </div>
            {s.current ? (
              <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold text-online ring-1 ring-online/50">This device</span>
            ) : (
              <button
                type="button"
                onClick={() => signOut(s.id)}
                aria-label={`Sign out ${deviceLabel(s.device)}`}
                className="tap shrink-0 rounded-lg px-3 py-1.5 text-sm text-gray-200 ring-1 ring-ink-500 transition hover:bg-ink-700"
              >
                Sign out
              </button>
            )}
          </li>
        ))}
      </ul>
      {hiddenCount > 0 && (
        <button type="button" onClick={() => setShowAll(true)} className="tap mt-1 rounded-lg px-2 py-1 text-sm text-brand-hi hover:underline">
          Show {hiddenCount} more
        </button>
      )}
      {data && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setConfirmAll(true)}
            disabled={others.length === 0 && !data.olderSignIns}
            className="tap rounded-lg px-3 py-1.5 text-sm font-semibold text-danger ring-1 ring-danger/40 transition hover:bg-danger/10 disabled:opacity-40"
          >
            Sign out all other devices
          </button>
          {note && <span role="status" className="text-sm text-online">{note}</span>}
        </div>
      )}
      <p className="mt-3 text-xs text-gray-500">
        Sign-ins from before this update aren’t listed. They end within a week, or now with Sign out all other devices.
      </p>
      {confirmAll && (
        <ConfirmDialog
          title="Sign out all other devices?"
          body="Every other place you're signed in will go back to the sign-in page. This device stays signed in."
          confirmLabel="Sign out others"
          danger
          onCancel={() => setConfirmAll(false)}
          onConfirm={signOutOthers}
        />
      )}
    </div>
  );
}
