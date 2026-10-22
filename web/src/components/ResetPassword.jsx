import { useState } from 'react';
import * as api from '../api.js';
import AuthShell, { Field } from './AuthShell.jsx';

// What opening a password reset link shows (P12-03): a new password, twice.
// It signs every device out, then this one in; `onDone(token)` enters the app
// with the new token, `onDone('')` goes back (to sign in, or to the app when
// this tab is `signedIn`).
export default function ResetPassword({ token, signedIn = false, onDone }) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState({ step: 'form' }); // form | suspended | dead

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (password !== again) return setError('The two passwords don’t match');
    setBusy(true);
    try {
      const r = await api.resetPassword(token, password);
      if (r.suspended) return setState({ step: 'suspended' });
      api.setToken(r.token);
      onDone(r.token);
    } catch (err) {
      if (err.code === 'TOKEN_INVALID') setState({ step: 'dead', message: err.message });
      else setError(err.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const back = signedIn ? 'Back to DisGourd' : 'Go to sign in';
  const button = 'w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-hover disabled:opacity-60';

  if (state.step === 'dead') {
    return (
      <AuthShell title="That link didn’t work" subtitle={state.message} pose="confused">
        <p className="mb-4 text-center text-sm text-gray-400">Reset links work once and expire. Ask for a new one with “Forgot password?” on the sign-in page.</p>
        <button type="button" autoFocus onClick={() => onDone('')} className={button}>
          {back}
        </button>
      </AuthShell>
    );
  }
  if (state.step === 'suspended') {
    return (
      <AuthShell title="Password changed" subtitle="Your password is changed, but this account is suspended, so it can’t sign in yet." pose="confused">
        <button type="button" autoFocus onClick={() => onDone('')} className={button}>
          {back}
        </button>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Choose a new password" subtitle="At least 8 characters. Setting it signs you out on every device, then signs you in here.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="New password">
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input"
            autoComplete="new-password"
            required
          />
        </Field>
        <Field label="New password again">
          <input
            type="password"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
            className="input"
            autoComplete="new-password"
            required
          />
        </Field>
        {error && <div className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">{error}</div>}
        <button type="submit" disabled={busy} className={button}>
          {busy ? 'Please wait…' : 'Set new password'}
        </button>
        <button type="button" onClick={() => onDone('')} className="w-full rounded-lg px-4 py-2 text-sm text-gray-300 hover:bg-ink-700">
          Cancel
        </button>
      </form>
    </AuthShell>
  );
}
