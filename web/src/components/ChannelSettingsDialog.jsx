import { useEffect, useRef, useState } from 'react';
import * as api from '../api.js';
import Icon from './Icon.jsx';
import Modal from './Modal.jsx';

// An override cell: '' default, '1' allow, '0' deny.
const CHOICES = [
  { v: '', label: 'Default' },
  { v: '1', label: 'Allow' },
  { v: '0', label: 'Deny' },
];
const toCell = (v) => (v === 1 ? '1' : v === 0 ? '0' : '');
const fromCell = (c) => (c === '1' ? 1 : c === '0' ? 0 : null);

// Manager panel for one channel: per-role access (P2-21c) — for each role,
// View and Post each Default / Allow / Deny — and deleting the channel. Roles
// at or above your own are shown but locked (the owner: none locked).
export default function ChannelSettingsDialog({ space, channel, meta, roles = [], isOwner = false, myPosition = 0, onClose, onSaved }) {
  const [cells, setCells] = useState(null); // roleId -> { view, post } cells; null while loading
  const [nsfw, setNsfw] = useState(!!meta?.nsfw); // Age-restricted (18+), text channels
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Voice channels only gate visibility/joining — "who can post" doesn't apply.
  const isVoice = meta?.type === 'voice';
  const bodyRef = useRef(null); // focus starts on the first setting, not the header's Close
  // @everyone first, then the others highest first.
  const ordered = [...roles.filter((r) => r.isDefault), ...roles.filter((r) => !r.isDefault)];
  const editable = (r) => r.isDefault || isOwner || r.position < myPosition;

  useEffect(() => {
    let live = true;
    api
      .getChannelOverrides(space, channel)
      .then(({ overrides }) => {
        if (!live) return;
        const next = {};
        for (const o of overrides || []) next[o.roleId] = { view: toCell(o.view), post: toCell(o.post) };
        setCells(next);
      })
      .catch((err) => {
        if (!live) return;
        setCells({});
        setError(err.message || 'Could not load channel access');
      });
    return () => {
      live = false;
    };
  }, [space, channel]);

  const cell = (roleId, field) => cells?.[roleId]?.[field] ?? '';
  const setCell = (roleId, field, v) => setCells((c) => ({ ...c, [roleId]: { view: '', post: '', ...c?.[roleId], [field]: v } }));

  async function save() {
    setBusy(true);
    setError('');
    try {
      const overrides = ordered.filter(editable).map((r) => ({
        roleId: r.id,
        view: fromCell(cell(r.id, 'view')),
        post: isVoice ? null : fromCell(cell(r.id, 'post')),
      }));
      await api.setChannelOverrides(space, channel, overrides);
      if (!isVoice && nsfw !== !!meta?.nsfw) await api.setChannelNsfw(space, channel, nsfw);
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message || 'Could not save channel settings');
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError('');
    try {
      await api.deleteChannel(space, channel);
      onSaved(); // refresh the sidebar now; the gateway also switches you off it
      onClose();
    } catch (err) {
      setError(err.message || 'Could not delete the channel');
      setBusy(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      initialFocusRef={bodyRef}
      panelClassName="flex max-h-[90vh] w-full max-w-md flex-col rounded-xl bg-ink-800 shadow-2xl ring-1 ring-ink-500/50"
    >
      <div className="flex items-center justify-between border-b border-ink-500/40 px-6 py-4">
        <Modal.Title>{isVoice ? channel : `#${channel}`} settings</Modal.Title>
        <button onClick={onClose} className="text-sm text-gray-400 hover:text-fg">Close</button>
      </div>

      <div ref={bodyRef} className="space-y-3 overflow-y-auto p-6">
        <p className="text-sm text-gray-400">
          {isVoice
            ? 'Who can see and join this channel, by role.'
            : 'Who can see and post here, by role. Deny @everyone and allow a role for a private channel; deny posting for a read-only one.'}
        </p>
        {cells === null ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
                <th scope="col" className="pb-2 font-semibold">Role</th>
                <th scope="col" className="pb-2 font-semibold">{isVoice ? 'See & join' : 'View'}</th>
                {!isVoice && <th scope="col" className="pb-2 font-semibold">Post</th>}
              </tr>
            </thead>
            <tbody>
              {ordered.map((r) => {
                const locked = !editable(r);
                return (
                  <tr key={r.id} className="border-t border-ink-500/30">
                    <th scope="row" className="py-1.5 pr-2 text-left font-normal text-gray-200">
                      <span className="flex items-center gap-2">
                        <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-ink-500" style={{ background: r.color || 'transparent' }} />
                        <span className="truncate">{r.name}</span>
                      </span>
                    </th>
                    {(isVoice ? ['view'] : ['view', 'post']).map((field) => (
                      <td key={field} className="py-1.5 pr-2">
                        <select
                          aria-label={`${r.name}: ${field === 'post' ? 'post' : isVoice ? 'see and join' : 'view'}`}
                          value={cell(r.id, field)}
                          disabled={locked}
                          title={locked ? 'Only roles below your own can be changed' : undefined}
                          onChange={(e) => setCell(r.id, field, e.target.value)}
                          className="input py-1 disabled:opacity-50"
                        >
                          {CHOICES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
                        </select>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="text-xs text-gray-500">
          Default follows @everyone, whose default is allowed. If any of someone’s roles allows, they’re allowed; posting always needs viewing.
        </p>
        {!isVoice && (
          <label className="flex items-start gap-2 border-t border-ink-500/30 pt-3 text-sm text-gray-200">
            <input type="checkbox" checked={nsfw} onChange={(e) => setNsfw(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand" />
            <span>
              Age-restricted (18+)
              <span className="mt-0.5 block text-xs text-gray-500">
                Marks the channel 18+. If the instance allows it, /imagine here isn’t filtered.
              </span>
            </span>
          </label>
        )}
        {error && <div role="alert" className="text-sm text-danger">{error}</div>}
      </div>

      <div className="border-t border-ink-500/40 px-6 py-4">
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="flex items-center gap-2 text-sm font-medium text-danger transition hover:underline"
          >
            <Icon name="trash" size={15} /> Delete channel
          </button>
        ) : (
          <div className="rounded-lg bg-danger/10 p-3 ring-1 ring-danger/30">
            <p className="text-sm text-gray-200">
              Delete <span className="font-semibold">{isVoice ? channel : `#${channel}`}</span>? This
              permanently removes the channel{isVoice ? '' : ' and every message in it'}. This can’t be
              undone.
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={busy}
                className="rounded-lg px-3 py-1.5 text-sm text-gray-300 transition hover:text-fg"
              >
                Cancel
              </button>
              <button
                onClick={remove}
                disabled={busy}
                className="rounded-lg bg-danger px-3 py-1.5 text-sm font-semibold text-ink-900 transition hover:brightness-110 active:scale-95 disabled:opacity-60 disabled:active:scale-100"
              >
                {busy ? 'Deleting…' : 'Delete channel'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-ink-500/40 px-6 py-3">
        <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-gray-300 hover:text-fg">Cancel</button>
        <button
          onClick={save}
          disabled={busy || cells === null}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}
