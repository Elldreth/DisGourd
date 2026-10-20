import { useRef, useState } from 'react';
import * as api from '../api.js';
import Modal from './Modal.jsx';

// Settings › My account › Change password (P6-02). The server checks the
// current password and signs out every other device; this one gets a fresh
// token, passed to `onChanged(token)`.
export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 200;

export default function ChangePasswordDialog({ onChanged, onClose }) {
  const currentRef = useRef(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (next.length < MIN_PASSWORD) return setError(`Your new password must be at least ${MIN_PASSWORD} characters.`);
    if (next !== confirm) return setError('The new passwords don’t match.');
    if (next === current) return setError('Your new password must be different from the current one.');
    setBusy(true);
    setError('');
    try {
      const res = await api.changePassword(current, next);
      onChanged?.(res.token);
      onClose();
    } catch (err) {
      setError(err.message || 'Could not change your password');
      setBusy(false);
    }
  }

  const field = (id, label, value, set, ref, autoComplete) => (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">
        {label}
      </label>
      <input
        id={id}
        ref={ref}
        type="password"
        value={value}
        onChange={(e) => set(e.target.value)}
        maxLength={MAX_PASSWORD}
        autoComplete={autoComplete}
        required
        className="input w-full"
      />
    </div>
  );

  return (
    <Modal onClose={onClose} initialFocusRef={currentRef} panelClassName="w-full max-w-md rounded-xl bg-ink-800 shadow-2xl ring-1 ring-ink-500/50">
      <form onSubmit={submit}>
        <div className="border-b border-ink-500/40 px-6 py-4">
          <Modal.Title>Change password</Modal.Title>
          <p className="mt-1 text-sm text-gray-400">Your other devices will be signed out.</p>
        </div>
        <div className="space-y-4 p-6">
          {field('pw-current', 'Current password', current, setCurrent, currentRef, 'current-password')}
          {field('pw-new', 'New password', next, setNext, null, 'new-password')}
          {field('pw-confirm', 'Confirm new password', confirm, setConfirm, null, 'new-password')}
          <p className="text-xs text-gray-500">At least {MIN_PASSWORD} characters.</p>
          {error && <div role="alert" className="text-sm text-danger">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-ink-500/40 px-6 py-3">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-gray-300 hover:text-fg">Cancel</button>
          <button type="submit" disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60">
            {busy ? 'Changing…' : 'Change password'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
