import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as api from '../api.js';
import { attachmentInfo } from '../util.js';
import Icon from './Icon.jsx';
import EmojiPicker from './EmojiPicker.jsx';
import { insertAtCaret } from '../emoji.js';

// The message box. Files can be attached with the + button, pasted (Ctrl+V a
// screenshot), or dropped on the chat panel, which calls `addFiles` through
// the ref.
// `onEditLast()` (optional): up arrow in an empty box edits your last message;
// it returns whether there was one to edit.
const Composer = forwardRef(function Composer({ channel, disabled, onSend, onTyping, placeholder, mentionCandidates = [], replyingTo, onCancelReply, onEditLast }, ref) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState([]); // [{ url, name, size }] — an album
  const [spoilerPending, setSpoilerPending] = useState(false);
  const [uploading, setUploading] = useState(0); // files still uploading
  const [error, setError] = useState('');
  const [mentionMatch, setMentionMatch] = useState(null); // { query, candidates } | null
  const fileRef = useRef(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const emojiBtnRef = useRef(null);
  const emojiPopRef = useRef(null);
  const taRef = useRef(null);
  const lastTypingRef = useRef(0);

  const MAX_ATTACHMENTS = 10;

  // Starting a reply puts the cursor in the message box.
  useEffect(() => {
    if (replyingTo) taRef.current?.focus();
  }, [replyingTo]);

  function pickMention(name) {
    setText((prev) => prev.replace(/@([A-Za-z0-9_.-]*)$/, `@${name} `));
    setMentionMatch(null);
    taRef.current?.focus();
  }

  function pickFile(e) {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    return addFiles(files);
  }

  // Pasted images often come without a useful name; give them one.
  function pastedName(file) {
    if (file.name && file.name !== 'image.png') return file;
    const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    return new File([file], `pasted-image-${Date.now()}.${ext}`, { type: file.type });
  }

  // Pasting files (a screenshot, files copied in Explorer) attaches them;
  // pasting text works as usual.
  function onPaste(e) {
    const files = [...(e.clipboardData?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    addFiles(files.map(pastedName));
  }

  useImperativeHandle(ref, () => ({ addFiles, focus: () => taRef.current?.focus() }));

  // Put the cursor back in the message box (after a pick, or on close).
  function refocus(caret) {
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      if (caret != null) ta.setSelectionRange(caret, caret);
    });
  }

  // The textarea keeps its selection while the picker has focus, so the
  // emoji goes where the cursor was (replacing any selected text).
  function pickEmoji(emoji) {
    const ta = taRef.current;
    const { text: next, caret } = insertAtCaret(text, ta?.selectionStart, ta?.selectionEnd, emoji);
    setText(next);
    setEmojiOpen(false);
    refocus(caret);
  }

  function closeEmoji() {
    setEmojiOpen(false);
    refocus();
  }

  // Clicking anywhere else closes the picker.
  useEffect(() => {
    if (!emojiOpen) return undefined;
    const onDown = (e) => {
      if (!emojiBtnRef.current?.contains(e.target) && !emojiPopRef.current?.contains(e.target)) setEmojiOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [emojiOpen]);

  async function addFiles(files) {
    if (!files.length || disabled) return;
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
    if (e.key === 'Escape' && replyingTo) {
      e.preventDefault();
      onCancelReply?.();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
      return;
    }
    // Up arrow in an empty box (nothing typed or attached) edits your last
    // message, like Discord and Slack. Otherwise it moves the caret.
    if (e.key === 'ArrowUp' && !text && !mentionMatch && pending.length === 0 && uploading === 0 && onEditLast?.()) {
      e.preventDefault();
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
    <div className="relative px-4 pb-5 pt-1">
      {/* Anchored to the whole composer (not the button) so it fits on phones. */}
      {emojiOpen && (
        <div ref={emojiPopRef} className="absolute bottom-full right-4 z-50 mb-1">
          <EmojiPicker onPick={pickEmoji} onClose={closeEmoji} />
        </div>
      )}
      {error && <div className="mb-1 text-sm text-danger">{error}</div>}

      {(pending.length > 0 || uploading > 0) && (
        <div className="mb-2 rounded-lg bg-ink-800 p-2 ring-1 ring-ink-500/50">
          <div className="flex flex-wrap gap-2">
            {pending.map((p) => {
              const info = attachmentInfo(p.url);
              return (
                <div key={p.url} className="group relative h-16 w-16 overflow-hidden rounded-sm bg-ink-900">
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
                    aria-label={`Remove ${p.name}`}
                    className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center rounded-bl bg-black/70 text-white hover:bg-danger hover:text-ink-900"
                  >
                    <Icon name="x" size={13} strokeWidth={2.2} />
                  </button>
                </div>
              );
            })}
            {uploading > 0 && (
              <div className="flex h-16 w-16 items-center justify-center rounded-sm bg-ink-900 text-xs text-gray-400">
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
        <div className="anim-pop mb-1 overflow-hidden rounded-lg bg-ink-800 shadow-lg ring-1 ring-ink-500/50">
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
              <span className="text-brand-hi">@</span>
              {n}
            </button>
          ))}
        </div>
      )}

      {replyingTo && (
        <div className="flex items-center gap-2 rounded-t-xl bg-ink-800 px-3 py-1.5 text-sm text-gray-400 ring-1 ring-ink-500/40">
          <Icon name="reply" size={14} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            Replying to <span className="font-semibold text-gray-200">@{replyingTo.author || 'Unknown'}</span>
          </span>
          <span className="hidden text-xs text-gray-500 sm:inline">esc to cancel</span>
          <button
            type="button"
            onClick={onCancelReply}
            title="Cancel reply"
            aria-label="Cancel reply"
            className="rounded-sm p-0.5 text-gray-400 hover:bg-ink-600 hover:text-fg"
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      )}

      <div className={`flex items-end gap-2 bg-ink-600/70 px-3 py-2 ring-1 ring-inset ring-transparent transition focus-within:ring-brand/40 ${
        replyingTo ? 'rounded-b-xl' : 'rounded-xl'
      }`}>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
          title="Attach files (images, videos, and more)"
          aria-label="Attach files"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-500 text-gray-200 transition hover:bg-brand hover:text-white active:scale-90 disabled:opacity-50"
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
          onPaste={onPaste}
          disabled={disabled}
          placeholder={disabled ? 'Connecting…' : placeholder || `Message #${channel}`}
          aria-label={placeholder || `Message #${channel}`}
          className="max-h-52 flex-1 resize-none bg-transparent py-1.5 text-gray-100 outline-hidden placeholder:text-gray-500 disabled:opacity-60"
        />
        <div ref={emojiBtnRef} className="shrink-0">
          <button
            type="button"
            onClick={() => (emojiOpen ? closeEmoji() : setEmojiOpen(true))}
            disabled={disabled}
            title="Emoji"
            aria-label="Emoji"
            aria-expanded={emojiOpen}
            className={`flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-ink-500 hover:text-fg disabled:opacity-50 ${
              emojiOpen ? 'bg-ink-500 text-fg' : 'text-gray-400'
            }`}
          >
            <Icon name="smile" size={18} />
          </button>
        </div>
        <button
          onClick={submit}
          disabled={disabled || (!text.trim() && pending.length === 0)}
          className="flex h-8 shrink-0 items-center rounded-lg bg-brand px-3 text-sm font-semibold text-white transition hover:bg-brand-hover active:scale-95 disabled:opacity-40 disabled:active:scale-100"
        >
          Send
        </button>
      </div>
    </div>
  );
});

export default Composer;
