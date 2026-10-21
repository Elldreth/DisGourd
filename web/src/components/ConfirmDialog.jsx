import { useId, useRef, useState } from 'react';
import Modal from './Modal.jsx';

// An in-app "are you sure?" (instead of the browser's confirm()). For
// dangerous actions focus starts on Cancel; with `requireText` the confirm
// button stays disabled until that exact text is typed (deleting a server
// asks for its name), and focus starts in that box. `children` go under the
// body (suspending someone takes an optional reason).
export default function ConfirmDialog({ title, body, confirmLabel = 'Confirm', danger = false, requireText, onConfirm, onCancel, children }) {
  const [typed, setTyped] = useState('');
  const cancelRef = useRef(null);
  const textRef = useRef(null);
  const inputId = useId();
  const ready = !requireText || typed === requireText;

  function confirm() {
    if (ready) onConfirm();
  }

  return (
    <Modal
      onClose={onCancel}
      initialFocusRef={requireText ? textRef : danger ? cancelRef : undefined}
      panelClassName="w-full max-w-sm rounded-xl bg-ink-800 p-6 shadow-2xl ring-1 ring-ink-500/50"
    >
      <Modal.Title>{title}</Modal.Title>
      {body && <p className="mt-2 text-sm text-gray-400">{body}</p>}
      {children}
      {requireText && (
        <div className="mt-4">
          <label htmlFor={inputId} className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">
            Type <span className="normal-case text-gray-200">{requireText}</span> to confirm
          </label>
          <input
            id={inputId}
            ref={textRef}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                confirm();
              }
            }}
            autoComplete="off"
            spellCheck={false}
            className="input"
          />
        </div>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button ref={cancelRef} onClick={onCancel} className="rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:text-fg">
          Cancel
        </button>
        <button
          onClick={confirm}
          disabled={!ready}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
            danger ? 'bg-danger text-ink-900 hover:bg-danger/90' : 'bg-brand text-white hover:bg-brand-hover'
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
