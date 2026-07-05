import { useState } from 'react';
import Avatar from './Avatar.jsx';

// Right-hand roster grouped by online status. Clicking a member opens a menu:
// message them, and (with permission) promote/demote or remove them.
export default function MemberList({ members, currentUser, myRole, onMessageUser, onSetRole, onKick }) {
  const [menuFor, setMenuFor] = useState(null);
  const online = members.filter((m) => m.online);
  const offline = members.filter((m) => !m.online);
  const isOwner = myRole === 'owner';

  function actionsFor(m) {
    const self = m.username === currentUser;
    const acts = [];
    if (!self) acts.push({ label: 'Message', onClick: () => onMessageUser(m.username) });
    if (isOwner && !self && m.role !== 'owner') {
      acts.push(
        m.role === 'admin'
          ? { label: 'Remove admin', onClick: () => onSetRole(m.username, 'member') }
          : { label: 'Make admin', onClick: () => onSetRole(m.username, 'admin') }
      );
    }
    const canKick = !self && ((isOwner && m.role !== 'owner') || (myRole === 'admin' && m.role === 'member'));
    if (canKick) {
      acts.push({
        label: 'Remove from server',
        danger: true,
        onClick: () => {
          if (window.confirm(`Remove ${m.username} from the server?`)) onKick(m.username);
        },
      });
    }
    return acts;
  }

  function renderGroup(label, people, status) {
    if (!people.length) return null;
    return (
      <div>
        <div className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          {label} — {people.length}
        </div>
        {people.map((m) => {
          const acts = actionsFor(m);
          const open = menuFor === m.username;
          return (
            <div key={m.username}>
              <button
                onClick={() => acts.length && setMenuFor(open ? null : m.username)}
                title={acts.length ? m.username : 'You'}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition ${
                  status === 'offline' ? 'opacity-50' : ''
                } ${acts.length ? 'hover:bg-ink-700/60' : 'cursor-default'}`}
              >
                <Avatar name={m.username} size={30} status={status} src={m.avatar} />
                <span className="min-w-0 flex-1 truncate text-sm text-gray-200">{m.username}</span>
                {m.role === 'owner' && <RoleBadge>Owner</RoleBadge>}
                {m.role === 'admin' && <RoleBadge>Admin</RoleBadge>}
              </button>
              {open && acts.length > 0 && (
                <div className="mb-1 ml-9 mr-1 overflow-hidden rounded-lg bg-ink-900 shadow-lg ring-1 ring-ink-500/50">
                  {acts.map((a) => (
                    <button
                      key={a.label}
                      onClick={() => {
                        setMenuFor(null);
                        a.onClick();
                      }}
                      className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-ink-600 ${
                        a.danger ? 'text-danger' : 'text-gray-200'
                      }`}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <aside className="hidden w-56 flex-col bg-ink-800 lg:flex">
      <header className="flex h-12 items-center px-4 shadow-sm shadow-black/20">
        <h3 className="text-sm font-semibold text-gray-300">Members — {members.length}</h3>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
        {members.length === 0 && <p className="px-2 text-sm text-gray-500">No members to show.</p>}
        {renderGroup('Online', online, 'online')}
        {renderGroup('Offline', offline, 'offline')}
      </div>
    </aside>
  );
}

function RoleBadge({ children }) {
  return (
    <span className="shrink-0 rounded bg-brand/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-brand">
      {children}
    </span>
  );
}
