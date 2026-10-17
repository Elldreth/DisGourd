import { useRef, useState } from 'react';
import { copyText } from '../util.js';
import Modal from './Modal.jsx';

// Shows a freshly minted invite code with a copy button.
export default function InviteDialog({ space, code, onClose }) {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef(null);

  async function copy() {
    if (await copyText(code)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } else if (codeRef.current) {
      // Last resort: highlight the code so it can be copied by hand.
      const range = document.createRange();
      range.selectNodeContents(codeRef.current);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  return (
    <Modal onClose={onClose} panelClassName="w-full max-w-md rounded-xl bg-ink-800 p-6 shadow-2xl ring-1 ring-ink-500/50">
      <Modal.Title>Invite people to {space}</Modal.Title>
      <p className="mt-1 text-sm text-gray-400">
        Share this code. Anyone with a DisGourd account can join by entering it under “Join a
        server” in the left rail.
      </p>
      <div className="mt-4 flex items-center gap-2">
        <code
          ref={codeRef}
          className="flex-1 select-all truncate rounded-lg bg-ink-900 px-3 py-2 font-mono text-brand-hi ring-1 ring-ink-500/60"
        >
          {code}
        </code>
        <button
          onClick={copy}
          className="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-hover"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <div className="mt-5 text-right">
        <button onClick={onClose} className="text-sm text-gray-400 hover:text-fg">
          Close
        </button>
      </div>
    </Modal>
  );
}
