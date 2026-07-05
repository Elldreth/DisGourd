import { useRef, useState } from 'react';
import * as api from '../api.js';
import { humanSize } from '../util.js';

export default function Composer({ channel, disabled, onSend, onTyping, placeholder, mentionCandidates = [] }) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState(null); // { url, name, size } once uploaded
  const [progress, setProgress] = useState(null); // 0..1 while uploading
  const [error, setError] = useState('');
  const [mentionMatch, setMentionMatch] = useState(null); // { query, candidates } | null
  const fileRef = useRef(null);
  const taRef = useRef(null);
  const lastTypingRef = useRef(0);

  function pickMention(name) {
    setText((prev) => prev.replace(/@([A-Za-z0-9_.-]*)$/, `@${name} `));
    setMentionMatch(null);
    taRef.current?.focus();
  }

  const uploading = progress !== null;

  async function pickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setProgress(0);
    try {
      const res = await api.uploadFile(file, setProgress);
      setPending(res);
    } catch (err) {
      setError(err.message || 'Upload failed');
    } finally {
      setProgress(null);
    }
  }

  function submit() {
    const content = text.trim();
    if ((!content && !pending) || disabled) return;
    onSend(content, pending ? pending.url : undefined);
    setText('');
    setPending(null);
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

      {(pending || uploading) && (
        <div className="mb-2 flex items-center gap-3 rounded-lg bg-ink-800 px-3 py-2 ring-1 ring-ink-500/50">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-brand/20 text-brand">📎</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm">{pending ? pending.name : 'Uploading…'}</div>
            {uploading ? (
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-ink-600">
                <div className="h-full bg-brand transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            ) : (
              <div className="text-xs text-gray-400">{humanSize(pending.size)} · ready to send</div>
            )}
          </div>
          {pending && (
            <button
              onClick={() => setPending(null)}
              className="rounded p-1 text-gray-400 hover:bg-ink-600 hover:text-white"
              title="Remove"
            >
              ✕
            </button>
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

      <div className="flex items-end gap-2 rounded-xl bg-ink-600/70 px-3 py-2">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={disabled || uploading}
          title="Attach a file"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-500 text-lg text-gray-200 transition hover:bg-brand hover:text-white disabled:opacity-50"
        >
          +
        </button>
        <input ref={fileRef} type="file" hidden onChange={pickFile} />
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
          disabled={disabled || (!text.trim() && !pending)}
          className="flex h-8 shrink-0 items-center rounded-lg bg-brand px-3 text-sm font-semibold text-white transition hover:bg-brand-hover disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}
