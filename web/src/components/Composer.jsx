import { useRef, useState } from 'react';
import * as api from '../api.js';
import { attachmentInfo } from '../util.js';
import Icon from './Icon.jsx';

export default function Composer({ channel, disabled, onSend, onTyping, placeholder, mentionCandidates = [] }) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState([]); // [{ url, name, size }] — an album
  const [spoilerPending, setSpoilerPending] = useState(false);
  const [uploading, setUploading] = useState(0); // files still uploading
  const [error, setError] = useState('');
  const [mentionMatch, setMentionMatch] = useState(null); // { query, candidates } | null
  const fileRef = useRef(null);
  const taRef = useRef(null);
  const lastTypingRef = useRef(0);

  const MAX_ATTACHMENTS = 10;

  function pickMention(name) {
    setText((prev) => prev.replace(/@([A-Za-z0-9_.-]*)$/, `@${name} `));
    setMentionMatch(null);
    taRef.current?.focus();
  }

  async function pickFile(e) {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    setError('');
    const room = MAX_ATTACHMENTS - pending.length - uploading;
    if (room <= 0) {
      setError(`You can attach up to ${MAX_ATTACHMENTS} files per message`);
      return;
    }
    const batch = files.slice(0, room);
    if (batch.length < files.length) setError(`Only the first ${MAX_ATTACHMENTS} files are attached`);
    setUploading((n) => n + batch.length);
    for (const file of batch) {
      try {
        const res = await api.uploadFile(file);
        setPending((prev) => [...prev, res]);
      } catch (err) {
        setError(err.message || 'Upload failed');
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  const removePending = (url) => setPending((prev) => prev.filter((p) => p.url !== url));

  function submit() {
    const content = text.trim();
    if ((!content && pending.length === 0) || disabled) return;
    onSend(content, pending.map((p) => p.url), pending.length > 0 ? spoilerPending : false);
    setText('');
    setPending([]);
    setSpoilerPending(false);
    setMentionMatch(null);
    if (taRef.current) taRef.current.style.height = 'auto';
  }

  function onKeyDown(e) {
    if (mentionMatch && (e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
      e.preventDefault();
      pickMention(mentionMatch.candidates[0]);
      return;
    }
    if (e.key === 'Escape' && mentionMatch) {
      setMentionMatch(null);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function grow(e) {
    const value = e.target.value;
    setText(value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;

    // Mention autocomplete: an @token being typed at the end of the text.
    const tok = /@([A-Za-z0-9_.-]*)$/.exec(value);
    if (tok && mentionCandidates.length) {
      const q = tok[1].toLowerCase();
      const cands = mentionCandidates.filter((n) => n.toLowerCase().startsWith(q)).slice(0, 6);
      setMentionMatch(cands.length ? { query: tok[1], candidates: cands } : null);
    } else {
      setMentionMatch(null);
    }
    // Emit a typing signal at most once every 2.5s while there's text.
    if (onTyping && e.target.value.trim()) {
      const now = Date.now();
      if (now - lastTypingRef.current > 2500) {
        lastTypingRef.current = now;
        onTyping();
      }
    }
  }

  return (
    <div className="px-4 pb-5 pt-1">
      {error && <div className="mb-1 text-sm text-danger">{error}</div>}

      {(pending.length > 0 || uploading > 0) && (
        <div className="mb-2 rounded-lg bg-ink-800 p-2 ring-1 ring-ink-500/50">
          <div className="flex flex-wrap gap-2">
            {pending.map((p) => {
              const info = attachmentInfo(p.url);
              return (
                <div key={p.url} className="group relative h-16 w-16 overflow-hidden rounded bg-ink-900">
                  {info?.isImage ? (
                    <img src={info.url} alt={p.name} className="h-full w-full object-cover" />
                  ) : info?.isVideo ? (
                    <video src={info.url} muted preload="metadata" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center px-1 text-center text-[10px] text-gray-400">
                      <Icon name="paperclip" size={16} />
                      <span className="mt-0.5 line-clamp-1 w-full break-all">{p.name}</span>
                    </div>
                  )}
                  <button
                    onClick={() => removePending(p.url)}
                    title="Remove"
                    className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center rounded-bl bg-black/70 text-white hover:bg-danger"
                  >
                    <Icon name="x" size={13} strokeWidth={2.2} />
                  </button>
                </div>
              );
            })}
            {uploading > 0 && (
              <div className="flex h-16 w-16 items-center justify-center rounded bg-ink-900 text-xs text-gray-400">
                Uploading…
              </div>
            )}
          </div>
          {pending.length > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={() => setSpoilerPending((v) => !v)}
                title={spoilerPending ? 'Spoiler on — click to turn off' : 'Mark as spoiler'}
                className={`flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-xs font-semibold transition ${
                  spoilerPending ? 'bg-brand text-white' : 'bg-ink-600 text-gray-300 hover:bg-ink-500'
                }`}
              >
                <Icon name="eyeOff" size={13} />
                {spoilerPending ? 'Spoiler' : 'Mark as spoiler'}
              </button>
              <span className="text-xs text-gray-500">
                {pending.length} file{pending.length > 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>
      )}

      {mentionMatch && (
        <div className="mb-1 overflow-hidden rounded-lg bg-ink-800 shadow-lg ring-1 ring-ink-500/50">
          <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Members</div>
          {mentionMatch.candidates.map((n, i) => (
            <button
              key={n}
              onMouseDown={(e) => {
                e.preventDefault();
                pickMention(n);
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                i === 0 ? 'bg-ink-600/60' : 'hover:bg-ink-600'
              }`}
            >
              <span className="text-brand">@</span>
              {n}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 rounded-xl bg-ink-600/70 px-3 py-2 ring-1 ring-inset ring-transparent transition focus-within:ring-brand/40">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
          title="Attach files (images, videos, and more)"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-500 text-gray-200 transition hover:bg-brand hover:text-white disabled:opacity-50"
        >
          <Icon name="plus" size={18} />
        </button>
        <input ref={fileRef} type="file" multiple hidden onChange={pickFile} />
        <textarea
          ref={taRef}
          rows={1}
          value={text}
          onChange={grow}
          onKeyDown={onKeyDown}
          disabled={disabled}
          placeholder={disabled ? 'Connecting…' : placeholder || `Message #${channel}`}
          className="max-h-52 flex-1 resize-none bg-transparent py-1.5 text-gray-100 outline-none placeholder:text-gray-500 disabled:opacity-60"
        />
        <button
          onClick={submit}
          disabled={disabled || (!text.trim() && pending.length === 0)}
          className="flex h-8 shrink-0 items-center rounded-lg bg-brand px-3 text-sm font-semibold text-white transition hover:bg-brand-hover disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}
