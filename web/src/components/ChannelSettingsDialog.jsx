import { useState } from 'react';
import * as api from '../api.js';
import Icon from './Icon.jsx';

const LEVELS = [
  { v: 1, label: 'Everyone' },
  { v: 2, label: 'Admins & owner' },
  { v: 3, label: 'Owner only' },
];

// Owner/admin panel: who can see and who can post in a single channel.
export default function ChannelSettingsDialog({ space, channel, meta, onClose, onSaved }) {
  const [view, setView] = useState(meta?.view ?? 1);
  const [post, setPost] = useState(meta?.post ?? 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // You can't post somewhere you can't see, so keep post >= view.
  function chooseView(v) {
    setView(v);
    if (post < v) setPost(v);
  }

  async function save() {
    setBusy(true);
    setError('');
    try {
      await api.setChannelPermissions(space, channel, view, Math.max(view, post));
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message || 'Could not save channel settings');
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError('');
    try {
      await api.deleteChannel(space, channel);
      onSaved(); // refresh the sidebar now; the gateway also switches you off it
      onClose();
    } catch (err) {
      setError(err.message || 'Could not delete the channel');
      setBusy(false);
    }
  }

  return (
    <div className="anim-fade absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="anim-scale-in w-full max-w-sm rounded-xl bg-ink-800 shadow-2xl ring-1 ring-ink-500/50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink-500/40 px-6 py-4">
          <h3 className="text-lg font-bold">#{channel} access</h3>
          <button onClick={onClose} className="text-sm text-gray-400 hover:text-white">Close</button>
        </div>

        <div className="space-y-4 p-6">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">Who can see this channel</span>
            <select value={view} onChange={(e) => chooseView(parseInt(e.target.value, 10))} className="input">
              {LEVELS.map((l) => <option key={l.v} value={l.v}>{l.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">Who can post</span>
            <select value={Math.max(view, post)} onChange={(e) => setPost(parseInt(e.target.value, 10))} className="input">
              {LEVELS.filter((l) => l.v >= view).map((l) => <option key={l.v} value={l.v}>{l.label}</option>)}
            </select>
            <span className="mt-1 block text-xs text-gray-500">
              Set posting higher than viewing for a read-only / announcements channel.
            </span>
          </label>
          {error && <div className="text-sm text-danger">{error}</div>}
        </div>

        <div className="border-t border-ink-500/40 px-6 py-4">
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-2 text-sm font-medium text-danger transition hover:underline"
            >
              <Icon name="trash" size={15} /> Delete channel
            </button>
          ) : (
            <div className="rounded-lg bg-danger/10 p-3 ring-1 ring-danger/30">
              <p className="text-sm text-gray-200">
                Delete <span className="font-semibold">#{channel}</span>? This permanently removes the
                channel and every message in it. This can’t be undone.
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  onClick={() => setConfirmDelete(false)}
                  disabled={busy}
                  className="rounded-lg px-3 py-1.5 text-sm text-gray-300 transition hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={remove}
                  disabled={busy}
                  className="rounded-lg bg-danger px-3 py-1.5 text-sm font-semibold text-white transition hover:brightness-110 active:scale-95 disabled:opacity-60 disabled:active:scale-100"
                >
                  {busy ? 'Deleting…' : 'Delete channel'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-ink-500/40 px-6 py-3">
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-gray-300 hover:text-white">Cancel</button>
          <button
            onClick={save}
            disabled={busy}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
