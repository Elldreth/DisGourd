import { useEffect, useState } from 'react';
import * as api from '../../api.js';
import { formatDay, formatTime } from '../../util.js';
import TimeoutDialog from '../TimeoutDialog.jsx';
import BanDialog from '../BanDialog.jsx';
import EmptyState from '../EmptyState.jsx';
import Icon from '../Icon.jsx';
import { ActionMenu } from '../MessageActions.jsx';
import { REPORT_REASONS } from '../ReportDialog.jsx';

// Server settings › Reports (P9-01): messages people flagged, for moderators
// ("Delete others' messages", or the owner). Handled ones move to Closed and
// into the moderation log. `openCount` (from the server's live count) reloads
// the list when reports come or go.
//
// P10-01: one card per message, however many people reported it (handling a
// message closes all its reports anyway). The quote opens the message;
// **Mark handled** is the main action and Dismiss a quiet one; Delete
// message, Time out… and Ban… sit in one "Act on <name>" menu, each only
// when your rank allows.
const REASON = Object.fromEntries(REPORT_REASONS);
const RESOLUTION = { deleted: 'message deleted', timeout: 'timed out', ban: 'banned' };

// Reports grouped by message, newest first. A deleted message's reports
// (no messageId any more) group by author and excerpt.
export function groupReports(reports) {
  const groups = new Map();
  for (const r of reports) {
    const key = r.messageId != null ? `m:${r.messageId}` : `x:${r.authorId ?? r.author}:${r.excerpt}`;
    if (!groups.has(key)) groups.set(key, { key, main: r, reports: [] });
    groups.get(key).reports.push(r);
  }
  return [...groups.values()];
}

// "Spam ×2, Harassment": each reason once, with a count when repeated.
function reasonCounts(reports) {
  const counts = new Map();
  for (const r of reports) counts.set(r.reason, (counts.get(r.reason) || 0) + 1);
  return [...counts];
}

export default function ReportsSection({ space, members = [], myPosition = 0, isOwner = false, abilities = [], openCount = 0, onJump }) {
  const [tab, setTab] = useState('open');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [acting, setActing] = useState(null); // { kind: 'timeout' | 'ban', group }
  const [menuFor, setMenuFor] = useState(null); // { key, above } of the open "Act on" menu

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

  // Closing one report closes every open report on its message; a deleted
  // message's reports have no message to share, so each is closed.
  async function resolve(group, action, resolution) {
    setError('');
    try {
      const ids = group.main.messageId != null ? [group.main.id] : group.reports.map((r) => r.id);
      for (const id of ids) await api.resolveReport(space, id, { action, resolution });
      await load();
    } catch (err) {
      setError(err.message || 'Could not update the report');
    }
  }

  const groups = groupReports(data?.reports || []);
  const tabClass = (on) => `rounded-lg px-3 py-1.5 text-sm ${on ? 'bg-ink-600 text-fg' : 'text-gray-400 hover:text-fg'}`;

  function moderation(g) {
    const r = g.main;
    return [
      r.messageExists && below(r) && { id: 'delete', label: 'Delete message', icon: 'trash', danger: true, onSelect: () => (setMenuFor(null), resolve(g, 'delete')) },
      isMember(r) && below(r) && can('timeout_members') && { id: 'timeout', label: 'Time out…', icon: 'clock', danger: true, onSelect: () => (setMenuFor(null), setActing({ kind: 'timeout', group: g })) },
      isMember(r) && below(r) && can('ban_members') && { id: 'ban', label: 'Ban…', icon: 'ban', danger: true, onSelect: () => (setMenuFor(null), setActing({ kind: 'ban', group: g })) },
    ].filter(Boolean);
  }

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
      {error && <div role="alert" className="mb-2 text-sm text-danger">{error}</div>}
      {!data && !error && <p className="py-6 text-center text-sm text-gray-400">Loading…</p>}
      {data && groups.length === 0 && (
        tab === 'open' ? (
          <EmptyState art="clear" compact title="No open reports. All quiet." body="Nothing to look at. Nice." className="rounded-xl bg-ink-900/60" />
        ) : (
          <p className="rounded-xl bg-ink-900/60 py-6 text-center text-sm text-gray-400">No closed reports yet.</p>
        )
      )}
      {groups.length > 0 && (
        <ul className="divide-y divide-ink-500/30 rounded-xl bg-ink-900/60 px-4">
          {groups.map((g) => {
            const r = g.main;
            const where = `#${r.thread ? `${r.thread.parentChannel} › ${r.thread.name}` : r.channel}`;
            const quote = (
              <>
                {r.excerpt || '(no text)'}
                {!r.messageExists && <span className="ml-1 not-italic text-gray-500">· This message was deleted</span>}
              </>
            );
            const actions = r.status === 'open' ? moderation(g) : [];
            return (
              <li key={g.key} className="py-3 text-sm">
                <div className="text-xs text-gray-500">
                  <span className="font-semibold text-gray-200">{r.author || 'someone'}</span> in {where} · {formatDay(r.createdAt)} {formatTime(r.createdAt)}
                </div>
                {r.messageExists && onJump ? (
                  <button
                    type="button"
                    onClick={() => onJump(r)}
                    title="Open the message"
                    aria-label={`Open the message: ${r.excerpt || 'no text'}`}
                    className="my-1 block w-full rounded-sm border-l-2 border-ink-500 pl-2 text-left text-gray-200 hover:border-brand hover:bg-ink-700/40"
                  >
                    {quote}
                  </button>
                ) : (
                  <blockquote className={`my-1 border-l-2 border-ink-500 pl-2 ${r.messageExists ? 'text-gray-200' : 'italic text-gray-500'}`}>{quote}</blockquote>
                )}
                <div className="flex flex-wrap items-center gap-1 text-xs text-gray-400">
                  {reasonCounts(g.reports).map(([reason, n]) => (
                    <span key={reason} className="rounded-sm bg-danger/15 px-1.5 py-0.5 font-semibold text-danger">
                      {REASON[reason] || reason}
                      {n > 1 ? ` ×${n}` : ''}
                    </span>
                  ))}
                  <span>
                    reported by{' '}
                    {g.reports.map((x, i) => (
                      <span key={x.id}>
                        {i > 0 ? (i === g.reports.length - 1 ? ' and ' : ', ') : ''}
                        <span className="text-gray-200">{x.reporter || 'someone'}</span>
                        {x.note ? <> (“{x.note}”)</> : null}
                      </span>
                    ))}
                  </span>
                </div>
                {r.status !== 'open' && (
                  <div className="mt-1 text-xs text-gray-500">
                    {r.status === 'dismissed' ? 'Dismissed' : `Handled${r.resolution ? ` (${RESOLUTION[r.resolution] || r.resolution})` : ''}`} by {r.resolvedBy || 'a moderator'}
                  </div>
                )}
                {r.status === 'open' && (
                  <div className="relative mt-2 flex items-center gap-2">
                    <button type="button" onClick={() => resolve(g, 'resolved')} className="rounded-lg bg-brand px-3 py-1 text-xs font-semibold text-white hover:bg-brand-hover">
                      Mark handled
                    </button>
                    <button type="button" onClick={() => resolve(g, 'dismiss')} className="rounded-lg px-2 py-1 text-xs text-gray-400 hover:text-fg">
                      Dismiss
                    </button>
                    {actions.length > 0 && (
                      <button
                        type="button"
                        aria-haspopup="menu"
                        aria-expanded={menuFor?.key === g.key}
                        onClick={(e) => {
                          const box = e.currentTarget.getBoundingClientRect();
                          setMenuFor(menuFor?.key === g.key ? null : { key: g.key, above: box.bottom > window.innerHeight * 0.6 });
                        }}
                        className="ml-auto flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs text-danger ring-1 ring-danger/40 hover:bg-danger/10"
                      >
                        Act on {r.author}
                        <Icon name="chevronDown" size={14} />
                      </button>
                    )}
                    {menuFor?.key === g.key && (
                      <ActionMenu actions={actions} above={menuFor.above} label={`Act on ${r.author}`} onClose={() => setMenuFor(null)} />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {acting?.kind === 'timeout' && (
        <TimeoutDialog
          username={acting.group.main.author}
          space={space}
          onTimeout={async (options) => {
            await api.timeoutMember(space, acting.group.main.author, options);
            await resolve(acting.group, 'resolved', 'timeout');
          }}
          onClose={() => setActing(null)}
        />
      )}
      {acting?.kind === 'ban' && (
        <BanDialog
          username={acting.group.main.author}
          space={space}
          onBan={async (options) => {
            await api.banMember(space, acting.group.main.author, options);
            await resolve(acting.group, 'resolved', 'ban');
          }}
          onClose={() => setActing(null)}
        />
      )}
    </div>
  );
}
