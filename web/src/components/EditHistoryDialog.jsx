import { useEffect, useRef, useState } from 'react';
import Modal from './Modal.jsx';
import { formatDay, formatTime } from '../util.js';

// "(edited)" → Edit history (P3-27): the text now, then each earlier version,
// newest first, with when it was written. `load()` resolves to
// { versions: [{ content, writtenAt }] (oldest first), current: { content,
// editedAt } }; `render(text)` draws text like a message. `version` changes
// when the message is edited again, which reloads it.
export default function EditHistoryDialog({ author, load, render, version, onClose }) {
  const bodyRef = useRef(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    load().then(
      (d) => live && setData(d),
      (err) => live && setError(err.message || 'Could not load the edit history')
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const when = (ts) => (ts ? `${formatDay(ts)} · ${formatTime(ts)}` : '');
  const earlier = data ? [...data.versions].reverse() : [];

  return (
    <Modal onClose={onClose} initialFocusRef={bodyRef} panelClassName="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl bg-ink-800 shadow-2xl ring-1 ring-ink-500/50">
      <div className="flex items-center justify-between border-b border-ink-500/40 px-6 py-4">
        <Modal.Title>Edit history{author ? ` — ${author}` : ''}</Modal.Title>
        <button onClick={onClose} className="text-sm text-gray-400 hover:text-fg">Close</button>
      </div>
      <div ref={bodyRef} tabIndex={-1} className="flex-1 overflow-y-auto px-6 py-3 outline-none">
        {error && <div role="alert" className="text-sm text-danger">{error}</div>}
        {!data && !error && <p className="py-6 text-center text-sm text-gray-400">Loading…</p>}
        {data && (
          <ol className="divide-y divide-ink-500/30">
            <li className="py-3">
              <div className="mb-1 text-xs text-gray-500">
                <span className="mr-1 rounded-sm bg-brand/20 px-1.5 py-0.5 font-semibold uppercase text-brand-hi">Now</span>
                {when(data.current.editedAt)}
              </div>
              <div className="whitespace-pre-wrap wrap-break-word text-sm text-gray-200">{render(data.current.content || '')}</div>
            </li>
            {earlier.map((v, i) => (
              <li key={i} className="py-3">
                <div className="mb-1 text-xs text-gray-500">
                  {i === earlier.length - 1 ? 'Original · ' : ''}
                  {when(v.writtenAt)}
                </div>
                <div className="whitespace-pre-wrap wrap-break-word text-sm text-gray-400">{render(v.content)}</div>
              </li>
            ))}
          </ol>
        )}
        {data && earlier.length === 0 && (
          <p className="pb-3 text-sm text-gray-400">Earlier versions weren’t kept for this message.</p>
        )}
      </div>
    </Modal>
  );
}
