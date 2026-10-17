import { useRef, useState } from 'react';
import { copyText } from '../util.js';
import { inviteLink } from '../inviteLink.js';
import Modal from './Modal.jsx';

// Shows a freshly minted invite as a link and as a code, each with a copy button.
export default function InviteDialog({ space, code, onClose }) {
  const link = inviteLink(code);
  return (
    <Modal onClose={onClose} panelClassName="w-full max-w-md rounded-xl bg-ink-800 p-6 shadow-2xl ring-1 ring-ink-500/50">
      <Modal.Title>Invite people to {space}</Modal.Title>
      <p className="mt-1 text-sm text-gray-400">
        Send this link. Opening it signs them in (or lets them register) and takes them straight to
        joining. Already in the app? The code works under “Join a server” in the left rail.
      </p>
      <CopyRow label="Invite link" value={link} buttonLabel="Copy link" className="mt-4" />
      <CopyRow label="Invite code" value={code} buttonLabel="Copy code" className="mt-3" />
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
