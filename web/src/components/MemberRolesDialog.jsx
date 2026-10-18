import { useRef, useState } from 'react';
import Modal from './Modal.jsx';

// A member's roles, from the member menu's "Roles…" (P2-21c): a checklist of
// the server's roles (besides @everyone). Each change applies at once. Roles
// at or above your own are shown but can't be changed. `member` comes live
// from useSpaces, so the ticks follow the server.
export default function MemberRolesDialog({ space, member, roles, isOwner, myPosition, onToggle, onClose }) {
  const bodyRef = useRef(null);
  const [busy, setBusy] = useState(null); // role id being changed
  const [error, setError] = useState('');
  const has = new Set(member.roles || []);
  const list = roles.filter((r) => !r.isDefault);

  // Clicks wait while a change is saving. The boxes aren't disabled for it:
  // that would drop keyboard focus (and Esc) out of the dialog.
  async function toggle(role) {
    if (busy != null) return;
    setBusy(role.id);
    setError('');
    try {
      await onToggle(member.username, role.id, !has.has(role.id));
    } catch (err) {
      setError(err.message || 'Could not change their roles');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      onClose={onClose}
      initialFocusRef={bodyRef}
      panelClassName="flex max-h-[85vh] w-full max-w-sm flex-col rounded-xl bg-ink-800 shadow-2xl ring-1 ring-ink-500/50"
    >
      <div className="flex items-center justify-between border-b border-ink-500/40 px-6 py-4">
        <Modal.Title>Roles for {member.username}</Modal.Title>
        <button onClick={onClose} className="text-sm text-gray-400 hover:text-fg">Close</button>
      </div>
      <div ref={bodyRef} className="overflow-y-auto p-4">
        {list.length === 0 && <p className="px-2 text-sm text-gray-400">{space} has no roles besides @everyone yet.</p>}
        <fieldset>
          <legend className="sr-only">Roles</legend>
          {list.map((r) => {
            const locked = !isOwner && r.position >= myPosition;
            return (
              <label key={r.id} className={`flex items-center gap-3 rounded px-2 py-2 ${locked ? 'opacity-50' : 'cursor-pointer hover:bg-ink-700/60'}`}>
                <input
                  type="checkbox"
                  checked={has.has(r.id)}
                  disabled={locked}
                  onChange={() => toggle(r)}
                  className="h-4 w-4 accent-brand"
                />
                <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full ring-1 ring-ink-500" style={{ background: r.color || 'transparent' }} />
                <span className="flex-1 truncate text-sm text-gray-200">{r.name}</span>
                {locked && <span className="text-xs text-gray-500">Above you</span>}
              </label>
            );
          })}
        </fieldset>
        {error && <div role="alert" className="mt-2 px-2 text-sm text-danger">{error}</div>}
      </div>
    </Modal>
  );
}
