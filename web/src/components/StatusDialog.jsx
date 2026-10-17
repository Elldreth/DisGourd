import { useId, useRef, useState } from 'react';
import Modal from './Modal.jsx';
import EmojiPicker from './EmojiPicker.jsx';

const MAX = 80;
const CLEAR_AFTER = [
  { v: '', label: 'Don’t clear' },
  { v: '30m', label: '30 minutes' },
  { v: '1h', label: '1 hour' },
  { v: '4h', label: '4 hours' },
  { v: 'today', label: 'Today' },
];

// "Set a custom status": an optional emoji and up to 80 characters that others
// see next to your name, cleared after a while if you like.
//   current: { statusText, statusEmoji }
//   onSave({ statusText, statusEmoji, statusExpiresIn }): resolves, or throws
//   with a message (shown here; the dialog stays open)
export default function StatusDialog({ current = {}, onSave, onClose }) {
  const [text, setText] = useState(current.statusText || '');
  const [emoji, setEmoji] = useState(current.statusEmoji || null);
  const [clearAfter, setClearAfter] = useState('');
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const emojiButton = useRef(null);
  const textId = useId();
  const clearId = useId();

  async function save(next) {
    setBusy(true);
    setError('');
    try {
      await onSave(next);
      onClose();
    } catch (err) {
      setError(err.message || 'Could not save your status');
      setBusy(false);
    }
  }

  function submit(e) {
    e.preventDefault();
    save({ statusText: text.trim(), statusEmoji: emoji, statusExpiresIn: clearAfter || null });
  }

  return (
    <Modal
      onClose={onClose}
      initialFocusRef={inputRef}
      panelClassName="w-full max-w-sm rounded-xl bg-ink-800 p-6 shadow-2xl ring-1 ring-ink-500/50"
    >
      <Modal.Title>Set a custom status</Modal.Title>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <label htmlFor={textId} className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              What&apos;s happening?
            </label>
            <span className="text-xs text-gray-500" aria-hidden="true">
              {text.length}/{MAX}
            </span>
          </div>
          <div className="relative flex items-center gap-2">
            <button
              ref={emojiButton}
              type="button"
              onClick={() => setPicking((v) => !v)}
              aria-label={emoji ? `Change emoji (${emoji})` : 'Choose an emoji'}
              title="Emoji"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ink-900 text-xl ring-1 ring-ink-500 transition hover:ring-brand-hi"
            >
              {emoji || <span className="text-sm text-gray-500">🙂</span>}
            </button>
            <input
              id={textId}
              ref={inputRef}
              value={text}
              maxLength={MAX}
              onChange={(e) => {
                setText(e.target.value);
                setError('');
              }}
              placeholder="In a meeting"
              autoComplete="off"
              className="input"
            />
            {picking && (
              <div className="absolute left-0 top-full z-50 mt-1">
                <EmojiPicker
                  onPick={(e) => {
                    setEmoji(e);
                    setPicking(false);
                    emojiButton.current?.focus();
                  }}
                  onClose={() => {
                    setPicking(false);
                    emojiButton.current?.focus();
                  }}
                />
              </div>
            )}
          </div>
          {emoji && (
            <button type="button" onClick={() => setEmoji(null)} className="mt-1 text-xs text-gray-400 hover:text-fg">
              Remove emoji
            </button>
          )}
        </div>
        <div>
          <label htmlFor={clearId} className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">
            Clear after
          </label>
          <select id={clearId} value={clearAfter} onChange={(e) => setClearAfter(e.target.value)} className="input">
            {CLEAR_AFTER.map((c) => (
              <option key={c.v} value={c.v}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={() => save({ statusText: '', statusEmoji: null, statusExpiresIn: null })}
            className="rounded-lg px-2 py-2 text-sm text-gray-400 transition hover:text-danger disabled:opacity-50"
          >
            Clear status
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:text-fg">
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || (!text.trim() && !emoji)}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
