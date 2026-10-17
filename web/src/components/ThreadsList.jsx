import { useEffect, useState } from 'react';
import * as api from '../api.js';
import Modal from './Modal.jsx';
import Icon from './Icon.jsx';
import { formatAgo } from '../util.js';

const replyCount = (n) => (!n ? 'No replies yet' : n === 1 ? '1 reply' : `${n} replies`);

// The open channel's threads, most recently active first, with a toggle for
// archived ones. Clicking one closes this and opens it. `version` changes
// whenever this channel's threads change, so the list reloads.
// `badge(channel)` (optional) gives a thread's { unread, mentions }.
export default function ThreadsList({ space, channel, version, badge, onOpen, onClose }) {
  const [archived, setArchived] = useState(false);
  const [threads, setThreads] = useState(null); // null while loading
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    api
      .getThreads(space, channel, archived)
      .then((rows) => live && (setThreads(rows), setError('')))
      .catch((err) => live && setError(err.message || 'Could not load threads'));
    return () => {
      live = false;
    };
  }, [space, channel, archived, version]);

  return (
    <Modal
      onClose={onClose}
      label="Threads"
      backdropClassName="flex items-start justify-center bg-black/50 p-4 pt-20"
      panelClassName="flex max-h-[70vh] w-full max-w-lg flex-col rounded-xl bg-ink-800 shadow-2xl ring-1 ring-ink-500/50"
    >
      <div className="flex items-center gap-3 border-b border-ink-500/40 px-4 py-3">
        <h2 className="font-semibold">
          Threads <span className="font-normal text-gray-500">in #{channel}</span>
        </h2>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setArchived((a) => !a)}
          aria-pressed={archived}
          className={`rounded-md px-2 py-1 text-xs ring-1 transition ${
            archived ? 'bg-brand/20 text-fg ring-brand-hi' : 'text-gray-400 ring-ink-500/60 hover:text-fg'
          }`}
        >
          Archived
        </button>
        <button type="button" onClick={onClose} className="rounded-sm px-2 text-sm text-gray-400 hover:text-fg">
          Close
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {error && (
          <p role="alert" className="p-4 text-center text-sm text-danger">
            {error}
          </p>
        )}
        {!error && threads === null && <p className="p-4 text-center text-sm text-gray-500">Loading…</p>}
        {!error && threads?.length === 0 && (
          <p className="p-6 text-center text-sm text-gray-500">
            {archived ? `No archived threads in #${channel}.` : `No threads in #${channel} yet. Start one from a message’s menu.`}
          </p>
        )}
        {threads?.length > 0 && (
          <ul className="space-y-1">
            {threads.map((t) => {
              const b = badge?.(t.channel) || {};
              const state = b.mentions ? `, ${b.mentions === 1 ? '1 mention' : `${b.mentions} mentions`}` : b.unread ? ', unread' : '';
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpen(t);
                    }}
                    aria-label={`Open thread ${t.name}, ${replyCount(t.messageCount)}${state}${t.followed ? ', following' : ''}`}
                    className="flex w-full items-start gap-3 rounded-lg p-2 text-left hover:bg-ink-700/60"
                  >
                    <Icon name="thread" size={18} className="mt-0.5 shrink-0 text-brand-hi" />
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm ${b.unread || b.mentions ? 'font-bold text-fg' : 'font-semibold text-gray-100'}`}>{t.name}</span>
                      <span className="mt-0.5 block text-xs text-gray-400">
                        {replyCount(t.messageCount)}
                        {t.messageCount > 0 && ` · last ${formatAgo(t.lastActivityAt)}`}
                        {t.createdBy && ` · started by ${t.createdBy}`}
                        {t.followed && ' · following'}
                        {t.archived && ' · archived'}
                      </span>
                    </span>
                    {b.mentions > 0 ? (
                      <span aria-hidden="true" className="mt-1 shrink-0 rounded-full bg-pink px-1.5 text-[10px] font-bold leading-4 text-ink-900">{b.mentions}</span>
                    ) : b.unread > 0 ? (
                      <span aria-hidden="true" className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand-hi" />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
