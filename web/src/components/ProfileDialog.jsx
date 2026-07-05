import { useState } from 'react';
import * as api from '../api.js';
import Avatar from './Avatar.jsx';

// Lets the user view their account and upload/remove an avatar image.
export default function ProfileDialog({ profile, onClose, onUpdated }) {
  const [avatar, setAvatar] = useState(profile?.avatar || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function pickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const up = await api.uploadFile(file);
      const updated = await api.updateMe({ avatar: up.url });
      setAvatar(updated.avatar);
      onUpdated(updated);
    } catch (err) {
      setError(err.message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function removeAvatar() {
    setBusy(true);
    setError('');
    try {
      const updated = await api.updateMe({ avatar: '' });
      setAvatar(null);
      onUpdated(updated);
    } catch (err) {
      setError(err.message || 'Could not remove avatar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-ink-800 p-6 shadow-2xl ring-1 ring-ink-500/50"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-lg font-bold">Your profile</h3>
        <div className="flex items-center gap-4">
          <Avatar name={profile?.username} size={64} src={avatar} />
          <div className="min-w-0">
            <div className="truncate font-semibold">{profile?.username}</div>
            <div className="truncate text-sm text-gray-400">{profile?.email}</div>
          </div>
        </div>

        {error && <div className="mt-3 text-sm text-danger">{error}</div>}

        <div className="mt-5 flex items-center gap-2">
          <label
            className={`cursor-pointer rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-hover ${
              busy ? 'pointer-events-none opacity-60' : ''
            }`}
          >
            {busy ? 'Saving…' : avatar ? 'Change avatar' : 'Upload avatar'}
            <input type="file" accept="image/*" hidden onChange={pickFile} disabled={busy} />
          </label>
          {avatar && (
            <button
              onClick={removeAvatar}
              disabled={busy}
              className="rounded-lg px-3 py-2 text-sm text-gray-400 transition hover:text-white"
            >
              Remove
            </button>
          )}
          <button onClick={onClose} className="ml-auto text-sm text-gray-400 hover:text-white">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
