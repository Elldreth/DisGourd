import { useRef, useState } from 'react';
import Modal from './Modal.jsx';

// Member list → Ban… (P3-26b): a reason (optional) and how far back to delete
// their messages. `onBan({ reason, deleteMessages })` resolves when done.
export const DELETE_WINDOWS = [
  ['none', "Don't delete any"],
  ['hour', 'The last hour'],
  ['day', 'The last day'],
  ['week', 'The last week'],
];

export default function BanDialog({ username, space, onBan, onClose }) {
  const reasonRef = useRef(null);
  const [reason, setReason] = useState('');
  const [window_, setWindow] = useState('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function ban(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onBan({ reason: reason.trim(), deleteMessages: window_ });
      onClose();
    } catch (err) {
      setError(err.message || 'Could not ban');
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} initialFocusRef={reasonRef} panelClassName="w-full max-w-md rounded-xl bg-ink-800 shadow-2xl ring-1 ring-ink-500/50">
      <form onSubmit={ban}>
        <div className="border-b border-ink-500/40 px-6 py-4">
          <Modal.Title>Ban @{username} from {space}?</Modal.Title>
          <p className="mt-1 text-sm text-gray-400">They’re removed, and no invite will let them back in until they’re unbanned.</p>
        </div>
        <div className="space-y-4 p-6">
          <div>
            <label htmlFor="ban-reason" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">
              Reason (optional)
            </label>
            <textarea
              id="ban-reason"
              ref={reasonRef}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              rows={2}
              className="input w-full resize-none"
              placeholder="They’ll see this"
            />
          </div>
          <div>
            <label htmlFor="ban-delete" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">
              Delete their messages from
            </label>
            <select id="ban-delete" value={window_} onChange={(e) => setWindow(e.target.value)} className="input w-auto">
              {DELETE_WINDOWS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          {error && <div role="alert" className="text-sm text-danger">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-ink-500/40 px-6 py-3">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-gray-300 hover:text-fg">Cancel</button>
          <button type="submit" disabled={busy} className="rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60">
            {busy ? 'Banning…' : 'Ban'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
