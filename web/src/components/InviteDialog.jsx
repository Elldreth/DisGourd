import { useEffect, useId, useRef, useState } from 'react';
import { copyText } from '../util.js';
import { inviteLink } from '../inviteLink.js';
import * as api from '../api.js';
import Modal from './Modal.jsx';

// P11-13 (L7): how long a new invite works. 7 days unless you pick otherwise.
const EXPIRY_CHOICES = [
  { value: '1', days: 1, label: '1 day' },
  { value: '7', days: 7, label: '7 days' },
  { value: '30', days: 30, label: '30 days' },
  { value: 'never', days: null, label: 'Never' },
];

// Shows a freshly minted invite as a link and as a code, each with a copy button.
// Picking another expiry asks for a new invite (`onExpiry(days)`, null = never).
export default function InviteDialog({ space, code, expiresInDays = 7, onExpiry, onClose }) {
  const link = inviteLink(code);
  const expiryId = useId();
  const current = EXPIRY_CHOICES.find((c) => c.days === expiresInDays) || EXPIRY_CHOICES[1];
  // P14-02: whether this link can also create an account (the site's policy),
  // asked of the same preview a signed-out person sees.
  const [signUp, setSignUp] = useState(null);
  useEffect(() => {
    let live = true;
    setSignUp(null);
    api
      .getInvitePreview(code)
      .then((p) => live && setSignUp(!!p.signUp))
      .catch(() => live && setSignUp(null));
    return () => {
      live = false;
    };
  }, [code]);
  // P14-03: "Email this invite", while the server can send email.
  const [canEmail, setCanEmail] = useState(false);
  useEffect(() => {
    let live = true;
    api
      .getAuthInfo()
      .then((r) => live && setCanEmail(!!r.email))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return (
    <Modal onClose={onClose} panelClassName="w-full max-w-md rounded-xl bg-ink-800 p-6 shadow-2xl ring-1 ring-ink-500/50">
      <Modal.Title>Invite people to {space}</Modal.Title>
      <p className="mt-1 text-sm text-gray-400">
        Send this link. Opening it adds them to {space} and opens it. Already in the app? The code works under
        “Join a server” in the left rail.
      </p>
      <CopyRow label="Invite link" value={link} buttonLabel="Copy link" className="mt-4" />
      {signUp !== null && (
        <p className="mt-2 text-xs text-gray-400">
          {signUp ? 'New people can create an account with this link.' : 'Only people who already have an account can use this link.'}
        </p>
      )}
      <CopyRow label="Invite code" value={code} buttonLabel="Copy code" className="mt-3" />
      {canEmail && <EmailInvite space={space} code={code} />}
      {onExpiry && (
        <div className="mt-4 flex items-center gap-3">
          <label htmlFor={expiryId} className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            Expires after
          </label>
          <select
            id={expiryId}
            value={current.value}
            onChange={(e) => onExpiry(EXPIRY_CHOICES.find((c) => c.value === e.target.value).days)}
            className="input w-auto"
          >
            {EXPIRY_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-gray-400">Changing it makes a new invite.</span>
        </div>
      )}
      <div className="mt-5 text-right">
        <button onClick={onClose} className="text-sm text-gray-400 hover:text-fg">
          Close
        </button>
      </div>
    </Modal>
  );
}

// P14-03: send the link to an address. Nothing the sender types goes in
// besides the address, so the server can't be used to mail arbitrary text.
function EmailInvite({ space, code }) {
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { ok, text }
  const toId = useId();
  async function send(e) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const r = await api.emailInvite(space, code, to.trim());
      setResult({ ok: true, text: `Sent to ${r.to}.` });
      setTo('');
    } catch (err) {
      setResult({ ok: false, text: err.message || 'The invite wasn’t sent' });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={send} className="mt-4">
      <label htmlFor={toId} className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">
        Email this invite
      </label>
      <div className="flex gap-2">
        <input id={toId} type="email" required value={to} onChange={(e) => setTo(e.target.value)} placeholder="friend@example.com" autoComplete="email" className="input flex-1" />
        <button type="submit" disabled={busy} className="shrink-0 rounded-lg bg-ink-600 px-3 py-2 text-sm font-semibold text-gray-200 hover:bg-ink-500 disabled:opacity-60">
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
      {result && (
        <p role={result.ok ? 'status' : 'alert'} className={`mt-1 text-xs ${result.ok ? 'text-gray-300' : 'text-danger'}`}>
          {result.text}
        </p>
      )}
    </form>
  );
}

function CopyRow({ label, value, buttonLabel, className = '' }) {
  const [copied, setCopied] = useState(false);
  const valueRef = useRef(null);

  async function copy() {
    if (await copyText(value)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } else if (valueRef.current) {
      // Last resort: highlight it so it can be copied by hand.
      const range = document.createRange();
      range.selectNodeContents(valueRef.current);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  return (
    <div className={className}>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</div>
      <div className="flex items-center gap-2">
        <code
          ref={valueRef}
          className="min-w-0 flex-1 select-all truncate rounded-lg bg-ink-900 px-3 py-2 font-mono text-sm text-brand-hi ring-1 ring-ink-500/60"
        >
          {value}
        </code>
        <button
          onClick={copy}
          className="w-28 shrink-0 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-hover"
        >
          {copied ? 'Copied!' : buttonLabel}
        </button>
      </div>
    </div>
  );
}
