import { useId, useRef, useState } from 'react';
import Modal from '../Modal.jsx';
import Avatar from '../Avatar.jsx';

// Server settings › Overview › Transfer ownership… (P9-02): pick a member and
// type the server's name to confirm. It happens at once; you become an Admin.
// `onTransfer(username, confirm)` resolves (or throws the server's message).
// P10-07: each candidate shows their avatar and top role (`roles`, highest
// first), since the person you'd pick usually has one.
export default function TransferDialog({ space, members = [], roles = [], currentUser, onTransfer, onClose }) {
  const topRole = (m) => roles.find((r) => !r.isDefault && (m.roles || []).includes(r.id))?.name || null;
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
            <div role="radiogroup" aria-label="New owner" className="mt-2 max-h-40 overflow-y-auto rounded-lg bg-ink-900/60 p-1">
              {candidates.map((m) => (
                <div key={m.username}>
                  <label className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm ${picked === m.username ? 'bg-brand/20 text-fg' : 'text-gray-200 hover:bg-ink-700'}`}>
                    <input type="radio" name={`${listId}-owner`} value={m.username} checked={picked === m.username} onChange={() => setPicked(m.username)} aria-label={topRole(m) ? `${m.username}, ${topRole(m)}` : m.username} className="accent-brand" />
                    <span aria-hidden="true"><Avatar name={m.username} src={m.avatar} size={24} /></span>
                    <span className="min-w-0 flex-1 truncate">{m.username}</span>
                    {topRole(m) && <span className="shrink-0 rounded bg-ink-600 px-1.5 py-0.5 text-[11px] font-semibold text-gray-300">{topRole(m)}</span>}
                  </label>
                </div>
              ))}
              {candidates.length === 0 && <p className="px-2 py-1.5 text-sm text-gray-500">No members match.</p>}
            </div>
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
