import { useState } from 'react';
import * as api from '../api.js';

// First-run wizard, shown when the server has no accounts yet. The account it
// creates is the site admin (the server owner). It optionally spins up a first
// community so you land somewhere usable instead of an empty screen.
export default function SetupWizard({ onAuthed }) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [serverName, setServerName] = useState('My Community');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await api.register(username.trim(), password, email.trim());
      api.setToken(res.token);
      const name = serverName.trim();
      if (name) {
        // Best-effort: create the first server. Don't block finishing setup if it fails.
        await api.createSpace(name).catch(() => {});
      }
      onAuthed(res.token);
    } catch (err) {
      setError(err.message || 'Could not complete setup');
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-ink-900 p-4">
      <div className="w-full max-w-md rounded-2xl bg-ink-800 p-8 shadow-2xl ring-1 ring-ink-500/40">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-2xl font-bold">
            🥒
          </div>
          <h1 className="text-2xl font-bold">Set up your DisGourd server</h1>
          <p className="mt-1 text-sm text-gray-400">
            This is a brand-new server. Create the first account — it becomes the
            <span className="font-semibold text-gray-300"> owner &amp; site admin</span>.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <Field label="Admin username">
            <input
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="input"
              placeholder="your_name"
              autoComplete="username"
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              placeholder="you@example.com"
              autoComplete="email"
            />
          </Field>
          <Field label="Password" hint="At least 8 characters">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </Field>
          <Field label="First community name" hint="optional">
            <input
              value={serverName}
              onChange={(e) => setServerName(e.target.value)}
              className="input"
              placeholder="My Community"
            />
          </Field>

          {error && (
            <div className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">{error}</div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-brand px-4 py-2.5 font-semibold text-white transition hover:bg-brand-hover disabled:opacity-60"
          >
            {busy ? 'Setting up…' : 'Create admin account & finish setup'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-gray-500">
          Afterwards, control who can register (open / invite code / closed) in
          <span className="text-gray-400"> Settings → Registration &amp; access</span>.
        </p>
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</span>
        {hint && <span className="text-xs text-gray-500">{hint}</span>}
      </div>
      {children}
    </label>
  );
}
