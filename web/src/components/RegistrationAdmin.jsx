import { useEffect, useState } from 'react';
import * as api from '../api.js';

const MODES = [
  { v: 'open', label: 'Open — anyone can sign up' },
  { v: 'code', label: 'Code required — only with an invite code' },
  { v: 'closed', label: 'Closed — no new accounts' },
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

  async function changeMode(mode) {
    setData((d) => ({ ...d, mode }));
    try {
      await api.setRegistrationMode(mode);
    } catch (err) {
      setError(err.message || 'Could not change mode');
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
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      setTimeout(() => setCopied(''), 1500);
    } catch {
      /* clipboard may be blocked */
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

      {data.mode === 'code' && (
        <div className="rounded-lg bg-ink-900/60 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Invite codes</div>
          {data.envCodeActive && (
            <p className="mb-2 text-xs text-gray-500">A shared code from the server config is also accepted.</p>
          )}
          <div className="mb-3 space-y-1">
            {data.codes.length === 0 && <p className="text-sm text-gray-500">No codes yet.</p>}
            {data.codes.map((c) => {
              const st = codeStatus(c);
              return (
                <div key={c.id} className="flex items-center gap-2 rounded bg-ink-800 px-2 py-1.5 text-sm">
                  <code className="font-mono text-brand">{c.code}</code>
                  <span className="text-xs text-gray-500">
                    {c.uses}/{c.maxUses ?? '∞'} used{c.expiresAt ? ` · exp ${new Date(c.expiresAt).toLocaleDateString()}` : ''}
                  </span>
                  <span className={`text-xs ${st.cls}`}>{st.label}</span>
                  <div className="ml-auto flex items-center gap-1">
                    <button onClick={() => copy(c.code)} className="rounded px-1.5 py-0.5 text-xs text-gray-300 hover:bg-ink-600 hover:text-white">
                      {copied === c.code ? 'Copied' : 'Copy'}
                    </button>
                    {!c.revokedAt && (
                      <button onClick={() => revoke(c.id)} title="Revoke" className="rounded px-1.5 py-0.5 text-xs text-gray-400 hover:bg-ink-600 hover:text-danger">
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
              <button onClick={() => removeAdmin(a)} title="Remove" className="text-gray-400 hover:text-danger">✕</button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={newAdmin}
            onChange={(e) => setNewAdmin(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addAdmin()}
            placeholder="username to promote"
            className="input flex-1"
          />
          <button onClick={addAdmin} className="rounded-lg bg-ink-600 px-3 py-2 text-sm font-semibold text-gray-200 hover:bg-ink-500">
            Add
          </button>
        </div>
      </div>

      {error && <div className="text-sm text-danger">{error}</div>}
    </div>
  );
}
