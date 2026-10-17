import { useRef, useState } from 'react';
import * as api from '../api.js';
import Avatar from './Avatar.jsx';
import AudioSettings from './AudioSettings.jsx';
import NotificationSettings from './NotificationSettings.jsx';
import AppearanceSettings from './AppearanceSettings.jsx';
import RegistrationAdmin from './RegistrationAdmin.jsx';
import ImageCropper from './ImageCropper.jsx';
import Modal from './Modal.jsx';

// User settings: avatar/profile and audio devices.
export default function ProfileDialog({ profile, onClose, onUpdated, onOutputChange, onPttChange, onMicChange, inCall }) {
  const bodyRef = useRef(null); // focus starts on the first setting, not the header's Close
  const [avatar, setAvatar] = useState(profile?.avatar || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [crop, setCrop] = useState(null); // { src: File|url, initialCrop } while framing

  function pickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file');
      return;
    }
    setError('');
    setCrop({ src: file, initialCrop: null }); // frame it before uploading
  }

  // Re-open the framing dialog on the original upload, restoring the last crop.
  function reframe() {
    if (!profile?.avatarOriginal) return;
    setError('');
    setCrop({ src: profile.avatarOriginal, initialCrop: profile.avatarCrop || null });
  }

  async function saveAvatar({ blob, crop: box }) {
    setBusy(true);
    setError('');
    try {
      // Keep the original so it can be re-framed later; on a fresh pick that means
      // uploading it too, on a re-frame it's already stored.
      const original = typeof crop.src === 'string' ? crop.src : (await api.uploadFile(crop.src)).url;
      const up = await api.uploadFile(blob);
      const updated = await api.updateMe({ avatar: up.url, avatarOriginal: original, avatarCrop: box });
      setAvatar(updated.avatar);
      onUpdated(updated);
      setCrop(null);
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
    <Modal
      onClose={onClose}
      initialFocusRef={bodyRef}
      panelClassName="flex max-h-[85vh] w-full max-w-md flex-col rounded-xl bg-ink-800 shadow-2xl ring-1 ring-ink-500/50"
    >
      <div className="flex items-center justify-between border-b border-ink-500/40 px-6 py-4">
        <Modal.Title>Settings</Modal.Title>
        <button onClick={onClose} className="text-sm text-gray-400 hover:text-fg">
          Close
        </button>
      </div>

      <div ref={bodyRef} className="space-y-6 overflow-y-auto p-6">
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
            {profile?.avatarOriginal && (
              <button
                onClick={reframe}
                disabled={busy}
                className="rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:text-fg"
              >
                Reposition
              </button>
            )}
            {avatar && (
              <button
                onClick={removeAvatar}
                disabled={busy}
                className="rounded-lg px-3 py-2 text-sm text-gray-400 transition hover:text-fg"
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

        <section>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Appearance</h4>
          <AppearanceSettings />
        </section>

        <section>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Notifications</h4>
          <NotificationSettings />
        </section>

        {profile?.siteAdmin && (
          <section>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Registration &amp; access (site admin)
            </h4>
            <RegistrationAdmin />
          </section>
        )}
      </div>

      {crop && (
        <ImageCropper
          src={crop.src}
          initialCrop={crop.initialCrop}
          shape="circle"
          title="Position your avatar"
          onCancel={() => setCrop(null)}
          onSave={saveAvatar}
        />
      )}
    </Modal>
  );
}
