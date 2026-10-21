import { useEffect, useId, useState } from 'react';
import * as api from '../api.js';
import SettingRow from './settings/SettingRow.jsx';
import Switch from './settings/Switch.jsx';

// Settings › Site admin › Email (P12-01): whether the server can send email,
// what it sent today, and a test send. The settings themselves live in the
// server's environment (SMTP_*, MAIL_FROM, PUBLIC_URL), never here, so the
// password can't leak through the app.
const clock = (ts) => new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function EmailAdmin() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [to, setTo] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null); // { ok, text }
  const toId = useId();

  async function load() {
    try {
      const s = await api.getEmailStatus();
      if (s) setStatus(s);
    } catch (err) {
      setError(err.message || 'Could not load the email status');
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function sendTest(e) {
    e.preventDefault();
    setSending(true);
    setResult(null);
    try {
      const r = await api.sendTestEmail(to.trim() || undefined);
      setResult({ ok: true, text: `Queued for ${r.to}. It should arrive within a minute (check spam too); if it fails, the error shows under Today.` });
      setTimeout(load, 5000); // the counts after the send
    } catch (err) {
      setResult({ ok: false, text: err.message || 'The test email wasn’t sent' });
    } finally {
      setSending(false);
    }
  }

  if (error) {
    return (
      <p role="alert" className="text-sm text-danger">
        {error}
      </p>
    );
  }
  // P12-02: "Require a confirmed email" (only while email works).
  async function setRequire(on) {
    setError('');
    try {
      setStatus(await api.setRequireConfirmedEmail(on));
    } catch (err) {
      setResult({ ok: false, text: err.message || 'Couldn’t change that' });
    }
  }

  if (!status) return <p className="text-sm text-gray-400">Loading…</p>;
  const t = status.today;

  return (
    <div className="space-y-4">
      <section aria-labelledby="email-status" className="rounded-xl bg-ink-900/60 p-4">
        <h3 id="email-status" className="flex items-center gap-2 text-sm font-semibold text-fg">
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${status.enabled ? 'bg-online' : 'bg-gray-500'}`} />
          {status.enabled ? 'Email is set up' : 'Email is off'}
        </h3>
        {status.enabled ? (
          <div className="mt-2 space-y-1 text-sm text-gray-300">
            <p>
              Sending from <span className="font-mono text-gray-200">{status.from}</span> via{' '}
              <span className="font-mono text-gray-200">{status.server}</span> ({status.tls === 'tls' ? 'TLS' : 'STARTTLS'}).
            </p>
            <p>
              Links in emails point to <span className="font-mono text-gray-200">{status.publicUrl}</span>.
            </p>
          </div>
        ) : (
          <div className="mt-2 space-y-2 text-sm text-gray-300">
            <p>The server needs these settings in its environment (see the README’s Email section):</p>
            <ul aria-label="Missing settings" className="flex flex-wrap gap-1.5">
              {status.missing.map((m) => (
                <li key={m} className="rounded bg-ink-700 px-2 py-0.5 font-mono text-xs text-gray-200">
                  {m}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <SettingRow
        className="rounded-xl bg-ink-900/60 px-4"
        label="Require a confirmed email"
        description={
          status.enabled
            ? 'Members without a confirmed address see only a “Confirm your email” step until they confirm one, and sign-up asks for an address. Site admins are never held back.'
            : 'Set up email first: nobody could confirm an address while it’s off.'
        }
      >
        <Switch label="Require a confirmed email" checked={!!status.requireConfirmed} disabled={!status.enabled} onChange={setRequire} />
      </SettingRow>

      <section aria-labelledby="email-today" className="rounded-xl bg-ink-900/60 p-4">
        <h3 id="email-today" className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          Today
        </h3>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-gray-400">Sent</dt>
            <dd className="text-fg">{t.sent}</dd>
          </div>
          <div>
            <dt className="text-gray-400">Failed</dt>
            <dd className={t.failed ? 'text-danger' : 'text-fg'}>{t.failed}</dd>
          </div>
          <div>
            <dt className="text-gray-400">Over the limit</dt>
            <dd className="text-fg">{t.overCap + t.overRecipient}</dd>
          </div>
          <div>
            <dt className="text-gray-400">Daily limit</dt>
            <dd className="text-fg">{status.dailyLimit}</dd>
          </div>
        </dl>
        {status.lastError && (
          <p className="mt-3 text-sm text-gray-300">
            Last error ({clock(status.lastError.at)}): <span className="text-danger">{status.lastError.message}</span>
          </p>
        )}
      </section>

      <form onSubmit={sendTest} aria-labelledby="email-test" className="rounded-xl bg-ink-900/60 p-4">
        <h3 id="email-test" className="text-sm font-semibold text-fg">
          Send a test email
        </h3>
        <label htmlFor={toId} className="mt-2 block text-sm text-gray-400">
          To (leave empty to use your own address{status.yourAddress ? `, ${status.yourAddress}` : ''})
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id={toId}
            type="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder={status.yourAddress || 'you@example.com'}
            autoComplete="email"
            className="input flex-1"
            disabled={!status.enabled}
          />
          <button
            type="submit"
            disabled={!status.enabled || sending}
            className="tap shrink-0 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
          >
            {sending ? 'Sending…' : 'Send test email'}
          </button>
        </div>
        {result && (
          <p role={result.ok ? 'status' : 'alert'} className={`mt-2 text-sm ${result.ok ? 'text-gray-300' : 'text-danger'}`}>
            {result.text}
          </p>
        )}
      </form>
    </div>
  );
}
