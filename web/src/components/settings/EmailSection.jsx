import { useId, useState } from 'react';
import * as api from '../../api.js';

// Settings › My account › Email (P12-02): your address, whether it's
// confirmed, and add / change / remove it (always with your password). A new
// address only replaces the old one once the link sent to it is used, so a
// typo can't lock you out. `onUpdated(fields)` merges the answer into the profile.
export default function EmailSection({ profile, onUpdated }) {
  const [mode, setMode] = useState(null); // null | 'change' | 'remove'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const emailId = useId();
  const passId = useId();
  const current = profile?.email || null;
  const pending = profile?.emailPending || null;

  function open(next) {
    setMode(next);
    setEmail('');
    setPassword('');
    setError('');
    setNote('');
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = mode === 'remove' ? await api.removeEmail(password) : await api.changeEmail(email.trim(), password);
      onUpdated?.({ email: r.email, emailVerified: r.emailVerified, emailPending: r.emailPending });
      setNote(
        mode === 'remove'
          ? 'Email removed.'
          : r.sent
            ? `We sent a link to ${r.emailPending || email.trim()}. Your address changes once you open it.`
            : 'Saved. It can’t be confirmed until this server can send email.'
      );
      setMode(null);
    } catch (err) {
      setError(err.message || 'That didn’t work');
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError('');
    setNote('');
    try {
      const r = await api.resendEmailLink();
      onUpdated?.({ email: r.email, emailVerified: r.emailVerified, emailPending: r.emailPending });
      setNote(`A new link is on its way to ${r.emailPending || current}.`);
    } catch (err) {
      setError(err.message || 'Couldn’t send a new link');
    }
  }

  const small = 'tap rounded-lg bg-ink-600 px-3 py-1.5 text-sm text-gray-200 transition hover:bg-ink-500';

  return (
    <section aria-labelledby="email-heading" className="rounded-xl bg-ink-900/60 p-4">
      <h3 id="email-heading" className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        Email
      </h3>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-sm">
          {current ? (
            <>
              <span className="text-gray-200">{current}</span>{' '}
              {profile?.emailVerified ? (
                <span className="ml-1 rounded-full bg-online/15 px-2 py-0.5 text-xs text-online">Confirmed</span>
              ) : (
                <span className="ml-1 rounded-full bg-ink-700 px-2 py-0.5 text-xs text-gray-300">Not confirmed</span>
              )}
            </>
          ) : (
            <span className="text-gray-400">No email yet. Add one so you can reset your password.</span>
          )}
        </span>
        {mode === null && (
          <>
            <button type="button" onClick={() => open('change')} className={small}>
              {current ? 'Change' : 'Add email'}
            </button>
            {current && (
              <button type="button" onClick={() => open('remove')} className="tap rounded-lg px-3 py-1.5 text-sm text-gray-300 transition hover:bg-ink-700 hover:text-fg">
                Remove
              </button>
            )}
          </>
        )}
      </div>
      {pending && mode === null && (
        <p className="mt-2 text-sm text-gray-400">
          Waiting for you to open the link sent to <span className="text-gray-200">{pending}</span>.{' '}
          <button type="button" onClick={resend} className="text-sm font-medium text-brand-hi underline-offset-2 hover:underline">
            Send a new link
          </button>
        </p>
      )}
      {!pending && current && !profile?.emailVerified && mode === null && (
        <p className="mt-2 text-sm text-gray-400">
          Not confirmed yet.{' '}
          <button type="button" onClick={resend} className="text-sm font-medium text-brand-hi underline-offset-2 hover:underline">
            Send a confirmation link
          </button>
        </p>
      )}
      {mode && (
        <form onSubmit={submit} className="mt-3 space-y-3">
          {mode === 'change' && (
            <div>
              <label htmlFor={emailId} className="mb-1 block text-sm text-gray-400">
                {current ? 'New email' : 'Email'}
              </label>
              <input id={emailId} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className="input" />
            </div>
          )}
          <div>
            <label htmlFor={passId} className="mb-1 block text-sm text-gray-400">
              Your password
            </label>
            <input id={passId} type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className="input" />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60">
              {busy ? 'Saving…' : mode === 'remove' ? 'Remove email' : current ? 'Send link to the new address' : 'Add and send link'}
            </button>
            <button type="button" onClick={() => setMode(null)} className="tap rounded-lg px-3 py-1.5 text-sm text-gray-300 hover:bg-ink-700">
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      {note && (
        <p role="status" className="mt-2 text-sm text-gray-300">
          {note}
        </p>
      )}
    </section>
  );
}
