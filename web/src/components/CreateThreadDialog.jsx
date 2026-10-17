import { useRef, useState } from 'react';
import * as api from '../api.js';
import Modal from './Modal.jsx';

export const THREAD_NAME_MAX = 80;

// The name a thread gets by default: the start of its root message (the
// server does the same when no name is sent).
export function defaultThreadName(content) {
  const text = String(content || '')
    .replace(/\|\|[\s\S]+?\|\|/g, '(spoiler)')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text.length > 40 ? `${text.slice(0, 39).trimEnd()}…` : text;
}

// "Create thread" from a message: pick a name, and the new thread opens.
// `onCreated(thread)` gets the server's thread (or the one the message
// already had, if someone beat you to it).
export default function CreateThreadDialog({ space, channel, message, onCreated, onClose }) {
  const [name, setName] = useState(() => defaultThreadName(message.content));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    if (trimmed.length > THREAD_NAME_MAX) {
      setError(`Thread names are at most ${THREAD_NAME_MAX} characters`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { thread } = await api.createThread(space, channel, message.id, trimmed || undefined);
      onCreated(thread);
    } catch (err) {
      setError(err.message || 'Could not create the thread');
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} initialFocusRef={inputRef} panelClassName="w-full max-w-md rounded-xl bg-ink-800 p-5 shadow-2xl ring-1 ring-ink-500/50">
      <form onSubmit={submit}>
        <Modal.Title>Create thread</Modal.Title>
        <p className="mt-1 text-sm text-gray-400">
          Replies go in the thread, not in #{channel}. {message.author ? `Starts from ${message.author}’s message.` : ''}
        </p>
        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-gray-400" htmlFor="thread-name">
          Thread name
        </label>
        <input
          id="thread-name"
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={THREAD_NAME_MAX}
          placeholder="What is this thread about?"
          className="mt-1 w-full rounded-lg bg-ink-900 px-3 py-2 text-gray-100 outline-hidden ring-1 ring-ink-500/60 focus:ring-brand-hi"
        />
        <div className="mt-1 flex justify-between text-xs text-gray-500">
          <span>{error && <span role="alert" className="text-danger">{error}</span>}</span>
          <span>
            {name.trim().length}/{THREAD_NAME_MAX}
          </span>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-gray-300 hover:bg-ink-600">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-ink-900 hover:bg-brand-hi disabled:opacity-60"
          >
            {busy ? 'Creating…' : 'Create thread'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
