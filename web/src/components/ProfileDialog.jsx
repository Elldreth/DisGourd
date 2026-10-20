import { useEffect, useRef, useState } from 'react';
import * as api from '../api.js';
import Avatar from './Avatar.jsx';
import AudioSettings from './AudioSettings.jsx';
import NotificationSettings from './NotificationSettings.jsx';
import AppearanceSettings from './AppearanceSettings.jsx';
import RegistrationAdmin from './RegistrationAdmin.jsx';
import { ImagineSettingsProvider, ImagineSaveBar } from './admin/imagine/ImagineSettings.jsx';
import ImagineOverview from './admin/imagine/OverviewPage.jsx';
import ImagineComfy from './admin/imagine/ComfyPage.jsx';
import ImagineQuality from './admin/imagine/QualityPage.jsx';
import ImagineVariations from './admin/imagine/VariationsPage.jsx';
import ImagineKie from './admin/imagine/KiePage.jsx';
import ImagineTry from './admin/imagine/TryPage.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';
import ChangePasswordDialog from './ChangePasswordDialog.jsx';
import DevicesSection from './settings/DevicesSection.jsx';
import ImageCropper from './ImageCropper.jsx';
import Modal from './Modal.jsx';
import SettingsLayout from './settings/SettingsLayout.jsx';
import { PRESENCE_MODES } from './UserFooter.jsx';

// Your settings (P5-02): a fixed-size window on the settings kit. Your own
// sections first, then (site admins only) the Site admin group. The page you
// last used is remembered per browser; `initialSection` opens a given one.
const SECTIONS = [
  { id: 'profile', label: 'My account' },
  { id: 'audio', label: 'Voice & audio' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'appearance', label: 'Appearance' },
];
// Site admin: General (sign-up, site admins, link previews), then Image
// generation as an overview and five short pages (P5-03).
const ADMIN_SECTIONS = [
  { id: 'admin', label: 'General', group: 'Site admin' },
  { id: 'imagine', label: 'Image generation', group: 'Site admin' },
  { id: 'imagine-comfy', label: 'ComfyUI', group: 'Site admin', indent: true },
  { id: 'imagine-quality', label: 'Quality', group: 'Site admin', indent: true },
  { id: 'imagine-variations', label: 'Variations', group: 'Site admin', indent: true },
  { id: 'imagine-kie', label: 'kie.ai', group: 'Site admin', indent: true },
  { id: 'imagine-try', label: 'Try it', group: 'Site admin', indent: true },
];
const IMAGINE_PAGES = {
  imagine: ImagineOverview,
  'imagine-comfy': ImagineComfy,
  'imagine-quality': ImagineQuality,
  'imagine-variations': ImagineVariations,
  'imagine-kie': ImagineKie,
  'imagine-try': ImagineTry,
};
const SECTION_KEY = 'dg.settingsSection';

function readSection(allowed) {
  try {
    const v = localStorage.getItem(SECTION_KEY);
    return allowed.includes(v) ? v : null;
  } catch {
    return null;
  }
}

export default function ProfileDialog({ profile, presence = 'online', onClose, onUpdated, onEditStatus, onLogout, onOutputChange, onPttChange, onMicChange, inCall, initialSection, onPasswordChanged }) {
  const sections = profile?.siteAdmin ? [...SECTIONS, ...ADMIN_SECTIONS] : SECTIONS;
  const ids = sections.map((s) => s.id);
  const [section, setSection] = useState(() => (ids.includes(initialSection) ? initialSection : readSection(ids) || ids[0]));
  useEffect(() => {
    try {
      localStorage.setItem(SECTION_KEY, section);
    } catch {
      // private mode or blocked storage: the choice just isn't remembered
    }
  }, [section]);
  const fileRef = useRef(null);
  const [avatar, setAvatar] = useState(profile?.avatar || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [crop, setCrop] = useState(null); // { src: File|url, initialCrop } while framing
  const [passwordOpen, setPasswordOpen] = useState(false); // P6-02
  const [passwordNote, setPasswordNote] = useState('');

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

  const mode = PRESENCE_MODES.find((m) => m.id === presence) || PRESENCE_MODES[0];
  const customStatus = [profile?.statusEmoji, profile?.statusText].filter(Boolean).join(' ');
  const secondary = 'tap rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:bg-ink-700 hover:text-fg';

  function renderSection(id) {
    if (id === 'profile')
      return (
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <Avatar name={profile?.username} size={64} src={avatar} />
            <div className="min-w-0">
              <div className="truncate text-base font-semibold">{profile?.username}</div>
              <div className="truncate text-sm text-gray-400">{profile?.email}</div>
            </div>
          </div>
          {error && <div className="text-sm text-danger">{error}</div>}
          <div className="flex flex-wrap items-center gap-2">
            {/* A real button (a <label> around a hidden input can't be tabbed to). */}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className={`tap cursor-pointer rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-hover ${
                busy ? 'pointer-events-none opacity-60' : ''
              }`}
            >
              {busy ? 'Saving…' : avatar ? 'Change avatar' : 'Upload avatar'}
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickFile} disabled={busy} />
            {profile?.avatarOriginal && (
              <button type="button" onClick={reframe} disabled={busy} className={secondary}>
                Reposition
              </button>
            )}
            {avatar && (
              <button type="button" onClick={removeAvatar} disabled={busy} className={secondary}>
                Remove
              </button>
            )}
          </div>

          <div className="rounded-xl bg-ink-900/60 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Status</div>
            <div className="mt-2 flex items-center gap-3">
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-gray-200">{mode.label}</span>
                {customStatus && <span className="block truncate text-sm text-gray-400">{customStatus}</span>}
              </span>
              {onEditStatus && (
                <button type="button" onClick={onEditStatus} className="tap rounded-lg bg-ink-600 px-3 py-1.5 text-sm text-gray-200 transition hover:bg-ink-500">
                  Edit status
                </button>
              )}
            </div>
          </div>

          {onPasswordChanged && (
            <div className="rounded-xl bg-ink-900/60 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Password</div>
              <div className="mt-2 flex items-center gap-3">
                <span className="min-w-0 flex-1 text-sm text-gray-400">
                  {passwordNote || 'Changing it signs out your other devices.'}
                </span>
                <button
                  type="button"
                  onClick={() => setPasswordOpen(true)}
                  className="tap rounded-lg bg-ink-600 px-3 py-1.5 text-sm text-gray-200 transition hover:bg-ink-500"
                >
                  Change password
                </button>
              </div>
            </div>
          )}
          {onPasswordChanged && <DevicesSection onToken={onPasswordChanged} />}
          {passwordOpen && (
            <ChangePasswordDialog
              onClose={() => setPasswordOpen(false)}
              onChanged={(token) => {
                setPasswordNote('Password changed. Your other devices were signed out.');
                onPasswordChanged(token);
              }}
            />
          )}

          {onLogout && (
            <div className="border-t border-ink-500/40 pt-5">
              <button type="button" onClick={onLogout} className="tap rounded-lg px-3 py-2 text-sm font-semibold text-danger ring-1 ring-danger/40 transition hover:bg-danger/10">
                Sign out
              </button>
            </div>
          )}
        </div>
      );
    if (id === 'audio') return <AudioSettings onOutputChange={onOutputChange} onPttChange={onPttChange} onMicChange={onMicChange} inCall={inCall} />;
    if (id === 'appearance') return <AppearanceSettings />;
    if (id === 'notifications') return <NotificationSettings />;
    if (id === 'admin') return <RegistrationAdmin />;
    const Page = IMAGINE_PAGES[id];
    if (Page)
      return (
        <>
          <Page />
          {id !== 'imagine-try' && <ImagineSaveBar />}
        </>
      );
    return null;
  }

  // Unsaved site-admin changes: ask before closing (P5-03).
  const [adminDirty, setAdminDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const requestClose = () => (adminDirty ? setConfirmClose(true) : onClose());

  const layout = (
    <SettingsLayout
      label="Settings sections"
      sections={sections}
      section={section}
      onSection={setSection}
      startOnPage={ids.includes(initialSection)}
      renderSection={renderSection}
    />
  );

  return (
    <Modal
      onClose={requestClose}
      backdropClassName="flex items-center justify-center bg-black/60 md:p-4"
      panelClassName="flex h-dvh w-full flex-col bg-ink-800 shadow-2xl md:h-[min(680px,85vh)] md:max-w-3xl md:rounded-xl md:ring-1 md:ring-ink-500/50"
    >
      <Modal.Header title="Settings" onClose={requestClose} />
      {profile?.siteAdmin ? (
        <ImagineSettingsProvider onDirtyChange={setAdminDirty} onNavigate={setSection}>
          {layout}
        </ImagineSettingsProvider>
      ) : (
        layout
      )}
      {confirmClose && (
        <ConfirmDialog
          title="Discard changes?"
          body="Your image generation changes aren’t saved yet."
          confirmLabel="Discard"
          danger
          onConfirm={onClose}
          onCancel={() => setConfirmClose(false)}
        />
      )}

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
