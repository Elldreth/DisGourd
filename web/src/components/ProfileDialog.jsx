import { useEffect, useId, useRef, useState } from 'react';
import * as api from '../api.js';
import Avatar from './Avatar.jsx';
import AudioSettings from './AudioSettings.jsx';
import NotificationSettings from './NotificationSettings.jsx';
import AppearanceSettings from './AppearanceSettings.jsx';
import RegistrationAdmin from './RegistrationAdmin.jsx';
import ImagineAdmin from './ImagineAdmin.jsx';
import ImageCropper from './ImageCropper.jsx';
import Modal from './Modal.jsx';

// The settings dialog, in sections: a list on the left (desktop) or a strip
// across the top (phones). Sections stay mounted while hidden, so an edit in
// one survives a look at another. `initialSection` opens a given one; the
// last one used is remembered per browser.
const SECTIONS = [
  { id: 'profile', label: 'Profile' },
  { id: 'audio', label: 'Voice & audio' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'notifications', label: 'Notifications' },
];
const ADMIN_SECTIONS = [
  { id: 'admin', label: 'Registration & access', group: 'Site admin' },
  { id: 'imagine', label: 'Image generation', group: 'Site admin' },
];
const SECTION_KEY = 'dg.settingsSection';

function readSection(allowed) {
  try {
    const v = localStorage.getItem(SECTION_KEY);
    return allowed.includes(v) ? v : null;
  } catch {
    return null;
  }
}

export default function ProfileDialog({ profile, onClose, onUpdated, onOutputChange, onPttChange, onMicChange, inCall, initialSection }) {
  const bodyRef = useRef(null); // focus starts on the first setting, not the header's Close
  const sections = profile?.siteAdmin ? [...SECTIONS, ...ADMIN_SECTIONS] : SECTIONS;
  const ids = sections.map((s) => s.id);
  const [section, setSection] = useState(() => (ids.includes(initialSection) ? initialSection : readSection(ids) || ids[0]));
  useEffect(() => {
    try {
      localStorage.setItem(SECTION_KEY, section);
    } catch {
      // private mode or blocked storage: the choice just isn't remembered
    }
    // On phones the strip scrolls sideways: keep the chosen tab in view.
    tabRefs.current[section]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [section]);
  const baseId = useId();
  const tabId = (id) => `${baseId}-tab-${id}`;
  const panelId = (id) => `${baseId}-panel-${id}`;
  const tabRefs = useRef({});

  // Roving focus through the tabs: arrows move and select, Home/End jump,
  // Enter or Space puts focus into the section itself.
  function onTabKey(e) {
    const i = ids.indexOf(section);
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = ids[(i + 1) % ids.length];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = ids[(i + ids.length - 1) % ids.length];
    else if (e.key === 'Home') next = ids[0];
    else if (e.key === 'End') next = ids[ids.length - 1];
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      document.getElementById(panelId(section))?.focus();
      return;
    }
    if (!next) return;
    e.preventDefault();
    setSection(next);
    tabRefs.current[next]?.focus();
  }

  const tabClass = (active) =>
    `tap-row shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-left text-sm transition md:w-full ${
      active ? 'bg-ink-600 text-fg' : 'text-gray-400 hover:bg-ink-700/60 hover:text-gray-200'
    }`;
  const renderTab = (s) => (
    <button
      key={s.id}
      ref={(el) => (tabRefs.current[s.id] = el)}
      type="button"
      role="tab"
      id={tabId(s.id)}
      aria-selected={section === s.id}
      aria-controls={panelId(s.id)}
      tabIndex={section === s.id ? 0 : -1}
      onClick={() => setSection(s.id)}
      onKeyDown={onTabKey}
      className={tabClass(section === s.id)}
    >
      {s.label}
    </button>
  );
  const panelProps = (id) => ({
    role: 'tabpanel',
    id: panelId(id),
    'aria-labelledby': tabId(id),
    tabIndex: -1,
    hidden: section !== id,
    className: 'outline-hidden',
  });
  const fileRef = useRef(null);
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
      panelClassName="flex max-h-[85vh] w-full max-w-md flex-col rounded-xl bg-ink-800 shadow-2xl ring-1 ring-ink-500/50 md:max-w-2xl"
    >
      <div className="flex items-center justify-between border-b border-ink-500/40 px-6 py-4">
        <Modal.Title>Settings</Modal.Title>
        <button onClick={onClose} className="tap text-sm text-gray-400 hover:text-fg">
          Close
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div
          role="tablist"
          aria-label="Settings sections"
          aria-orientation="horizontal"
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-ink-500/40 px-3 py-2 md:w-48 md:flex-col md:overflow-y-auto md:border-b-0 md:border-r md:px-3 md:py-4"
        >
          {SECTIONS.map(renderTab)}
          {profile?.siteAdmin && (
            <>
              <div className="mt-2 hidden px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 md:block">Site admin</div>
              <div aria-hidden="true" className="mx-1 w-px self-stretch bg-ink-500/60 md:hidden" />
              {ADMIN_SECTIONS.map(renderTab)}
            </>
          )}
        </div>

      <div ref={bodyRef} className="min-w-0 flex-1 space-y-6 overflow-y-auto p-6">
        <section {...panelProps('profile')}>
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
            {/* A real button (a <label> around a hidden input can't be tabbed to). */}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className={`cursor-pointer rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-hover ${
                busy ? 'pointer-events-none opacity-60' : ''
              }`}
            >
              {busy ? 'Saving…' : avatar ? 'Change avatar' : 'Upload avatar'}
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickFile} disabled={busy} />
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

        <section {...panelProps('audio')}>
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

        <section {...panelProps('appearance')}>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Appearance</h4>
          <AppearanceSettings />
        </section>

        <section {...panelProps('notifications')}>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Notifications</h4>
          <NotificationSettings />
        </section>

        {profile?.siteAdmin && (
          <section {...panelProps('admin')}>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Registration &amp; access (site admin)
            </h4>
            <RegistrationAdmin />
          </section>
        )}
        {profile?.siteAdmin && (
          <section {...panelProps('imagine')}>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Image generation (site admin)
            </h4>
            <ImagineAdmin />
          </section>
        )}
      </div>
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
