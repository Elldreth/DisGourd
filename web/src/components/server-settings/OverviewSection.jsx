import { useEffect, useRef, useState } from 'react';
import SaveBar from '../settings/SaveBar.jsx';
import { colorForName, initials } from '../../util.js';
import GlyphPicker from '../GlyphPicker.jsx';

// Server settings › Overview (P5-04): the server's name and icon, and (for
// the owner) Delete server in a danger zone at the bottom. The name waits for
// the save bar; icon changes happen at once, as they did from the menu.
export default function OverviewSection({
  space, icon, canEdit, canReframeIcon, isOwner, onRename, onChangeIcon, onRemoveIcon, onReframeIcon, onUseGlyph, onDelete, onDirtyChange,
  saved = false, // "Saved" after a rename (kept by the window: a rename reloads the server)
  onSavedChange,
}) {
  const [name, setName] = useState(space || '');
  const fileRef = useRef(null);
  // A rename (here or elsewhere) changes `space`: start from the new name.
  useEffect(() => setName(space || ''), [space]);
  const trimmed = name.trim();
  const dirty = canEdit && trimmed !== (space || '');
  useEffect(() => {
    onDirtyChange?.(dirty);
    if (dirty) onSavedChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  function save() {
    if (!trimmed) return;
    onRename(trimmed);
    onSavedChange?.(true);
  }

  const secondary = 'tap rounded-lg px-3 py-2 text-sm text-gray-300 ring-1 ring-ink-500/60 transition hover:bg-ink-700 hover:text-fg disabled:opacity-50';
  return (
    <div className="space-y-6">
      {canEdit && (
        <div className="flex flex-wrap items-center gap-4 rounded-xl bg-ink-900/60 p-4">
          <span
            className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl text-lg font-semibold text-white"
            style={{ backgroundColor: icon ? undefined : colorForName(space || '') }}
          >
            {icon ? <img src={icon} alt="" className="h-full w-full object-cover" /> : initials(space || '?')}
          </span>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => fileRef.current?.click()} className={secondary}>
              {icon ? 'Change icon' : 'Upload icon'}
            </button>
            {icon && canReframeIcon && (
              <button type="button" onClick={onReframeIcon} className={secondary}>
                Reposition
              </button>
            )}
            {icon && (
              <button type="button" onClick={onRemoveIcon} className={secondary}>
                Remove
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            aria-label="Server icon"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) onChangeIcon(file);
            }}
          />
          {onUseGlyph && (
            <div className="w-full">
              <GlyphPicker onPick={(file) => onUseGlyph(file)} label={icon ? 'Or switch to a ready-made icon' : 'Or pick a ready-made icon'} />
            </div>
          )}
        </div>
      )}

      {canEdit && (
        <div>
          <label htmlFor="server-name" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">
            Server name
          </label>
          <input id="server-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} className="input max-w-sm" />
          {dirty && !trimmed && <p className="mt-1 text-xs text-danger">The name can’t be empty.</p>}
        </div>
      )}

      {isOwner && (
        <section aria-label="Danger zone" className="rounded-xl p-4 ring-1 ring-danger/40">
          <h3 className="text-sm font-semibold text-danger">Danger zone</h3>
          <p className="mt-1 text-sm text-gray-400">Deleting the server removes its channels and every message, for everyone. It can’t be undone.</p>
          <button
            type="button"
            onClick={onDelete}
            className="tap mt-3 rounded-lg px-3 py-2 text-sm font-semibold text-danger ring-1 ring-danger/50 transition hover:bg-danger/10"
          >
            Delete server
          </button>
        </section>
      )}

      {dirty ? (
        <SaveBar dirty onSave={save} onReset={() => setName(space || '')} />
      ) : saved ? (
        <p role="status" className="text-sm text-online">
          Saved
        </p>
      ) : null}
    </div>
  );
}
