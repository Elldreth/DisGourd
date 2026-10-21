import { useEffect, useState } from 'react';
import SettingRow from './settings/SettingRow.jsx';
import Switch from './settings/Switch.jsx';
import * as api from '../api.js';
import Icon from './Icon.jsx';
import { copyText } from '../util.js';

const MODES = [
  { v: 'open', label: 'Open — anyone can sign up' },
  { v: 'invite', label: 'Invite only — with an invite link or a sign-up code' }, // 'code' before P14-01
  { v: 'closed', label: 'Closed — no new accounts' },
];
// P14-02: whose server invites can also create an account.
const WHO = [
  { v: 'site_admins', label: 'Site admins only', hint: 'Only invites made by a site admin bring in new people. Everyone else’s invites work for people who already have an account.' },
  { v: 'server_admins', label: 'Server owners and admins', hint: 'Invites made by the owner or an admin of that server bring in new people.' },
  { v: 'inviters', label: 'Anyone who can invite', hint: 'Any invite a server’s roles allow brings in new people. Pair it with “Require a confirmed email” (Site admin › Email).' },
];

function codeStatus(c) {
  if (c.revokedAt) return { label: 'revoked', cls: 'text-danger' };
  if (c.expiresAt && Date.now() > c.expiresAt) return { label: 'expired', cls: 'text-gray-500' };
  if (c.maxUses != null && c.uses >= c.maxUses) return { label: 'used up', cls: 'text-gray-500' };
  return { label: 'active', cls: 'text-online' };
}

// Site-admin panel: control how people can register on this instance.
export default function RegistrationAdmin() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [days, setDays] = useState('');
  const [newAdmin, setNewAdmin] = useState('');

  async function load() {
    try {
      setData(await api.getAdminRegistration());
    } catch (err) {
      setError(err.message || 'Could not load registration settings');
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function changeLinkPreviews(enabled) {
    setData((d) => ({ ...d, linkPreviews: enabled }));
    try {
      await api.setLinkPreviews(enabled);
    } catch (err) {
      setError(err.message || 'Could not change link previews');
      load();
    }
  }

  async function changeMode(mode) {
    setData((d) => ({ ...d, mode }));
    try {
      await api.setRegistrationMode(mode);
    } catch (err) {
      setError(err.message || 'Could not change mode');
      load();
    }
  }

  // P14-02: the Closed switch and "who can bring in new people".
  async function changeSetting(patch) {
    setData((d) => ({ ...d, ...patch }));
    try {
      await api.setRegistrationSettings(patch);
    } catch (err) {
      setError(err.message || 'Could not change that');
      load();
    }
  }

  async function mint() {
    setError('');
    try {
      await api.createRegCode({
        maxUses: maxUses ? parseInt(maxUses, 10) : undefined,
        expiresInDays: days ? parseInt(days, 10) : undefined,
      });
      setMaxUses('');
      setDays('');
      load();
    } catch (err) {
      setError(err.message || 'Could not create code');
    }
  }

  async function copy(code) {
    if (await copyText(code)) {
      setCopied(code);
      setTimeout(() => setCopied(''), 1500);
    }
  }

  async function revoke(id) {
    await api.revokeRegCode(id).catch(() => {});
    load();
  }

  async function addAdmin() {
    const name = newAdmin.trim();
    if (!name) return;
    setError('');
    try {
      await api.setSiteAdmin(name, true);
      setNewAdmin('');
      load();
    } catch (err) {
      setError(err.message || 'Could not add admin');
    }
  }
  async function removeAdmin(name) {
    try {
      await api.setSiteAdmin(name, false);
      load();
    } catch (err) {
      setError(err.message || 'Could not remove admin');
    }
  }

  if (!data) {
    return <div className="text-sm text-gray-500">{error || 'Loading…'}</div>;
  }

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">
          Who can create an account
        </span>
        <select value={data.mode} onChange={(e) => changeMode(e.target.value)} className="input">
          {MODES.map((m) => (
            <option key={m.v} value={m.v}>{m.label}</option>
          ))}
        </select>
      </label>

      {data.mode === 'closed' && (
        <SettingRow
          className="rounded-lg bg-ink-900/60 px-3"
          label="Invite links still let people sign up"
          description="Closed then means “no sign-up without an invite link”. Sign-up codes and open sign-up stay off."
        >
          <Switch label="Invite links still let people sign up" checked={!!data.closedAllowsInvites} onChange={(on) => changeSetting({ closedAllowsInvites: on })} />
        </SettingRow>
      )}

      {(data.mode !== 'closed' || data.closedAllowsInvites) && (
        <div>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">
              Who can bring in new people with their invites
            </span>
            <select
              value={data.invitesCreateAccounts || 'site_admins'}
              onChange={(e) => changeSetting({ invitesCreateAccounts: e.target.value })}
              aria-describedby="who-invites-hint"
              className="input"
            >
              {WHO.map((w) => (
                <option key={w.v} value={w.v}>{w.label}</option>
              ))}
            </select>
          </label>
          <p id="who-invites-hint" className="mt-1 text-xs text-gray-500">
            {data.mode === 'open'
              ? 'Sign-up is open to anyone, so this only matters if you switch to Invite only or Closed.'
              : (WHO.find((w) => w.v === (data.invitesCreateAccounts || 'site_admins')) || WHO[0]).hint}
          </p>
        </div>
      )}

      {data.mode === 'invite' && (
        <div className="rounded-lg bg-ink-900/60 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Sign-up codes</div>
          <p className="mb-2 text-xs text-gray-500">For someone without a server invite: they type it when creating an account.</p>
          {data.envCodeActive && (
            <p className="mb-2 text-xs text-gray-500">A shared code from the server config is also accepted.</p>
          )}
          <div className="mb-3 space-y-1">
            {data.codes.length === 0 && <p className="text-sm text-gray-500">No codes yet.</p>}
            {data.codes.map((c) => {
              const st = codeStatus(c);
              return (
                <div key={c.id} className="flex items-center gap-2 rounded-sm bg-ink-800 px-2 py-1.5 text-sm">
                  <code className="font-mono text-brand-hi">{c.code}</code>
                  <span className="text-xs text-gray-500">
                    {c.uses}/{c.maxUses ?? '∞'} used{c.expiresAt ? ` · exp ${new Date(c.expiresAt).toLocaleDateString()}` : ''}
                  </span>
                  <span className={`text-xs ${st.cls}`}>{st.label}</span>
                  <div className="ml-auto flex items-center gap-1">
                    <button onClick={() => copy(c.code)} className="rounded-sm px-1.5 py-0.5 text-xs text-gray-300 hover:bg-ink-600 hover:text-fg">
                      {copied === c.code ? 'Copied' : 'Copy'}
                    </button>
                    {!c.revokedAt && (
                      <button onClick={() => revoke(c.id)} title="Revoke" className="rounded-sm px-1.5 py-0.5 text-xs text-gray-400 hover:bg-ink-600 hover:text-danger">
                        Revoke
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-gray-400">
              Max uses
              <input value={maxUses} onChange={(e) => setMaxUses(e.target.value.replace(/\D/g, ''))} placeholder="∞" className="input mt-0.5 w-20" />
            </label>
            <label className="text-xs text-gray-400">
              Expires (days)
              <input value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} placeholder="never" className="input mt-0.5 w-24" />
            </label>
            <button onClick={mint} className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-hover">
              Create code
            </button>
          </div>
        </div>
      )}

      <div className="rounded-lg bg-ink-900/60 p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Site admins</div>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {data.admins.map((a) => (
            <span key={a} className="flex items-center gap-1 rounded-full bg-ink-700 px-2 py-0.5 text-xs">
              {a}
              <button onClick={() => removeAdmin(a)} title="Remove" aria-label={`Remove ${a} as an admin`} className="text-gray-400 hover:text-danger"><Icon name="x" size={12} strokeWidth={2.2} /></button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={newAdmin}
            onChange={(e) => setNewAdmin(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addAdmin()}
            placeholder="username to promote"
            aria-label="Username to make an admin"
            className="input flex-1"
          />
          <button onClick={addAdmin} className="rounded-lg bg-ink-600 px-3 py-2 text-sm font-semibold text-gray-200 hover:bg-ink-500">
            Add
          </button>
        </div>
      </div>

      <SettingRow
        className="rounded-lg bg-ink-900/60 px-3"
        label="Link previews"
        description="Show a card under links in messages. The server fetches each page safely; the card’s image loads from that site in each viewer’s browser."
      >
        <Switch label="Link previews" checked={data.linkPreviews !== false} onChange={changeLinkPreviews} />
      </SettingRow>

      {error && <div className="text-sm text-danger">{error}</div>}
    </div>
  );
}
