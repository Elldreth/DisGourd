import { useRef, useState } from 'react';
import * as api from '../api.js';
import Modal from './Modal.jsx';

// Server menu → Image generation (P2-20d), for people who may edit the
// server: allow /imagine here and set a daily limit per person (blank = the
// instance's default; the server caps it at the instance ceiling). `info` is
// the server's `imagine` from GET /spaces.
export default function ServerImagineDialog({ space, info, onClose, onSaved }) {
  const bodyRef = useRef(null);
  const [enabled, setEnabled] = useState(!!info?.serverEnabled);
  const [limit, setLimit] = useState(info?.ownLimit == null ? '' : String(info.ownLimit));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const noEngine = !info?.engines?.length;

  async function save() {
    setBusy(true);
    setError('');
    try {
      await api.setServerImagine(space, { enabled, dailyLimit: limit === '' ? null : parseInt(limit, 10) });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message || 'Could not save');
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} initialFocusRef={bodyRef} panelClassName="w-full max-w-md rounded-xl bg-ink-800 shadow-2xl ring-1 ring-ink-500/50">
      <div className="flex items-center justify-between border-b border-ink-500/40 px-6 py-4">
        <Modal.Title>Image generation — {space}</Modal.Title>
        <button onClick={onClose} className="text-sm text-gray-400 hover:text-fg">Close</button>
      </div>
      <div ref={bodyRef} className="space-y-4 p-6">
        <label className="flex items-start gap-2 text-sm text-gray-200">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand" />
          <span>
            Allow <code className="text-brand-hi">/imagine</code> in this server
          </span>
        </label>
        {noEngine && (
          <p className="rounded-lg bg-ink-700/60 px-3 py-2 text-sm text-gray-300">
            No image engine is set up on this instance yet. A site admin sets one up in Settings → Image generation.
          </p>
        )}
        <div>
          <label htmlFor="server-imagine-limit" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">
            Images per person per day
          </label>
          <input
            id="server-imagine-limit"
            type="number"
            min={1}
            value={limit}
            onChange={(e) => setLimit(e.target.value.replace(/\D/g, ''))}
            placeholder={`Instance default (${info?.dailyLimit ?? '—'})`}
            className="input w-48"
          />
          <p className="mt-1 text-xs text-gray-500">Leave blank to use the instance’s default.</p>
        </div>
        <p className="text-sm text-gray-400">
          Who may use it: give roles the <span className="font-semibold text-gray-200">Generate images</span> permission on the Roles screen.
          Channels marked 18+ (in channel settings) may allow unfiltered images, if the instance allows it.
        </p>
        {error && <div role="alert" className="text-sm text-danger">{error}</div>}
      </div>
      <div className="flex justify-end gap-2 border-t border-ink-500/40 px-6 py-3">
        <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-gray-300 hover:text-fg">Cancel</button>
        <button
          onClick={save}
          disabled={busy}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}
