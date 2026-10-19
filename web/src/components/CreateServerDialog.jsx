import { useEffect, useId, useRef, useState } from 'react';
import * as api from '../api.js';
import Modal from './Modal.jsx';
import ImageCropper from './ImageCropper.jsx';
import TemplatePicker from './TemplatePicker.jsx';

const MAX_NAME = 60;

// A bare invite code, or the code pulled out of a pasted link
// (…/invite/<code>, …/invites/<code>, or ?invite=<code>).
export function extractInviteCode(input) {
  const text = String(input || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    const fromQuery = url.searchParams.get('invite');
    if (fromQuery) return fromQuery.trim();
    const parts = url.pathname.split('/').filter(Boolean);
    const i = parts.findIndex((p) => p === 'invite' || p === 'invites');
    if (i >= 0 && parts[i + 1]) return decodeURIComponent(parts[i + 1]);
    return parts.at(-1) || '';
  } catch {
    return text; // not a URL: it's the code itself
  }
}

const TABS = [
  { id: 'create', label: 'Create' },
  { id: 'join', label: 'Join' },
];

// "Add a server": create a new one, or join one with an invite. Tabs follow
// the ARIA tabs pattern (← → Home End move between them). Errors from the
// server show inline and the dialog stays open; on success it closes.
//   onCreate(name, { template, icon }) / onJoin(code): resolve on success,
//   throw with a message. icon: { original: File, blob, crop } or null.
//   initialCode: fills the Join box (from an invite link).
export default function CreateServerDialog({ initialTab = 'create', initialCode = '', onCreate, onJoin, onClose }) {
  const [tab, setTab] = useState(initialTab);
  const baseId = useId();
  const tabRefs = useRef({});
  const fieldRef = useRef(null);

  function onTabKey(e) {
    const i = TABS.findIndex((t) => t.id === tab);
    const to = { ArrowRight: (i + 1) % TABS.length, ArrowLeft: (i - 1 + TABS.length) % TABS.length, Home: 0, End: TABS.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    setTab(TABS[to].id);
    tabRefs.current[TABS[to].id]?.focus();
  }

  return (
    <Modal
      onClose={onClose}
      initialFocusRef={fieldRef}
      panelClassName="w-full max-w-sm rounded-xl bg-ink-800 p-6 shadow-2xl ring-1 ring-ink-500/50"
    >
      <Modal.Title>Add a server</Modal.Title>
      <div role="tablist" aria-label="Create or join" className="mt-4 flex gap-1 rounded-lg bg-ink-900 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(el) => (tabRefs.current[t.id] = el)}
            id={`${baseId}-tab-${t.id}`}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            aria-controls={`${baseId}-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={onTabKey}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-semibold transition ${
              tab === t.id ? 'bg-ink-600 text-fg' : 'text-gray-400 hover:text-fg'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        id={`${baseId}-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-${tab}`}
        className="mt-4"
      >
        {tab === 'create' ? (
          <CreatePanel fieldRef={fieldRef} onCreate={onCreate} onDone={onClose} onCancel={onClose} />
        ) : (
          <JoinPanel fieldRef={fieldRef} initialCode={initialCode} onJoin={onJoin} onDone={onClose} onCancel={onClose} />
        )}
      </div>
    </Modal>
  );
}

function Buttons({ busy, disabled, label, onCancel }) {
  return (
    <div className="mt-5 flex justify-end gap-2">
      <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:text-fg">
        Cancel
      </button>
      <button
        type="submit"
        disabled={disabled || busy}
        className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Working…' : label}
      </button>
    </div>
  );
}

function CreatePanel({ fieldRef, onCreate, onDone, onCancel }) {
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('blank');
  const [icon, setIcon] = useState(null); // { original, blob, crop, preview }
  const [framing, setFraming] = useState(null); // the picked File while it's being framed
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const id = useId();

  // Free the preview's object URL when it's replaced or the dialog closes.
  useEffect(() => () => icon && URL.revokeObjectURL(icon.preview), [icon]);

  function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file for the icon');
      return;
    }
    setError('');
    setFraming(file);
  }

  async function submit(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError('');
    try {
      await onCreate(trimmed, { template, icon: icon ? { original: icon.original, blob: icon.blob, crop: icon.crop } : null });
      onDone();
    } catch (err) {
      setError(err.message || 'Could not create the server');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="mb-1 flex items-baseline justify-between">
        <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          Server name
        </label>
        <span className="text-xs text-gray-500" aria-hidden="true">
          {name.length}/{MAX_NAME}
        </span>
      </div>
      <div className="flex items-center gap-3">
        {icon ? (
          <img src={icon.preview} alt="Server icon preview" className="h-11 w-11 shrink-0 rounded-2xl object-cover ring-1 ring-ink-500" />
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-dashed border-ink-500 text-[10px] font-semibold uppercase leading-tight text-gray-400 transition hover:border-brand-hi hover:text-fg"
            aria-label="Add an icon"
            title="Add an icon"
          >
            Icon
          </button>
        )}
        <input
          id={id}
          ref={fieldRef}
          value={name}
          maxLength={MAX_NAME}
          onChange={(e) => {
            setName(e.target.value);
            setError('');
          }}
          placeholder="My friends"
          autoComplete="off"
          className="input"
        />
      </div>
      {icon && (
        <div className="mt-1 flex gap-3 text-xs">
          <button type="button" onClick={() => fileRef.current?.click()} className="text-brand-hi hover:underline">
            Change icon
          </button>
          <button type="button" onClick={() => setIcon(null)} className="text-gray-400 hover:text-danger">
            Remove icon
          </button>
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />

      <div className="mt-4">
        <TemplatePicker value={template} onChange={setTemplate} />
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      <Buttons busy={busy} disabled={!name.trim()} label="Create" onCancel={onCancel} />
      {framing && (
        <ImageCropper
          src={framing}
          shape="square"
          title="Position the server icon"
          onCancel={() => setFraming(null)}
          onSave={({ blob, crop }) => {
            setIcon({ original: framing, blob, crop, preview: URL.createObjectURL(blob) });
            setFraming(null);
          }}
        />
      )}
    </form>
  );
}

function JoinPanel({ fieldRef, initialCode, onJoin, onDone, onCancel }) {
  const [input, setInput] = useState(initialCode);
  const [preview, setPreview] = useState(null); // { space, members, alreadyMember }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const id = useId();
  const code = extractInviteCode(input);

  // Look the invite up as you type (or paste), so you see where it goes.
  useEffect(() => {
    setPreview(null);
    if (!code) {
      setError('');
      return undefined;
    }
    let live = true;
    const timer = setTimeout(() => {
      api
        .previewInvite(code)
        .then((p) => live && (setPreview(p), setError('')))
        .catch((err) => live && setError(err.message || 'That invite was not found'));
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [code]);

  async function submit(e) {
    e.preventDefault();
    if (!code || busy) return;
    setBusy(true);
    setError('');
    try {
      await onJoin(code);
      onDone();
    } catch (err) {
      setError(err.message || 'Could not join the server');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor={id} className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">
        Invite code or link
      </label>
      <input
        id={id}
        ref={fieldRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Paste an invite code"
        autoComplete="off"
        spellCheck={false}
        className="input font-mono"
      />
      {preview && (
        <div className="mt-3 rounded-lg bg-ink-900 px-3 py-2 text-sm">
          <div className="font-semibold text-gray-100">{preview.space}</div>
          <div className="text-xs text-gray-400">
            {preview.members} member{preview.members === 1 ? '' : 's'}
            {preview.alreadyMember && ' · You’re already a member'}
            {preview.banned && <span className="text-danger"> · You’re banned from this server</span>}
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      <Buttons busy={busy} disabled={!code || !!preview?.banned} label={preview?.alreadyMember ? 'Open' : 'Join'} onCancel={onCancel} />
    </form>
  );
}
