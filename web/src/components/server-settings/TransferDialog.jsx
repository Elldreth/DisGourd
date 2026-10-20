import { useId, useRef, useState } from 'react';
import Modal from '../Modal.jsx';

// Server settings › Overview › Transfer ownership… (P9-02): pick a member and
// type the server's name to confirm. It happens at once; you become an Admin.
// `onTransfer(username, confirm)` resolves (or throws the server's message).
export default function TransferDialog({ space, members = [], currentUser, onTransfer, onClose }) {
  const searchRef = useRef(null);
  const listId = useId();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const candidates = members
    .filter((m) => m.username !== currentUser && !m.bot)
    .filter((m) => m.username.toLowerCase().includes(query.trim().toLowerCase()));
  const ready = !!picked && confirm === space;

  async function submit(e) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError('');
    try {
      await onTransfer(picked, confirm);
    } catch (err) {
      setError(err.message || 'Could not hand the server over');
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} initialFocusRef={searchRef} panelClassName="w-full max-w-md rounded-xl bg-ink-800 shadow-2xl ring-1 ring-ink-500/50">
      <form onSubmit={submit}>
        <div className="border-b border-ink-500/40 px-6 py-4">
          <Modal.Title>Transfer ownership of {space}</Modal.Title>
          <p className="mt-1 text-sm text-gray-400">
            The new owner gets everything you can do now, and it happens at once. You’ll become an Admin, and only the new owner can hand it back.
          </p>
        </div>
        <div className="space-y-4 p-6">
          <div>
            <label htmlFor={`${listId}-search`} className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">
              New owner
            </label>
            <input
              id={`${listId}-search`}
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search members"
              className="input w-full"
              autoComplete="off"
            />
            <ul role="radiogroup" aria-label="New owner" className="mt-2 max-h-40 overflow-y-auto rounded-lg bg-ink-900/60 p-1">
              {candidates.map((m) => (
                <li key={m.username}>
                  <label className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm ${picked === m.username ? 'bg-brand/20 text-fg' : 'text-gray-200 hover:bg-ink-700'}`}>
                    <input type="radio" name={`${listId}-owner`} value={m.username} checked={picked === m.username} onChange={() => setPicked(m.username)} className="accent-brand" />
                    {m.username}
                  </label>
                </li>
              ))}
              {candidates.length === 0 && <li className="px-2 py-1.5 text-sm text-gray-500">No members match.</li>}
            </ul>
          </div>
          <div>
            <label htmlFor={`${listId}-confirm`} className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">
              Type <span className="normal-case text-gray-200">{space}</span> to confirm
            </label>
            <input id={`${listId}-confirm`} value={confirm} onChange={(e) => setConfirm(e.target.value)} className="input w-full" autoComplete="off" />
          </div>
          {error && <div role="alert" className="text-sm text-danger">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-ink-500/40 px-6 py-3">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-gray-300 hover:text-fg">Cancel</button>
          <button type="submit" disabled={!ready || busy} className="rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {busy ? 'Transferring…' : picked ? `Transfer to ${picked}` : 'Transfer'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
