import { useEffect, useId, useRef, useState } from 'react';
import * as api from '../api.js';
import Icon from './Icon.jsx';
import Modal from './Modal.jsx';
import SettingRow from './settings/SettingRow.jsx';
import Switch from './settings/Switch.jsx';
import { MAX_CHANNEL_NAME, normalizeChannelName } from '../util.js';

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
// `placement` (P3-25b): { categories, category, canUp, canDown, onMove(delta),
// onMoveTo(categoryId|null) } — where the channel sits in the list. Moves apply
// at once (not on Save).
// `category` (P3-25d): { id, name } — edit a category's access instead of a
// channel's (no topic, 18+, place or delete; adds "Apply to all channels").
// Slow mode choices (P3-26d), in seconds.
const SLOWMODE_CHOICES = [[0, 'Off'], [5, '5 seconds'], [30, '30 seconds'], [60, '1 minute'], [300, '5 minutes']];

export default function ChannelSettingsDialog({ space, channel, meta, roles = [], isOwner = false, myPosition = 0, placement = null, category = null, onClose, onSaved }) {
  const [cells, setCells] = useState(null); // roleId -> { view, post } cells; null while loading
  const [nsfw, setNsfw] = useState(!!meta?.nsfw); // Age-restricted (18+), text channels
  const [topic, setTopic] = useState(meta?.topic || ''); // P3-20a
  const [name, setName] = useState(channel || ''); // P6-03
  const newName = normalizeChannelName(name);
  const [slowmode, setSlowmode] = useState(meta?.slowmode || 0); // P3-26d: seconds
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [applied, setApplied] = useState(null); // how many channels "Apply to all" changed
  // Voice channels only gate visibility/joining — "who can post" doesn't apply.
  const isVoice = meta?.type === 'voice';
  const bodyRef = useRef(null); // focus starts on the first setting, not the header's Close
  // @everyone first, then the others highest first.
  const ordered = [...roles.filter((r) => r.isDefault), ...roles.filter((r) => !r.isDefault)];
  const editable = (r) => r.isDefault || isOwner || r.position < myPosition;

  useEffect(() => {
    let live = true;
    (category ? api.getCategoryOverrides(space, category.id) : api.getChannelOverrides(space, channel))
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
  }, [space, channel, category?.id]);

  const cell = (roleId, field) => cells?.[roleId]?.[field] ?? '';
  const setCell = (roleId, field, v) => setCells((c) => ({ ...c, [roleId]: { view: '', post: '', ...c?.[roleId], [field]: v } }));

  async function save() {
    if (!category && !newName) return setError('A channel name is required');
    setBusy(true);
    setError('');
    try {
      const overrides = ordered.filter(editable).map((r) => ({
        roleId: r.id,
        view: fromCell(cell(r.id, 'view')),
        post: isVoice ? null : fromCell(cell(r.id, 'post')),
      }));
      if (category) {
        await api.setCategoryOverrides(space, category.id, overrides);
      } else {
        await api.setChannelOverrides(space, channel, overrides);
        if (!isVoice && nsfw !== !!meta?.nsfw) await api.setChannelNsfw(space, channel, nsfw);
        if (!isVoice && slowmode !== (meta?.slowmode || 0)) await api.setChannelSlowmode(space, channel, slowmode);
        if (topic.trim() !== (meta?.topic || '')) await api.setChannelTopic(space, channel, topic.trim());
        // The name last: the calls above use the current one.
        if (newName !== channel) await api.renameChannel(space, channel, newName);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message || 'Could not save channel settings');
      setBusy(false);
    }
  }

  // Save, then copy onto every channel in the category (P3-25d).
  async function applyToAll() {
    setBusy(true);
    setError('');
    try {
      const overrides = ordered.filter(editable).map((r) => ({ roleId: r.id, view: fromCell(cell(r.id, 'view')), post: fromCell(cell(r.id, 'post')) }));
      await api.setCategoryOverrides(space, category.id, overrides);
      const { changed } = await api.applyCategoryOverrides(space, category.id);
      setApplied(changed);
      setConfirmApply(false);
      onSaved();
    } catch (err) {
      setError(err.message || 'Could not apply the access');
    } finally {
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

  // Tabs (P5-05): Overview (topic, place, 18+, delete), Permissions (the role
  // table) and, for text channels, Moderation (slow mode). A category edits
  // only its access, so it has no tabs. Every tab stays mounted; one Save.
  const tabs = category ? [] : [['overview', 'Overview'], ['permissions', 'Permissions'], ...(isVoice ? [] : [['moderation', 'Moderation']])];
  const [tab, setTab] = useState('overview');
  const shown = (id) => category ? id === 'permissions' : tab === id;
  const tabsId = useId();
  function onTabKey(e) {
    const ids = tabs.map(([id]) => id);
    const i = ids.indexOf(tab);
    const next = { ArrowRight: ids[(i + 1) % ids.length], ArrowLeft: ids[(i + ids.length - 1) % ids.length], Home: ids[0], End: ids[ids.length - 1] }[e.key];
    if (!next) return;
    e.preventDefault();
    setTab(next);
    document.getElementById(`${tabsId}-tab-${next}`)?.focus();
  }
  const panelProps = (id) => ({
    role: category ? undefined : 'tabpanel',
    id: `${tabsId}-panel-${id}`,
    'aria-labelledby': category ? undefined : `${tabsId}-tab-${id}`,
    hidden: !shown(id),
    className: 'space-y-4',
  });
  const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400';

  return (
    <Modal
      onClose={onClose}
      initialFocusRef={bodyRef}
      panelClassName="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl bg-ink-800 shadow-2xl ring-1 ring-ink-500/50"
    >
      <Modal.Header title={category ? `${category.name} permissions` : `${isVoice ? channel : `#${channel}`} settings`} onClose={onClose} />

      {tabs.length > 0 && (
        <div role="tablist" aria-label="Channel settings sections" className="flex shrink-0 gap-1 border-b border-ink-500/40 px-4">
          {tabs.map(([id, name]) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`${tabsId}-tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`${tabsId}-panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
              onKeyDown={onTabKey}
              className={`tap-row -mb-px border-b-2 px-3 py-2.5 text-sm transition ${
                tab === id ? 'border-brand-hi text-fg' : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {/* A fixed height, so switching tabs doesn't resize and re-centre the dialog. */}
      <div ref={bodyRef} className={`overflow-y-auto p-6 ${category ? '' : 'h-[min(28rem,65vh)]'}`}>
        {!category && (
          <section {...panelProps('overview')}>
            <div>
              <label htmlFor="channel-name" className={label}>Name</label>
              <input
                id="channel-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={MAX_CHANNEL_NAME}
                autoComplete="off"
                spellCheck={false}
                className="input"
              />
              {newName && newName !== name.trim() && (
                <p className="mt-1 text-xs text-gray-500" aria-live="polite">
                  Saved as {isVoice ? newName : `#${newName}`}: lowercase, with dashes for spaces.
                </p>
              )}
            </div>
            <div>
              <label htmlFor="channel-topic" className={label}>Topic</label>
              <textarea
                id="channel-topic"
                rows={2}
                maxLength={300}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="What’s this channel for?"
                className="input resize-y"
              />
              <p className="mt-0.5 text-right text-xs text-gray-500" aria-live="polite">{topic.length}/300</p>
            </div>
            {placement && (
              <div role="group" aria-label="Place in the channel list">
                <label htmlFor="channel-category" className={label}>Category</label>
                <select
                  id="channel-category"
                  value={placement.category ?? ''}
                  onChange={(e) => placement.onMoveTo(e.target.value === '' ? null : Number(e.target.value))}
                  className="input"
                >
                  <option value="">No category (top of the list)</option>
                  {placement.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <div className="mt-2 flex gap-2">
                  <button type="button" disabled={!placement.canUp} onClick={() => placement.onMove(-1)} className="rounded-lg bg-ink-600 px-3 py-1.5 text-sm text-gray-200 transition hover:bg-ink-500 disabled:opacity-40">
                    Move channel up
                  </button>
                  <button type="button" disabled={!placement.canDown} onClick={() => placement.onMove(1)} className="rounded-lg bg-ink-600 px-3 py-1.5 text-sm text-gray-200 transition hover:bg-ink-500 disabled:opacity-40">
                    Move channel down
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-500">Moves happen right away. You can also drag channels in the list.</p>
              </div>
            )}
            {!isVoice && (
              <SettingRow label="Age-restricted (18+)" description="Marks the channel 18+. If the instance allows it, /imagine here isn’t filtered.">
                <Switch label="Age-restricted (18+)" checked={nsfw} onChange={setNsfw} />
              </SettingRow>
            )}
            <section aria-label="Danger zone" className="rounded-xl p-4 ring-1 ring-danger/40">
              {!confirmDelete ? (
                <button onClick={() => setConfirmDelete(true)} className="flex items-center gap-2 text-sm font-medium text-danger transition hover:underline">
                  <Icon name="trash" size={15} /> Delete channel
                </button>
              ) : (
                <div>
                  <p className="text-sm text-gray-200">
                    Delete <span className="font-semibold">{isVoice ? channel : `#${channel}`}</span>? This
                    permanently removes the channel{isVoice ? '' : ' and every message in it'}. This can’t be
                    undone.
                  </p>
                  <div className="mt-3 flex justify-end gap-2">
                    <button onClick={() => setConfirmDelete(false)} disabled={busy} className="rounded-lg px-3 py-1.5 text-sm text-gray-300 transition hover:text-fg">
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
            </section>
          </section>
        )}

        <section {...panelProps('permissions')}>
          {category && (
            <p className="text-sm text-gray-400">
              Channels created in this category, or moved into it, start with this access. Channels already in it aren’t changed unless you use
              {' '}<strong>Apply to all channels</strong>.
            </p>
          )}
          <p className="text-sm text-gray-400">
            {category ? 'Who can see and post in its channels, by role.' : isVoice
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
          {category && (
            <div className="border-t border-ink-500/40 pt-4">
              {applied !== null && <p role="status" className="mb-2 text-sm text-online">Applied to {applied} channel{applied === 1 ? '' : 's'}.</p>}
              {!confirmApply ? (
                <button onClick={() => setConfirmApply(true)} disabled={cells === null} className="text-sm font-medium text-brand-hi transition hover:underline disabled:opacity-50">
                  Apply to all channels in {category.name}…
                </button>
              ) : (
                <div className="rounded-lg bg-ink-900/60 p-3 ring-1 ring-ink-500/40">
                  <p className="text-sm text-gray-200">
                    Replace the access of every channel in <span className="font-semibold">{category.name}</span> with this? Their own settings are
                    overwritten.
                  </p>
                  <div className="mt-3 flex justify-end gap-2">
                    <button onClick={() => setConfirmApply(false)} disabled={busy} className="rounded-lg px-3 py-1.5 text-sm text-gray-300 transition hover:text-fg">
                      Cancel
                    </button>
                    <button onClick={applyToAll} disabled={busy} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60">
                      {busy ? 'Applying…' : 'Apply to all'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {!category && !isVoice && (
          <section {...panelProps('moderation')}>
            <div className="flex items-start gap-3 text-sm text-gray-200">
              <div className="flex-1">
                <label htmlFor="channel-slowmode">Slow mode</label>
                <span className="mt-0.5 block text-xs text-gray-500">
                  How long each person waits between messages here (and in its threads). Moderators aren’t limited.
                </span>
              </div>
              <select id="channel-slowmode" value={slowmode} onChange={(e) => setSlowmode(Number(e.target.value))} className="input w-auto">
                {SLOWMODE_CHOICES.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
              </select>
            </div>
          </section>
        )}
        {error && <div role="alert" className="mt-4 text-sm text-danger">{error}</div>}
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
