import { useId, useRef, useState } from 'react';
import { copyText } from '../util.js';
import { inviteLink } from '../inviteLink.js';
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
  return (
    <Modal onClose={onClose} panelClassName="w-full max-w-md rounded-xl bg-ink-800 p-6 shadow-2xl ring-1 ring-ink-500/50">
      <Modal.Title>Invite people to {space}</Modal.Title>
      <p className="mt-1 text-sm text-gray-400">
        Send this link. Opening it signs them in (or lets them register) and takes them straight to
        joining. Already in the app? The code works under “Join a server” in the left rail.
      </p>
      <CopyRow label="Invite link" value={link} buttonLabel="Copy link" className="mt-4" />
      <CopyRow label="Invite code" value={code} buttonLabel="Copy code" className="mt-3" />
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
