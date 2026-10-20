import { useEffect, useState } from 'react';
import * as api from '../../api.js';
import { PERMISSION_GROUPS } from '../../util.js';
import Icon from '../Icon.jsx';

// Preset role colours (any other comes from the colour picker).
export const ROLE_COLORS = ['#e5484d', '#f76b15', '#ffc53d', '#46a758', '#12a594', '#0090ff', '#6e56cf', '#d6409f', '#8d8d8d'];

const draftOf = (role) => (role ? { name: role.name, color: role.color, permissions: [...role.permissions] } : null);
const sameDraft = (a, b) =>
  !!a && !!b && a.name === b.name && (a.color || null) === (b.color || null) && [...a.permissions].sort().join() === [...b.permissions].sort().join();

// A name no role uses yet: "New role", "New role 2", …
function freshName(roles) {
  const taken = new Set(roles.map((r) => r.name));
  for (let i = 1; ; i++) {
    const name = i === 1 ? 'New role' : `New role ${i}`;
    if (!taken.has(name)) return name;
  }
}

// The roles screen (P2-21c), for people who may manage roles. The roles
// highest first, with Move up / Move down and Create role; for the selected
// one its name, colour, permissions and members. You can change only roles
// below your own highest (the owner: all) and only grant permissions you hold;
// the server checks the same. `roles` and `members` come live from useSpaces.
// A section of Server settings since P5-04; permissions are grouped.
export default function RolesSection({ space, roles, members, currentUser, isOwner, myPosition, abilities, onChanged }) {
  const [selectedId, setSelectedId] = useState(() => roles.find((r) => !r.isDefault)?.id ?? roles[0]?.id ?? null);
  const selected = roles.find((r) => r.id === selectedId) || null;
  const [draft, setDraft] = useState(() => draftOf(selected));
  const [addWho, setAddWho] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // A fresh draft when the selection changes or the server's copy does.
  const selectedKey = selected ? JSON.stringify([selected.id, selected.name, selected.color, selected.permissions]) : '';
  useEffect(() => {
    setDraft(draftOf(selected));
    setConfirmDelete(false);
    setAddWho('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  const holds = (action) => isOwner || abilities.includes(action);
  const manageable = (r) => !!r && (isOwner || r.position < myPosition);
  const movable = roles.filter((r) => !r.isDefault && manageable(r)); // highest first
  const canEdit = manageable(selected);
  const dirty = canEdit && !sameDraft(draft, draftOf(selected));
  // Members whose roles I may change: below me, or myself (the owner: anyone).
  const changeable = (m) => isOwner || m.username === currentUser || (m.position ?? 0) < myPosition;

  // One change at a time. Buttons stay enabled meanwhile (disabling the
  // focused one would drop keyboard focus out of the dialog); clicks wait.
  async function run(failure, fn) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
      onChanged?.();
    } catch (err) {
      setError(err.message || failure);
    } finally {
      setBusy(false);
    }
  }

  const create = () =>
    run('Could not create the role', async () => {
      const { role } = await api.createRole(space, { name: freshName(roles), permissions: [] });
      setSelectedId(role.id);
    });

  // Swap a role with its neighbour among the ones I manage, then send them
  // all bottom to top.
  const move = (role, dir) =>
    run('Could not reorder the roles', async () => {
      const list = movable.map((r) => r.id);
      const i = list.indexOf(role.id);
      const j = i + (dir === 'up' ? -1 : 1);
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      await api.reorderRoles(space, list.reverse());
    });

  const save = () =>
    run('Could not save the role', async () => {
      const fields = { permissions: draft.permissions };
      if (!selected.isDefault) Object.assign(fields, { name: draft.name.trim(), color: draft.color || null });
      await api.updateRole(space, selected.id, fields);
    });

  const remove = () =>
    run('Could not delete the role', async () => {
      await api.deleteRole(space, selected.id);
      setSelectedId(roles.find((r) => !r.isDefault && r.id !== selected.id)?.id ?? roles.find((r) => r.isDefault)?.id ?? null);
    });

  const setHolder = (username, on) =>
    run('Could not change their roles', async () => {
      await api.setMemberHasRole(space, username, selected.id, on);
      if (on) setAddWho('');
    });

  const togglePermission = (key) =>
    setDraft((d) => ({ ...d, permissions: d.permissions.includes(key) ? d.permissions.filter((p) => p !== key) : [...d.permissions, key] }));

  const holders = selected?.members || [];
  const addable = members.filter((m) => !holders.includes(m.username) && changeable(m));

  return (
    <div className="flex flex-col overflow-hidden rounded-xl ring-1 ring-ink-500/40 sm:flex-row">
        {/* The roles, highest first. */}
        <div className="shrink-0 border-b border-ink-500/40 bg-ink-900/40 p-3 sm:w-56 sm:border-b-0 sm:border-r">
          <button
            onClick={create}
            disabled={busy}
            className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
          >
            <Icon name="plus" size={15} /> Create role
          </button>
          <ul aria-label="Roles" className="space-y-0.5">
            {roles.map((r) => {
              const at = movable.indexOf(r);
              return (
                <li key={r.id} className="flex items-center gap-1">
                  <button
                    onClick={() => setSelectedId(r.id)}
                    aria-current={r.id === selectedId ? 'true' : undefined}
                    className={`flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition ${
                      r.id === selectedId ? 'bg-ink-600 text-fg' : 'text-gray-300 hover:bg-ink-700/60'
                    }`}
                  >
                    <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full ring-1 ring-ink-500" style={{ background: r.color || 'transparent' }} />
                    <span className="min-w-0 flex-1 truncate">{r.name}</span>
                    {!r.isDefault && <span className="text-xs text-gray-500">{r.members.length}</span>}
                  </button>
                  {at >= 0 && (
                    <>
                      <button
                        onClick={() => move(r, 'up')}
                        disabled={at === 0}
                        aria-label={`Move ${r.name} up`}
                        title="Move up"
                        className="rounded p-1 text-gray-400 hover:bg-ink-600 hover:text-fg disabled:opacity-30"
                      >
                        <Icon name="chevronUp" size={14} />
                      </button>
                      <button
                        onClick={() => move(r, 'down')}
                        disabled={at === movable.length - 1}
                        aria-label={`Move ${r.name} down`}
                        title="Move down"
                        className="rounded p-1 text-gray-400 hover:bg-ink-600 hover:text-fg disabled:opacity-30"
                      >
                        <Icon name="chevronDown" size={14} />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-3 px-1 text-xs text-gray-500">Higher roles come first. Members get everything their roles allow.</p>
        </div>

        {/* The selected role. */}
        {selected && draft && (
          <div className="min-w-0 flex-1 space-y-5 p-5">
            {!canEdit && (
              <p className="rounded-lg bg-ink-700/60 px-3 py-2 text-sm text-gray-300">
                You can only change roles below your own.
              </p>
            )}
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">Role name</span>
              <input
                value={draft.name}
                maxLength={32}
                disabled={!canEdit || selected.isDefault}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                className="input disabled:opacity-60"
              />
            </label>
            {selected.isDefault && <p className="-mt-4 text-xs text-gray-500">Everyone in the server has this role.</p>}

            {!selected.isDefault && (
              <fieldset disabled={!canEdit}>
                <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Colour</legend>
                <div className="flex flex-wrap items-center gap-2">
                  <ColorChoice label="No colour" checked={!draft.color} onChange={() => setDraft((d) => ({ ...d, color: null }))} />
                  {ROLE_COLORS.map((c) => (
                    <ColorChoice key={c} color={c} label={c} checked={draft.color === c} onChange={() => setDraft((d) => ({ ...d, color: c }))} />
                  ))}
                  <label className="flex items-center gap-1.5 text-xs text-gray-400">
                    <input
                      type="color"
                      aria-label="Custom colour"
                      value={draft.color || '#8d8d8d'}
                      onChange={(e) => setDraft((d) => ({ ...d, color: e.target.value }))}
                      className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0 disabled:cursor-default"
                    />
                    Custom
                  </label>
                </div>
              </fieldset>
            )}

            <fieldset>
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Permissions</legend>
              <div className="space-y-3">
                {PERMISSION_GROUPS.map((g) => (
                  <div key={g.label} role="group" aria-label={g.label}>
                    <div className="mb-1 text-xs text-gray-500">{g.label}</div>
                    <div className="divide-y divide-ink-500/30 rounded-lg ring-1 ring-ink-500/40">
                      {g.actions.map((a) => {
                        const mine = holds(a.key);
                        return (
                          <label key={a.key} className="flex items-center justify-between gap-3 px-3 py-2" title={canEdit && !mine ? "You don't have this permission yourself" : undefined}>
                            <span className={`text-sm ${canEdit && mine ? 'text-gray-200' : 'text-gray-500'}`}>{a.label}</span>
                            <input
                              type="checkbox"
                              checked={draft.permissions.includes(a.key)}
                              disabled={!canEdit || !mine}
                              onChange={() => togglePermission(a.key)}
                              className="h-4 w-4 accent-brand"
                            />
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </fieldset>

            {!selected.isDefault && (
              <section aria-label="Members with this role">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Members — {holders.length}</h3>
                {holders.length === 0 && <p className="text-sm text-gray-500">Nobody has this role yet.</p>}
                <ul className="space-y-1">
                  {holders.map((name) => {
                    const m = members.find((x) => x.username === name);
                    return (
                      <li key={name} className="flex items-center justify-between rounded px-2 py-1 text-sm text-gray-200 hover:bg-ink-700/40">
                        <span className="truncate">{name}</span>
                        {canEdit && (!m || changeable(m)) && (
                          <button
                            onClick={() => setHolder(name, false)}
                            aria-label={`Remove ${name} from ${selected.name}`}
                            className="text-xs text-gray-400 hover:text-danger disabled:opacity-60"
                          >
                            Remove
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {canEdit && addable.length > 0 && (
                  <div className="mt-2 flex gap-2">
                    <select aria-label="Member to add" value={addWho} onChange={(e) => setAddWho(e.target.value)} className="input flex-1">
                      <option value="">Add a member…</option>
                      {addable.map((m) => <option key={m.username} value={m.username}>{m.username}</option>)}
                    </select>
                    <button
                      onClick={() => setHolder(addWho, true)}
                      disabled={busy || !addWho}
                      className="rounded-lg bg-ink-600 px-3 py-2 text-sm font-medium text-fg hover:bg-ink-500 disabled:opacity-60"
                    >
                      Add
                    </button>
                  </div>
                )}
              </section>
            )}

            {error && <div role="alert" className="text-sm text-danger">{error}</div>}

            {canEdit && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-500/40 pt-4">
                {!selected.isDefault &&
                  (confirmDelete ? (
                    <span className="flex items-center gap-2 text-sm text-gray-200">
                      Delete {selected.name}?
                      <button onClick={() => setConfirmDelete(false)} disabled={busy} className="rounded px-2 py-1 text-gray-300 hover:text-fg">Cancel</button>
                      <button onClick={remove} disabled={busy} className="rounded-lg bg-danger px-3 py-1.5 font-semibold text-ink-900 disabled:opacity-60">Delete role</button>
                    </span>
                  ) : (
                    <button onClick={() => setConfirmDelete(true)} className="flex items-center gap-1.5 text-sm font-medium text-danger hover:underline">
                      <Icon name="trash" size={15} /> Delete role
                    </button>
                  ))}
                <span className="ml-auto flex gap-2">
                  <button onClick={() => setDraft(draftOf(selected))} disabled={!dirty || busy} className="rounded-lg px-3 py-2 text-sm text-gray-300 hover:text-fg disabled:opacity-40">
                    Reset
                  </button>
                  <button
                    onClick={save}
                    disabled={!dirty || busy || !draft.name.trim()}
                    className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
                  >
                    {busy ? 'Saving…' : 'Save changes'}
                  </button>
                </span>
              </div>
            )}
          </div>
        )}
    </div>
  );
}

// One colour swatch: a radio, so arrow keys move between them.
function ColorChoice({ color, label, checked, onChange }) {
  return (
    <label className="relative cursor-pointer" title={label}>
      <input type="radio" name="role-color" checked={checked} onChange={onChange} aria-label={label} className="peer sr-only" />
      <span
        aria-hidden="true"
        className="block h-7 w-7 rounded-full ring-1 ring-ink-500 peer-checked:ring-2 peer-checked:ring-fg peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-brand"
        style={{ background: color || 'transparent' }}
      >
        {!color && <Icon name="ban" size={14} className="m-[6px] text-gray-400" />}
      </span>
    </label>
  );
}
