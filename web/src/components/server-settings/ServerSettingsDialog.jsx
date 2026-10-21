import { useState } from 'react';
import Modal from '../Modal.jsx';
import ConfirmDialog from '../ConfirmDialog.jsx';
import SettingsLayout from '../settings/SettingsLayout.jsx';
import OverviewSection from './OverviewSection.jsx';
import EmojiSection from './EmojiSection.jsx';
import RolesSection from './RolesSection.jsx';
import ImagineSection from './ImagineSection.jsx';
import ModLogSection from './ModLogSection.jsx';
import BansSection from './BansSection.jsx';
import ReportsSection from './ReportsSection.jsx';

// Server settings (P5-04): one window for everything about a server, on the
// settings kit, instead of a window per menu item. Each section shows only
// with its permission (`can`), as the menu items did:
//   overview (edit the server, or the owner), emoji, roles, imagine,
//   reports, modLog, bans
// Unsaved changes in Overview or Image generation make Close ask first.
export function serverSettingsSections(can, { openReports = 0 } = {}) {
  return [
    can.overview && { id: 'overview', label: 'Overview' },
    can.emoji && { id: 'emoji', label: 'Emoji' },
    can.roles && { id: 'roles', label: 'Roles' },
    can.imagine && { id: 'imagine', label: 'Image generation' },
    can.reports && { id: 'reports', label: 'Reports', group: 'Moderation', badge: { count: openReports, label: `${openReports} open` } },
    can.modLog && { id: 'modlog', label: 'Moderation log', group: 'Moderation' },
    can.bans && { id: 'bans', label: 'Bans', group: 'Moderation' },
  ].filter(Boolean);
}

export default function ServerSettingsDialog({ space, can, initialSection, onClose, overview, emoji, roles, imagine, modLog, reports }) {
  const sections = serverSettingsSections(can, { openReports: reports?.openCount || 0 });
  const ids = sections.map((s) => s.id);
  const [section, setSectionState] = useState(ids.includes(initialSection) ? initialSection : ids[0]);
  // Lists that load from the server (emoji, log, bans) load on their first visit,
  // then stay mounted like the other sections.
  const [visited, setVisited] = useState(() => new Set([section]));
  const setSection = (id) => {
    setSectionState(id);
    setVisited((v) => (v.has(id) ? v : new Set(v).add(id)));
  };
  const [dirty, setDirty] = useState({}); // section id -> has unsaved changes
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renamed, setRenamed] = useState(false);
  const markDirty = (id) => (d) => setDirty((all) => (all[id] === d ? all : { ...all, [id]: d }));
  const requestClose = () => (Object.values(dirty).some(Boolean) ? setConfirmClose(true) : onClose());

  function renderSection(id) {
    if (id === 'overview')
      return <OverviewSection space={space} {...overview} isOwner={can.owner} onDelete={() => setConfirmDelete(true)} onDirtyChange={markDirty('overview')} saved={renamed} onSavedChange={setRenamed} />;
    if (id === 'emoji') return visited.has(id) ? <EmojiSection space={space} {...emoji} /> : null;
    if (id === 'roles') return <RolesSection space={space} {...roles} />;
    if (id === 'imagine') return <ImagineSection space={space} {...imagine} onDirtyChange={markDirty('imagine')} />;
    if (id === 'reports') return visited.has(id) ? <ReportsSection space={space} {...reports} /> : null;
    if (id === 'modlog') return visited.has(id) ? <ModLogSection space={space} {...modLog} /> : null;
    if (id === 'bans') return visited.has(id) ? <BansSection space={space} /> : null;
    return null;
  }

  return (
    <Modal
      onClose={requestClose}
      backdropClassName="flex items-center justify-center bg-black/60 md:p-4"
      panelClassName="flex h-dvh w-full flex-col bg-ink-800 shadow-2xl md:h-[min(720px,88vh)] md:max-w-5xl md:rounded-xl md:ring-1 md:ring-ink-500/50"
    >
      <Modal.Header title="Server settings" subtitle={space} onClose={requestClose} />
      <SettingsLayout
        label="Server settings sections"
        sections={sections}
        section={section}
        onSection={setSection}
        startOnPage={ids.includes(initialSection)}
        renderSection={renderSection}
      />
      {confirmClose && (
        <ConfirmDialog
          title="Discard changes?"
          body="Some server settings aren’t saved yet."
          confirmLabel="Discard"
          danger
          onConfirm={onClose}
          onCancel={() => setConfirmClose(false)}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${space}?`}
          body="This deletes the server, its channels and all messages for everyone. It can't be undone."
          confirmLabel="Delete server"
          danger
          requireText={space}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            onClose();
            overview.onDeleteServer();
          }}
        />
      )}
    </Modal>
  );
}
