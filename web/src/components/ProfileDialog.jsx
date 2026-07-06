import { useState } from 'react';
import * as api from '../api.js';
import Avatar from './Avatar.jsx';
import AudioSettings from './AudioSettings.jsx';

// User settings: avatar/profile and audio devices.
export default function ProfileDialog({ profile, onClose, onUpdated, onOutputChange, onPttChange, onMicChange, inCall }) {
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
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-xl bg-ink-800 shadow-2xl ring-1 ring-ink-500/50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink-500/40 px-6 py-4">
          <h3 className="text-lg font-bold">Settings</h3>
          <button onClick={onClose} className="text-sm text-gray-400 hover:text-white">
            Close
          </button>
        </div>

        <div className="space-y-6 overflow-y-auto p-6">
          <section>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Profile</h4>
            <div className="flex items-center gap-4">
              <Avatar name={profile?.username} size={64} src={avatar} />
              <div className="min-w-0">
                <div className="truncate font-semibold">{profile?.username}</div>
                <div className="truncate text-sm text-gray-400">{profile?.email}</div>
              </div>
            </div>
            {error && <div className="mt-3 text-sm text-danger">{error}</div>}
            <div className="mt-4 flex items-center gap-2">
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
            </div>
          </section>

          <section>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Voice &amp; audio
            </h4>
            <AudioSettings
              onOutputChange={onOutputChange}
              onPttChange={onPttChange}
              onMicChange={onMicChange}
              inCall={inCall}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
