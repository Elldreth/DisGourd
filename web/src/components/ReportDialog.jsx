import { useRef, useState } from 'react';
import Modal from './Modal.jsx';

// Message menu → Report… (P9-01): flag a message for the server's moderators,
// with a reason and an optional note. `onReport({ reason, note })` resolves
// (or throws with the server's message). The person reported never sees who
// reported them; moderators do.
export const REPORT_REASONS = [
  ['spam', 'Spam'],
  ['harassment', 'Harassment'],
  ['inappropriate', 'Inappropriate'],
  ['other', 'Something else'],
];

export default function ReportDialog({ author, onReport, onClose }) {
  const firstRef = useRef(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!reason) return;
    setBusy(true);
    setError('');
    try {
      await onReport({ reason, note: note.trim() });
      setDone(true);
    } catch (err) {
      setError(err.message || 'Could not send the report');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} initialFocusRef={firstRef} panelClassName="w-full max-w-md rounded-xl bg-ink-800 shadow-2xl ring-1 ring-ink-500/50">
      {done ? (
        <div className="p-6">
          <Modal.Title>Report sent</Modal.Title>
          <p role="status" className="mt-2 text-sm text-gray-300">Thanks — the moderators will take a look.</p>
          <div className="mt-5 flex justify-end">
            <button ref={firstRef} onClick={onClose} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover">
              Close
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit}>
          <div className="border-b border-ink-500/40 px-6 py-4">
            <Modal.Title>Report @{author}’s message?</Modal.Title>
            <p className="mt-1 text-sm text-gray-400">The server’s moderators will see it, and who sent the report. @{author} won’t.</p>
          </div>
          <div className="space-y-4 p-6">
            <fieldset>
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Why?</legend>
              <div className="flex flex-wrap gap-2">
                {REPORT_REASONS.map(([value, label], i) => (
                  <label
                    key={value}
                    className={`cursor-pointer rounded-lg px-3 py-1.5 text-sm ring-1 ${reason === value ? 'bg-brand/20 text-brand-hi ring-brand' : 'text-gray-300 ring-ink-500 hover:bg-ink-700'}`}
                  >
                    <input
                      ref={i === 0 ? firstRef : undefined}
                      type="radio"
                      name="report-reason"
                      value={value}
                      checked={reason === value}
                      onChange={() => setReason(value)}
                      className="sr-only"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div>
              <label htmlFor="report-note" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">
                Anything to add? (optional)
              </label>
              <textarea id="report-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} className="input w-full resize-none" />
            </div>
            {error && <div role="alert" className="text-sm text-danger">{error}</div>}
          </div>
          <div className="flex justify-end gap-2 border-t border-ink-500/40 px-6 py-3">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-gray-300 hover:text-fg">Cancel</button>
            <button type="submit" disabled={busy || !reason} className="rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
              {busy ? 'Sending…' : 'Report'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
