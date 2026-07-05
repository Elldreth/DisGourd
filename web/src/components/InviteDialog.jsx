import { useState } from 'react';

// Shows a freshly minted invite code with a copy button.
export default function InviteDialog({ space, code, onClose }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    if (navigator.clipboard) {
      navigator.clipboard
        .writeText(code)
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
        .catch(() => {});
    }
  }

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-ink-800 p-6 shadow-2xl ring-1 ring-ink-500/50"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold">Invite people to {space}</h3>
        <p className="mt-1 text-sm text-gray-400">
          Share this code. Anyone with a DisGourd account can join by entering it under “Join a
          server” in the left rail.
        </p>
        <div className="mt-4 flex items-center gap-2">
          <code className="flex-1 select-all truncate rounded-lg bg-ink-900 px-3 py-2 font-mono text-brand ring-1 ring-ink-500/60">
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
          <button onClick={onClose} className="text-sm text-gray-400 hover:text-white">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
