import EmptyState from './EmptyState.jsx';
import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';
import MemberRolesDialog from './MemberRolesDialog.jsx';
import RoleName from './RoleName.jsx';

// Right-hand roster grouped by online status. Clicking a member opens a menu:
// message them, and (with permission) change their roles or remove them.
// The member list: a column on the right on desktop (lg and up), and a
// slide-in drawer below that, opened from the chat header (`open` /
// `onClose`). The drawer closes on Esc, the backdrop or its close button;
// focus moves into it and goes back where it was when it closes.
// Spoken after a member's name (the dot alone isn't enough).
const STATUS_WORDS = { idle: 'Idle', dnd: 'Do Not Disturb' };

// canKickMembers / myPosition (from the server's roles): who I may remove.
// roles (highest first) name each member's badge; canManageRoles offers
// "Roles…", whose changes go through onToggleRole(username, roleId, on).
export default function MemberList({ space, members, currentUser, myRole, roles = [], canKickMembers = false, canManageRoles = false, myPosition = 0, onMessageUser, onToggleRole, onKick, open = false, onClose }) {
  const panelRef = useRef(null);
  const [kicking, setKicking] = useState(null); // username awaiting "are you sure?"
  const [editingRoles, setEditingRoles] = useState(null); // username whose roles are open
  useEffect(() => {
    if (!open) return undefined;
    const returnTo = document.activeElement;
    requestAnimationFrame(() => panelRef.current?.querySelector('button')?.focus());
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (returnTo && document.contains(returnTo)) returnTo.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const [menuFor, setMenuFor] = useState(null);
  // status: online | idle | dnd | offline (older servers only sent `online`).
  const statusOf = (m) => m.status || (m.online ? 'online' : 'offline');
  const online = members.filter((m) => statusOf(m) !== 'offline');
  const offline = members.filter((m) => statusOf(m) === 'offline');
  const isOwner = myRole === 'owner';
  // The badge: Owner, else the member's highest role (roles come highest first).
  // A member's highest role besides @everyone (roles come highest first).
  const topRole = (m) => roles.find((r) => !r.isDefault && (m.roles || []).includes(r.id)) || null;
  // The badge: Owner, else the member's highest role.
  const topRoleName = (m) => (m.role === 'owner' ? 'Owner' : topRole(m)?.name || null);
  // Online members grouped under their highest role, in role order; the
  // rest under Online (P2-21d).
  const onlineGroups = [
    ...roles
      .filter((r) => !r.isDefault)
      .map((r) => ({ key: `role-${r.id}`, label: r.name, people: online.filter((m) => topRole(m)?.id === r.id) })),
    { key: 'online', label: 'Online', people: online.filter((m) => !topRole(m)) },
  ];

  function actionsFor(m) {
    const self = m.username === currentUser;
    const acts = [];
    if (!self) acts.push({ label: 'Message', onClick: () => onMessageUser(m.username) });
    // Changing roles: "manage roles", and they sit below me (or it's me).
    if (canManageRoles && m.role !== 'owner' && (isOwner || self || (m.position ?? 0) < myPosition)) {
      acts.push({
        label: 'Roles…',
        onClick: () => {
          panelRef.current?.querySelector(`button[title="${CSS.escape(m.username)}"]`)?.focus();
          setEditingRoles(m.username);
        },
      });
    }
    // Removing someone: the "kick" ability, and they sit strictly below me.
    const canKick = !self && canKickMembers && (m.position ?? 0) < myPosition;
    if (canKick) {
      acts.push({
        label: 'Remove from server',
        danger: true,
        onClick: () => {
          // The menu item disappears; put focus on the member's row so the
          // confirm dialog has somewhere to return it.
          panelRef.current?.querySelector(`button[title="${CSS.escape(m.username)}"]`)?.focus();
          setKicking(m.username);
        },
      });
    }
    return acts;
  }

  function renderGroup(label, people, status, key = label) {
    if (!people.length) return null;
    return (
      <div key={key}>
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
                className={`tap-row flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition ${
                  acts.length ? 'hover:bg-ink-700/60' : 'cursor-default'
                }`}
              >
                {/* Offline: a greyed avatar and muted (still readable) text, not
                    opacity, which took names below AA contrast (P3-20b). */}
                <span className={status === 'offline' ? 'grayscale' : ''}>
                  <Avatar name={m.username} size={30} status={statusOf(m)} src={m.avatar} />
                </span>
                <span className="min-w-0 flex-1">
                  <RoleName name={m.username} className={`block truncate text-sm ${status === 'offline' ? 'text-gray-500' : 'text-gray-200'}`} />
                  {STATUS_WORDS[statusOf(m)] && <span className="sr-only">, {STATUS_WORDS[statusOf(m)]}</span>}
                  {(m.statusText || m.statusEmoji) && (
                    // Plain text, never markdown or HTML.
                    <span className="block truncate text-xs text-gray-400">
                      <span className="sr-only">, </span>
                      {[m.statusEmoji, m.statusText].filter(Boolean).join(' ')}
                    </span>
                  )}
                </span>
                {topRoleName(m) && <RoleBadge>{topRoleName(m)}</RoleBadge>}
              </button>
              {open && acts.length > 0 && (
                <div className="anim-pop mb-1 ml-9 mr-1 overflow-hidden rounded-lg bg-ink-900 shadow-lg ring-1 ring-ink-500/50">
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
    <>
      {open && <div data-testid="members-backdrop" className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={onClose} />}
      <aside
        ref={panelRef}
        aria-label="Members"
        className={`fixed inset-y-0 right-0 z-40 flex w-64 flex-col border-l border-ink-900/50 bg-ink-800 shadow-2xl duration-200 lg:visible lg:static lg:z-auto lg:w-56 lg:translate-x-0 lg:shadow-none lg:transition-none ${
          // Opening: visible at once (so focus can move in), then slide.
          // Closing: slide out, and only then become hidden.
          open ? 'visible translate-x-0 transition-transform' : 'invisible translate-x-full transition-[transform,visibility]'
        }`}
      >
        <header className="flex h-12 items-center border-b border-ink-900/60 px-4 shadow-xs shadow-black/20">
          <h3 className="flex-1 text-sm font-semibold text-gray-300">Members — {members.length}</h3>
          <button
            onClick={onClose}
            aria-label="Close member list"
            title="Close"
            className="tap -mr-1 rounded-lg p-1.5 text-gray-400 transition hover:bg-ink-600 hover:text-fg lg:hidden"
          >
            <Icon name="x" size={18} />
          </button>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
          {members.length === 0 && <EmptyState compact icon="users" title="No members to show" />}
          {onlineGroups.map((g) => renderGroup(g.label, g.people, 'online', g.key))}
          {renderGroup('Offline', offline, 'offline')}
        </div>
      </aside>
      {editingRoles && members.some((m) => m.username === editingRoles) && (
        <MemberRolesDialog
          space={space}
          member={members.find((m) => m.username === editingRoles)}
          roles={roles}
          isOwner={isOwner}
          myPosition={myPosition}
          onToggle={onToggleRole}
          onClose={() => setEditingRoles(null)}
        />
      )}
      {kicking && (
        <ConfirmDialog
          title={`Remove @${kicking} from ${space || 'this server'}?`}
          body="They can rejoin with an invite."
          confirmLabel="Remove"
          danger
          onCancel={() => setKicking(null)}
          onConfirm={() => {
            onKick(kicking);
            setKicking(null);
          }}
        />
      )}
    </>
  );
}

function RoleBadge({ children }) {
  return (
    <span className="shrink-0 rounded-sm bg-brand/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-brand-hi">
      {children}
    </span>
  );
}
