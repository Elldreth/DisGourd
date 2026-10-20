import { useEffect, useState } from 'react';
import * as api from '../../api.js';
import { formatDay, formatTime } from '../../util.js';
import TimeoutDialog from '../TimeoutDialog.jsx';
import BanDialog from '../BanDialog.jsx';
import { REPORT_REASONS } from '../ReportDialog.jsx';

// Server settings › Reports (P9-01): messages people flagged, for moderators
// ("Delete others' messages", or the owner). Open reports offer Delete message,
// Time out, Ban (each only when your rank allows), Mark handled and Dismiss;
// handled ones move to Closed and into the moderation log. `openCount` (from
// the server's live count) reloads the list when reports come or go.
const REASON = Object.fromEntries(REPORT_REASONS);
const RESOLUTION = { deleted: 'message deleted', timeout: 'timed out', ban: 'banned' };

export default function ReportsSection({ space, members = [], myPosition = 0, isOwner = false, abilities = [], openCount = 0, onJump }) {
  const [tab, setTab] = useState('open');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [acting, setActing] = useState(null); // { kind: 'timeout' | 'ban', report }

  async function load() {
    setError('');
    try {
      setData(await api.getReports(space, { status: tab }));
    } catch (err) {
      setError(err.message || 'Could not load the reports');
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [space, tab, openCount]);

  // What I may do to a report's author: they sit strictly below me (people
  // who left sit below everyone).
  const below = (r) => {
    const m = members.find((x) => x.username === r.author);
    return (m ? m.position ?? 0 : -1) < myPosition;
  };
  const isMember = (r) => members.some((x) => x.username === r.author);
  const can = (perm) => isOwner || abilities.includes(perm);

  async function resolve(r, action, resolution) {
    setError('');
    try {
      await api.resolveReport(space, r.id, { action, resolution });
      await load();
    } catch (err) {
      setError(err.message || 'Could not update the report');
    }
  }

  const reports = data?.reports || [];
  const tabClass = (on) => `rounded-lg px-3 py-1.5 text-sm ${on ? 'bg-ink-600 text-fg' : 'text-gray-400 hover:text-fg'}`;
  const btn = 'rounded-lg px-2.5 py-1 text-xs ring-1 ring-ink-500 text-gray-200 hover:bg-ink-700';

  return (
    <div>
      <p className="mb-3 text-sm text-gray-400">Messages people reported here. Handling one closes every report on that message and adds it to the moderation log.</p>
      <div role="group" aria-label="Show" className="mb-3 flex gap-1">
        <button aria-pressed={tab === 'open'} className={tabClass(tab === 'open')} onClick={() => setTab('open')}>
          Open{openCount ? ` (${openCount})` : ''}
        </button>
        <button aria-pressed={tab === 'closed'} className={tabClass(tab === 'closed')} onClick={() => setTab('closed')}>
          Closed
        </button>
      </div>
      <div className="rounded-xl bg-ink-900/60 px-4 py-2">
        {error && <div role="alert" className="my-2 text-sm text-danger">{error}</div>}
        {!data && !error && <p className="py-6 text-center text-sm text-gray-400">Loading…</p>}
        {data && reports.length === 0 && (
          <p className="py-6 text-center text-sm text-gray-400">{tab === 'open' ? 'No open reports. All quiet.' : 'No closed reports yet.'}</p>
        )}
        <ul className="divide-y divide-ink-500/30">
          {reports.map((r) => (
            <li key={r.id} className="py-3 text-sm">
              <div className="text-xs text-gray-500">
                <span className="font-semibold text-gray-200">{r.author || 'someone'}</span> in #{r.thread ? `${r.thread.parentChannel} › ${r.thread.name}` : r.channel} ·{' '}
                {formatDay(r.createdAt)} {formatTime(r.createdAt)}
              </div>
              <blockquote className={`my-1 border-l-2 border-ink-500 pl-2 ${r.messageExists ? 'text-gray-200' : 'italic text-gray-500'}`}>
                {r.excerpt || '(no text)'}
                {!r.messageExists && <span className="ml-1 not-italic text-gray-500">· This message was deleted</span>}
              </blockquote>
              <div className="text-xs text-gray-400">
                <span className="rounded-sm bg-danger/15 px-1.5 py-0.5 font-semibold text-danger">{REASON[r.reason] || r.reason}</span>{' '}
                reported by <span className="text-gray-200">{r.reporter || 'someone'}</span>
                {r.note ? <> · “{r.note}”</> : null}
              </div>
              {r.status !== 'open' && (
                <div className="mt-1 text-xs text-gray-500">
                  {r.status === 'dismissed' ? 'Dismissed' : `Handled${r.resolution ? ` (${RESOLUTION[r.resolution] || r.resolution})` : ''}`} by {r.resolvedBy || 'a moderator'}
                </div>
              )}
              {r.status === 'open' && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {r.messageExists && onJump && <button className={btn} onClick={() => onJump(r)}>Jump to message</button>}
                  {r.messageExists && below(r) && <button className={btn} onClick={() => resolve(r, 'delete')}>Delete message</button>}
                  {isMember(r) && below(r) && can('timeout_members') && <button className={btn} onClick={() => setActing({ kind: 'timeout', report: r })}>Time out…</button>}
                  {isMember(r) && below(r) && can('ban_members') && <button className={btn} onClick={() => setActing({ kind: 'ban', report: r })}>Ban…</button>}
                  <button className={btn} onClick={() => resolve(r, 'resolved')}>Mark handled</button>
                  <button className={`${btn} text-gray-400`} onClick={() => resolve(r, 'dismiss')}>Dismiss</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
      {acting?.kind === 'timeout' && (
        <TimeoutDialog
          username={acting.report.author}
          space={space}
          onTimeout={async (options) => {
            await api.timeoutMember(space, acting.report.author, options);
            await resolve(acting.report, 'resolved', 'timeout');
          }}
          onClose={() => setActing(null)}
        />
      )}
      {acting?.kind === 'ban' && (
        <BanDialog
          username={acting.report.author}
          space={space}
          onBan={async (options) => {
            await api.banMember(space, acting.report.author, options);
            await resolve(acting.report, 'resolved', 'ban');
          }}
          onClose={() => setActing(null)}
        />
      )}
    </div>
  );
}
