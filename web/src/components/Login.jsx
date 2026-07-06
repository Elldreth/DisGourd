import { useEffect, useState } from 'react';
import * as api from '../api.js';

export default function Login({ onAuthed }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [regMode, setRegMode] = useState('open'); // 'open' | 'code' | 'closed'
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getAuthInfo().then((r) => setRegMode(r.registration || 'open')).catch(() => {});
  }, []);

  const isRegister = mode === 'register';

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = isRegister
        ? await api.register(username.trim(), password, email.trim(), code.trim())
        : await api.login(username.trim(), password);
      api.setToken(res.token);
      onAuthed(res.token);
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
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
          <h1 className="text-2xl font-bold">Welcome to DisGourd</h1>
          <p className="mt-1 text-sm text-gray-400">
            {isRegister ? 'Create an account to get started' : 'Sign in to continue'}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <Field label="Username">
            <input
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="input"
              placeholder="your_name"
              autoComplete="username"
            />
          </Field>

          {isRegister && (
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
          )}

          <Field label="Password" hint={isRegister ? 'At least 8 characters' : undefined}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              placeholder="••••••••"
              autoComplete={isRegister ? 'new-password' : 'current-password'}
            />
          </Field>

          {isRegister && regMode === 'code' && (
            <Field label="Registration code" hint="Ask the server owner">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="input"
                placeholder="Enter the code you were given"
              />
            </Field>
          )}

          {error && (
            <div className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">{error}</div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-brand px-4 py-2.5 font-semibold text-white transition hover:bg-brand-hover disabled:opacity-60"
          >
            {busy ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}
          </button>
        </form>

        {regMode === 'closed' && !isRegister ? (
          <p className="mt-6 text-center text-sm text-gray-500">
            This server isn’t accepting new accounts.
          </p>
        ) : (
          <p className="mt-6 text-center text-sm text-gray-400">
            {isRegister ? 'Already have an account?' : 'Need an account?'}{' '}
            <button
              className="font-semibold text-brand hover:underline"
              onClick={() => {
                setMode(isRegister ? 'login' : 'register');
                setError('');
              }}
            >
              {isRegister ? 'Sign in' : 'Register'}
            </button>
          </p>
        )}
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
