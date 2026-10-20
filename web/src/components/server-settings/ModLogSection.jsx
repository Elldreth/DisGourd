import { useEffect, useState } from 'react';
import * as api from '../../api.js';
import { formatDay, formatTime } from '../../util.js';

// Server settings › Moderation log (P3-26a; a section since P5-04): who deleted, removed, or changed roles
// and access, newest first, 50 at a time. Filter by action or by person.
export const MOD_LOG_ABILITIES = ['ban_members', 'timeout_members', 'kick', 'delete_others_messages', 'manage_roles'];

const ACTIONS = [
  ['', 'All actions'],
  ['message_delete', 'Message deletes'],
  ['kick', 'Removals'],
  ['ban', 'Bans'],
  ['unban', 'Unbans'],
  ['timeout', 'Timeouts'],
  ['timeout_remove', 'Timeouts removed'],
  ['slowmode', 'Slow mode'],
  ['role_add', 'Roles given'],
  ['role_remove', 'Roles taken'],
  ['channel_access', 'Channel access'],
  ['category_access', 'Category access'],
];

const B = ({ children }) => <span className="font-semibold text-fg">{children ?? 'someone'}</span>;

// "@everyone: can't view, can post" for an access change.
function accessSummary(roles = []) {
  const word = (v, yes, no) => (v == null ? null : v ? yes : no);
  return roles
    .map((r) => {
      const parts = [word(r.view, 'can view', "can't view"), word(r.post, 'can post', "can't post")].filter(Boolean);
      return `${r.role}: ${parts.length ? parts.join(', ') : 'inherits'}`;
    })
    .join('; ');
}

const DURATIONS = { 5: '5 minutes', 60: '1 hour', 1440: '1 day', 10080: '1 week' };
const durationWords = (minutes) => DURATIONS[minutes] || `${minutes} minutes`;
const SLOWMODE_WORDS = { 5: '5 seconds', 30: '30 seconds', 60: '1 minute', 300: '5 minutes' };

export function describeEntry(e) {
  const d = e.details || {};
  switch (e.action) {
    case 'message_delete':
      return (
        <>
          <B>{e.actor}</B> deleted a message by <B>{e.target}</B> in #{d.channel}
          {d.excerpt ? <span className="text-gray-400">: “{d.excerpt}”</span> : null}
        </>
      );
    case 'kick':
      return <><B>{e.actor}</B> removed <B>{e.target}</B> from the server</>;
    case 'ban':
      return (
        <>
          <B>{e.actor}</B> banned <B>{e.target}</B>
          {d.deleted ? <span className="text-gray-400"> and deleted {d.deleted} message{d.deleted === 1 ? '' : 's'} from the last {d.deleteMessages}</span> : null}
        </>
      );
    case 'timeout':
      return <><B>{e.actor}</B> timed out <B>{e.target}</B> for {durationWords(d.minutes)}</>;
    case 'timeout_remove':
      return <><B>{e.actor}</B> removed <B>{e.target}</B>’s timeout</>;
    case 'slowmode':
      return d.seconds
        ? <><B>{e.actor}</B> set slow mode in #{d.channel} to {SLOWMODE_WORDS[d.seconds] || `${d.seconds} seconds`}</>
        : <><B>{e.actor}</B> turned off slow mode in #{d.channel}</>;
    case 'unban':
      return <><B>{e.actor}</B> unbanned <B>{e.target}</B></>;
    case 'role_add':
      return <><B>{e.actor}</B> gave <B>{e.target}</B> the {d.role} role</>;
    case 'role_remove':
      return <><B>{e.actor}</B> took the {d.role} role from <B>{e.target}</B></>;
    case 'channel_access':
      return <><B>{e.actor}</B> changed access to #{d.channel} <span className="text-gray-400">({accessSummary(d.roles)})</span></>;
    case 'category_access':
      return <><B>{e.actor}</B> changed access to the {d.category} category <span className="text-gray-400">({accessSummary(d.roles)})</span></>;
    default:
      return <><B>{e.actor}</B> {e.action.replace(/_/g, ' ')}{e.target ? <> <B>{e.target}</B></> : null}</>;
  }
}

export default function ModLogSection({ space, members = [] }) {
  const [action, setAction] = useState('');
  const [person, setPerson] = useState('');
  const [entries, setEntries] = useState([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load(before) {
    setLoading(true);
    setError('');
    try {
      const page = await api.getModLog(space, { before, action, user: person });
      setEntries((prev) => (before ? [...prev, ...page.entries] : page.entries));
      setMore(page.more);
    } catch (err) {
      setError(err.message || 'Could not load the log');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [space, action, person]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <select aria-label="Action" value={action} onChange={(e) => setAction(e.target.value)} className="input w-auto">
          {ACTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select aria-label="Person" value={person} onChange={(e) => setPerson(e.target.value)} className="input w-auto">
          <option value="">Everyone</option>
          {members.map((m) => <option key={m.username} value={m.username}>{m.username}</option>)}
        </select>
      </div>
      <div className="min-h-[12rem] rounded-xl bg-ink-900/60 px-4 py-2">
        {error && <div role="alert" className="text-sm text-danger">{error}</div>}
        {!error && !loading && entries.length === 0 && (
          <p className="py-8 text-center text-sm text-gray-400">Nothing logged yet{action || person ? ' for this filter' : ''}.</p>
        )}
        <ul className="divide-y divide-ink-500/30">
          {entries.map((e) => (
            <li key={e.id} className="py-2 text-sm text-gray-200">
              <div>{describeEntry(e)}</div>
              <div className="mt-0.5 text-xs text-gray-500">
                {formatDay(e.createdAt)} · {formatTime(e.createdAt)}
                {e.reason ? <> · Reason: {e.reason}</> : null}
              </div>
            </li>
          ))}
        </ul>
        {more && (
          <div className="py-3 text-center">
            <button
              onClick={() => load(entries[entries.length - 1].id)}
              disabled={loading}
              className="rounded-lg px-3 py-1.5 text-sm text-brand-hi hover:bg-ink-700 disabled:opacity-60"
            >
              {loading ? 'Loading…' : 'Load older'}
            </button>
          </div>
        )}
        {loading && !entries.length && <p className="py-8 text-center text-sm text-gray-400">Loading…</p>}
      </div>
    </div>
  );
}
