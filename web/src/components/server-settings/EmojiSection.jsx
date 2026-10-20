import { useEffect, useRef, useState } from 'react';
import * as api from '../../api.js';
import Icon from '../Icon.jsx';

const MAX_BYTES = 256 * 1024;
const TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

// "party gourd.PNG" -> "party_gourd": the name a file suggests for its emoji.
export function suggestEmojiName(filename) {
  return String(filename || '')
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
}

// The server's custom emoji, for people who may manage them: the list with a
// Delete per row, and an Add form (an image under 256 KB plus a name).
// `emoji` is the list from the servers' data (it changes live); the dialog
// fetches the fuller list (with who added each) and reloads after changes.
// A section of Server settings since P5-04.
export default function EmojiSection({ space, emoji, onChanged }) {
  const [list, setList] = useState(null); // null while loading
  const [file, setFile] = useState(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    let live = true;
    api
      .getEmoji(space)
      .then((rows) => live && setList(rows))
      .catch((err) => live && setError(err.message || 'Could not load emoji'));
    return () => {
      live = false;
    };
  }, [space, emoji]);

  function chooseFile(e) {
    const f = e.target.files?.[0] || null;
    e.target.value = '';
    setError('');
    if (!f) return;
    if (!TYPES.includes(f.type)) {
      setError('Emoji must be a PNG, JPG, GIF or WebP image');
      return;
    }
    if (f.size > MAX_BYTES) {
      setError('Emoji images must be 256 KB or smaller');
      return;
    }
    setFile(f);
    if (!name) setName(suggestEmojiName(f.name));
  }

  async function add(e) {
    e.preventDefault();
    if (busy || !file) return;
    const trimmed = name.trim().toLowerCase();
    if (!/^[a-z0-9_]{2,32}$/.test(trimmed)) {
      setError('Names are 2–32 letters, numbers or underscores');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const up = await api.uploadFile(file);
      await api.addEmoji(space, trimmed, up.url);
      setFile(null);
      setName('');
      setList(await api.getEmoji(space));
      onChanged?.();
    } catch (err) {
      setError(err.message || 'Could not add the emoji');
    } finally {
      setBusy(false);
    }
  }

  async function remove(n) {
    setError('');
    try {
      await api.deleteEmoji(space, n);
      setList((l) => (l ? l.filter((x) => x.name !== n) : l));
      onChanged?.();
    } catch (err) {
      setError(err.message || 'Could not remove the emoji');
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={add} aria-label="Add an emoji" className="rounded-xl bg-ink-900/60 p-4">
        <div className="flex flex-wrap items-end gap-2">
          <input ref={fileRef} type="file" accept={TYPES.join(',')} hidden aria-label="Emoji image" onChange={chooseFile} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-gray-200 ring-1 ring-ink-500/60 hover:bg-ink-600"
          >
            <Icon name="image" size={16} /> {file ? file.name : 'Choose image'}
          </button>
          <label className="flex min-w-40 flex-1 flex-col text-xs text-gray-400">
            Name
            <span className="mt-0.5 flex items-center rounded-lg bg-ink-900 px-2 ring-1 ring-ink-500/60 focus-within:ring-brand-hi">
              <span className="text-gray-500">:</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={32}
                placeholder="party_gourd"
                aria-label="Emoji name"
                className="w-full bg-transparent py-1.5 text-sm text-gray-100 outline-hidden placeholder:text-gray-600"
              />
              <span className="text-gray-500">:</span>
            </span>
          </label>
          <button
            type="submit"
            disabled={!file || busy}
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-ink-900 hover:bg-brand-hi disabled:opacity-50"
          >
            {busy ? 'Adding…' : 'Add'}
          </button>
        </div>
        <p className="mt-1.5 text-xs text-gray-500">PNG, JPG, GIF or WebP up to 256 KB. Up to 50 per server. Type :name: in a message to use one.</p>
        {error && (
          <p role="alert" className="mt-1 text-sm text-danger">
            {error}
          </p>
        )}
      </form>

      <div>
        {list === null && !error && <p className="p-4 text-center text-sm text-gray-500">Loading…</p>}
        {list?.length === 0 && <p className="p-6 text-center text-sm text-gray-500">No custom emoji yet. Add one above.</p>}
        {list?.length > 0 && (
          <ul className="space-y-1">
            {list.map((e) => (
              <li key={e.id} className="flex items-center gap-3 rounded-lg px-3 py-1.5 hover:bg-ink-700/60">
                <img src={e.url} alt="" className="h-8 w-8 object-contain" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-gray-100">:{e.name}:</span>
                  {e.createdBy && <span className="block text-xs text-gray-500">added by {e.createdBy}</span>}
                </span>
                <button
                  type="button"
                  onClick={() => remove(e.name)}
                  aria-label={`Delete :${e.name}:`}
                  className="shrink-0 rounded-md px-2 py-1 text-xs text-gray-400 transition hover:bg-ink-600 hover:text-danger"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
