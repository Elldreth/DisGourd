import { useRef, useState } from 'react';
import * as api from '../api.js';
import { PERMISSION_ACTIONS } from '../util.js';
import Modal from './Modal.jsx';

const LEVELS = [
  { v: 1, label: 'Everyone' },
  { v: 2, label: 'Admins & owner' },
  { v: 3, label: 'Owner only' },
];

// Owner-only panel: set the minimum role required for each server action.
export default function ServerPermissionsDialog({ space, permissions, onClose, onSaved }) {
  const bodyRef = useRef(null); // focus starts on the first setting, not the header's Close
  const [draft, setDraft] = useState({ ...permissions });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function setLevel(key, v) {
    setDraft((d) => ({ ...d, [key]: v }));
  }

  async function save() {
    setBusy(true);
    setError('');
    try {
      await api.setServerPermissions(space, draft);
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message || 'Could not save permissions');
      setBusy(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      initialFocusRef={bodyRef}
      panelClassName="flex max-h-[85vh] w-full max-w-md flex-col rounded-xl bg-ink-800 shadow-2xl ring-1 ring-ink-500/50"
    >
      <div className="flex items-center justify-between border-b border-ink-500/40 px-6 py-4">
        <Modal.Title>Server permissions — {space}</Modal.Title>
        <button onClick={onClose} className="text-sm text-gray-400 hover:text-fg">Close</button>
      </div>

      <div ref={bodyRef} className="overflow-y-auto p-6">
        <p className="mb-4 text-sm text-gray-400">
          Choose the minimum role allowed to do each action. The owner can always do everything.
        </p>
        <div className="space-y-2">
          {PERMISSION_ACTIONS.map((a) => {
            const locked = a.key === 'manage_roles'; // stays owner-only
            return (
              <label key={a.key} className="flex items-center justify-between gap-3">
                <span className="text-sm text-gray-200">{a.label}</span>
                <select
                  value={draft[a.key] ?? 1}
                  disabled={locked}
                  onChange={(e) => setLevel(a.key, parseInt(e.target.value, 10))}
                  className="input w-40 disabled:opacity-60"
                >
                  {LEVELS.map((l) => (
                    <option key={l.v} value={l.v}>{l.label}</option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
        {error && <div className="mt-3 text-sm text-danger">{error}</div>}
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
