import { useRef, useState } from 'react';
import Modal from './Modal.jsx';

// Member list → Time out… (P3-26c): how long, and an optional reason.
// `onTimeout({ minutes, reason })` resolves when done.
export const TIMEOUT_CHOICES = [
  [5, '5 minutes'],
  [60, '1 hour'],
  [1440, '1 day'],
  [10080, '1 week'],
];

export default function TimeoutDialog({ username, space, onTimeout, onClose }) {
  const firstRef = useRef(null);
  const [minutes, setMinutes] = useState(60);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onTimeout({ minutes, reason: reason.trim() });
      onClose();
    } catch (err) {
      setError(err.message || 'Could not time them out');
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} initialFocusRef={firstRef} panelClassName="w-full max-w-md rounded-xl bg-ink-800 shadow-2xl ring-1 ring-ink-500/50">
      <form onSubmit={submit}>
        <div className="border-b border-ink-500/40 px-6 py-4">
          <Modal.Title>Time out @{username} in {space}?</Modal.Title>
          <p className="mt-1 text-sm text-gray-400">They can still read and listen, but can’t post, react, start threads, use /imagine or speak. It ends by itself.</p>
        </div>
        <div className="space-y-4 p-6">
          <fieldset>
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">For</legend>
            <div className="flex flex-wrap gap-2">
              {TIMEOUT_CHOICES.map(([value, label], i) => (
                <label
                  key={value}
                  className={`cursor-pointer rounded-lg px-3 py-1.5 text-sm ring-1 ${minutes === value ? 'bg-brand/20 text-brand-hi ring-brand' : 'text-gray-300 ring-ink-500 hover:bg-ink-700'}`}
                >
                  <input
                    ref={i === 0 ? firstRef : undefined}
                    type="radio"
                    name="timeout-minutes"
                    value={value}
                    checked={minutes === value}
                    onChange={() => setMinutes(value)}
                    className="sr-only"
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor="timeout-reason" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">
              Reason (optional)
            </label>
            <textarea
              id="timeout-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              rows={2}
              className="input w-full resize-none"
              placeholder="They’ll see this"
            />
          </div>
          {error && <div role="alert" className="text-sm text-danger">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-ink-500/40 px-6 py-3">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-gray-300 hover:text-fg">Cancel</button>
          <button type="submit" disabled={busy} className="rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60">
            {busy ? 'Timing out…' : 'Time out'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
