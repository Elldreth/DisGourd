import { useState } from 'react';
import * as api from '../api.js';
import AuthShell, { Field } from './AuthShell.jsx';

// P12-02: when the server requires a confirmed email and this account has
// none, this is all the app shows: where the link went, send another, use a
// different address (with your password), check again, or sign out.
// `onUpdated(profile)` takes a fresh /me; `onSignOut()` signs out.
export default function ConfirmEmailGate({ profile, onUpdated, onSignOut }) {
  const [changing, setChanging] = useState(!profile?.email && !profile?.emailPending);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const pending = profile?.emailPending || null; // a link is out for this address
  const unconfirmed = !pending ? profile?.email || null : null; // an address, but no link out yet
  const waitingOn = pending || unconfirmed;

  async function run(fn) {
    setBusy(true);
    setError('');
    setNote('');
    try {
      await fn();
    } catch (err) {
      setError(err.message || 'That didn’t work');
    } finally {
      setBusy(false);
    }
  }

  const change = (e) => {
    e.preventDefault();
    run(async () => {
      const r = await api.changeEmail(email.trim(), password);
      onUpdated({ ...profile, ...r });
      setChanging(false);
      setPassword('');
      setNote(`We sent a link to ${r.emailPending || email.trim()}.`);
    });
  };
  const resend = () =>
    run(async () => {
      const r = await api.resendEmailLink();
      onUpdated({ ...profile, ...r });
      setNote(`A new link is on its way to ${r.emailPending || r.email}.`);
    });
  const checkAgain = () =>
    run(async () => {
      const me = await api.getMe();
      onUpdated(me);
      if (me.emailConfirmRequired) setNote('Not confirmed yet. Open the link in the email, then check again.');
    });

  const primary = 'w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-hover disabled:opacity-60';
  const quiet = 'w-full rounded-lg px-4 py-2 text-sm text-gray-300 transition hover:bg-ink-700';

  return (
    <AuthShell
      title="Confirm your email"
      subtitle={
        changing || !waitingOn
          ? 'This server needs a confirmed email address before you can use it.'
          : pending
            ? `This server needs a confirmed email address. We sent a link to ${pending}; open it to continue.`
            : `This server needs a confirmed email address, and ${unconfirmed} isn’t confirmed yet.`
      }
      pose="privacy"
    >
      {changing ? (
        <form onSubmit={change} className="space-y-4">
          <Field label="Email">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="input" placeholder="you@example.com" autoComplete="email" />
          </Field>
          <Field label="Your password">
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="input" autoComplete="current-password" />
          </Field>
          <button type="submit" disabled={busy} className={primary}>
            {busy ? 'Sending…' : 'Send confirmation link'}
          </button>
          {waitingOn && (
            <button type="button" onClick={() => setChanging(false)} className={quiet}>
              Cancel
            </button>
          )}
        </form>
      ) : (
        <div className="space-y-2">
          {pending ? (
            <>
              <button type="button" onClick={checkAgain} disabled={busy} className={primary}>
                I’ve opened the link
              </button>
              <button type="button" onClick={resend} disabled={busy} className={quiet}>
                Send a new link
              </button>
            </>
          ) : (
            <button type="button" onClick={resend} disabled={busy} className={primary}>
              Send a confirmation link
            </button>
          )}
          <button type="button" onClick={() => setChanging(true)} className={quiet}>
            Use a different address
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-center text-sm text-danger">
          {error}
        </p>
      )}
      {note && (
        <p role="status" className="mt-3 text-center text-sm text-gray-300">
          {note}
        </p>
      )}
      <button type="button" onClick={onSignOut} className="mt-4 w-full text-center text-sm text-gray-400 underline-offset-2 hover:text-fg hover:underline">
        Sign out
      </button>
    </AuthShell>
  );
}
