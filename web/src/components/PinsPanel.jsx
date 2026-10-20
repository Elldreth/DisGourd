import EmptyState from './EmptyState.jsx';
import { useEffect, useState } from 'react';
import * as api from '../api.js';
import SidePanel from './SidePanel.jsx';
import RoleName from './RoleName.jsx';
import Avatar from './Avatar.jsx';
import { formatDay, formatTime } from '../util.js';

// A short plain-text preview of a pinned message (no markdown markers).
function preview(m) {
  const text = String(m.content || '')
    .replace(/\|\|[\s\S]+?\|\|/g, 'Spoiler')
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text) return text.length > 200 ? `${text.slice(0, 199)}…` : text;
  return m.attachments?.length ? 'Attachment' : '';
}

// "Pinned messages" for the open channel, in a side column (P7-03). Clicking
// one jumps to it (loading the history around it if needed) and the list stays
// open, so you can go through several. `version` changes whenever this
// channel's pins change, so the list reloads.
export default function PinsPanel({ space, channel, version, canPin = false, onUnpin, onJump, onClose }) {
  const [pins, setPins] = useState(null); // null while loading
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    api
      .getPins(space, channel)
      .then((rows) => live && (setPins(rows), setError('')))
      .catch((err) => live && setError(err.message || 'Could not load pinned messages'));
    return () => {
      live = false;
    };
  }, [space, channel, version]);

  return (
    <SidePanel label="Pinned messages" icon="pin" title="Pinned messages" subtitle={`#${channel}`} backLabel={`Back to #${channel}`} onClose={onClose}>
      <div>
        {error && (
          <p role="alert" className="p-4 text-center text-sm text-danger">
            {error}
          </p>
        )}
        {!error && pins === null && <p className="p-4 text-center text-sm text-gray-500">Loading…</p>}
        {!error && pins?.length === 0 && (
          <EmptyState compact icon="pin" title={`No pinned messages in #${channel} yet`} body="Pin one from its menu." />
        )}
        {pins?.length > 0 && (
          <ul className="space-y-1">
            {pins.map((m) => (
              <li key={m.id} className="group flex items-start gap-2 rounded-lg p-2 hover:bg-ink-700/60">
                <button
                  type="button"
                  onClick={() => onJump(m.id)}
                  aria-label={`Jump to ${m.author || 'Unknown'}'s message: ${preview(m)}`}
                  className="flex min-w-0 flex-1 items-start gap-2 text-left"
                >
                  <Avatar name={m.author || '?'} size={28} src={m.authorAvatar} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <RoleName name={m.author} className="text-sm font-semibold text-gray-100">{m.author || 'Unknown'}</RoleName>
                      <span className="text-xs text-gray-500">
                        {formatDay(m.timestamp)} {formatTime(m.timestamp)}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-sm text-gray-300">{preview(m)}</span>
                  </span>
                </button>
                {canPin && (
                  <button
                    type="button"
                    onClick={() => onUnpin?.(m.id)}
                    aria-label={`Unpin ${m.author || 'Unknown'}'s message: ${preview(m)}`}
                    className="shrink-0 rounded-md px-2 py-1 text-xs text-gray-400 transition hover:bg-ink-600 hover:text-danger"
                  >
                    Unpin
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </SidePanel>
  );
}
