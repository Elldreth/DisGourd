import { useId, useState } from 'react';
import Modal from './Modal.jsx';
import Avatar from './Avatar.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';
import Switch from './settings/Switch.jsx';
import { MAX_GROUP } from '../state/useDms.js';

// A group DM's members and settings (P9-06d): the list (owner marked), Add
// people (anyone, up to 10), Remove (the owner only; asks), Rename (anyone),
// Mute, and Leave group (asks; the owner is told who takes over).
export default function GroupMembersDialog({ conversation, title, myId, onAdd, onRemove, onRename, onMute, onLeave, onClose }) {
  const members = conversation.members || [];
  const owner = conversation.ownerId === myId;
  const [name, setName] = useState(conversation.name || '');
  const [removing, setRemoving] = useState(null);
  const [leaving, setLeaving] = useState(false);
  const nameId = useId();
  // Who takes over if the owner leaves: whoever has been in longest (members come in join order).
  const next = members.find((m) => m.id !== myId);
  const renamed = name.trim() !== (conversation.name || '');

  return (
    <>
      <Modal
        onClose={onClose}
        panelClassName="flex max-h-[80vh] w-full max-w-md flex-col rounded-xl bg-ink-800 p-5 shadow-2xl ring-1 ring-ink-500/50"
      >
        <Modal.Title>{title}</Modal.Title>
        <p className="mb-3 text-sm text-gray-400">{members.length} of {MAX_GROUP} members</p>

        <ul aria-label="Members" className="-mx-2 mb-3 max-h-64 overflow-y-auto">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-2 rounded-md px-2 py-1.5">
              <Avatar name={m.username} src={m.avatar} size={28} />
              <span className="min-w-0 flex-1 truncate text-sm text-gray-200">
                {m.username}
                {m.id === myId && <span className="text-gray-500"> (you)</span>}
              </span>
              {m.id === conversation.ownerId && <span className="rounded bg-brand/20 px-1.5 py-0.5 text-[11px] font-semibold text-brand-hi">Owner</span>}
              {owner && m.id !== myId && (
                <button type="button" onClick={() => setRemoving(m)} className="rounded-md px-2 py-0.5 text-xs font-medium text-danger hover:bg-ink-700">
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={onAdd}
          disabled={members.length >= MAX_GROUP}
          className="mb-4 self-start rounded-md px-2 py-1 text-sm font-medium text-brand-hi hover:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Add people
        </button>

        <form
          className="mb-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (renamed) onRename(name.trim());
          }}
        >
          <label htmlFor={nameId} className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">Group name</label>
          <div className="flex gap-2">
            <input id={nameId} value={name} maxLength={50} onChange={(e) => setName(e.target.value)} placeholder="No name (shows the members)" className="input min-w-0 flex-1" />
            <button type="submit" disabled={!renamed} className="shrink-0 rounded-lg bg-ink-600 px-3 py-2 text-sm font-medium text-fg hover:bg-ink-500 disabled:opacity-50">
              Rename
            </button>
          </div>
        </form>

        <div className="mb-4 flex items-center justify-between gap-3">
          <span className="text-sm text-gray-200">
            Mute this group
            <span className="block text-xs text-gray-500">It still shows unread, but no sounds or notifications.</span>
          </span>
          <Switch label="Mute this group" checked={conversation.muted} onChange={(on) => onMute(on)} />
        </div>

        <div className="flex justify-between gap-2 border-t border-ink-500/40 pt-4">
          <button type="button" onClick={() => setLeaving(true)} className="rounded-lg px-3 py-2 text-sm font-medium text-danger hover:bg-ink-700">
            Leave group
          </button>
          <button type="button" onClick={onClose} className="rounded-lg bg-ink-600 px-4 py-2 text-sm font-medium text-fg hover:bg-ink-500">
            Done
          </button>
        </div>
      </Modal>
      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.username}?`}
          body={`${removing.username} leaves ${title} and won’t see new messages. Their earlier messages stay.`}
          confirmLabel="Remove"
          danger
          onConfirm={() => {
            onRemove(removing.username);
            setRemoving(null);
          }}
          onCancel={() => setRemoving(null)}
        />
      )}
      {leaving && (
        <ConfirmDialog
          title={`Leave ${title}?`}
          body={
            members.length <= 1
              ? 'You’re the last one here, so the group and its messages will be deleted.'
              : `You won’t see new messages unless someone adds you back.${owner && next ? ` ${next.username} becomes the owner.` : ''}`
          }
          confirmLabel="Leave group"
          danger
          onConfirm={() => {
            setLeaving(false);
            onLeave();
          }}
          onCancel={() => setLeaving(false)}
        />
      )}
    </>
  );
}
