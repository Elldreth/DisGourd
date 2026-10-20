import { useState } from 'react';
import { useImagine } from './ImagineSettings.jsx';
import { heading, card } from './constants.js';
import ConfirmDialog from '../../ConfirmDialog.jsx';

export const MAX_STYLES = 20;

// What a style runs, for its row: the model's file name, or "Own workflow".
function summary(s) {
  if (s.workflowMode === 'custom') return 'Own workflow';
  if (!s.model) return 'No model yet';
  return s.model.split(/[\\/]/).pop().replace(/\.(safetensors|ckpt|gguf|pt|pth|bin)$/i, '');
}

// Image generation › ComfyUI › Styles (P9-04b): the named setups people pick
// in the Imagine panel. Choosing one here shows its settings below.
export default function StylesSection() {
  const { styles, defaultStyle, editingStyle, styleActions } = useImagine();
  const [deleting, setDeleting] = useState(null);
  const name = editingStyle.name;
  const nameProblem = !name.trim()
    ? 'Give the style a name.'
    : name.trim().length > 30
      ? 'Keep the name to 30 characters or fewer.'
      : styles.some((s) => s !== editingStyle && s.name.trim().toLowerCase() === name.trim().toLowerCase())
        ? 'Another style has this name.'
        : '';
  const small = 'rounded-md px-2 py-1 text-xs font-medium text-brand-hi hover:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <section className={card} aria-labelledby="imagine-styles-heading">
      <div>
        <h3 id="imagine-styles-heading" className={heading}>Styles</h3>
        <p className="text-xs text-gray-500">
          People pick a style in the Imagine panel. Each style has its own workflow, model and Advanced settings. The address, graphics memory, Quality, Upscale and Variations settings are shared by every style.
        </p>
      </div>

      <ul className="space-y-1" aria-label="Styles">
        {styles.map((st) => {
          const on = st.id === editingStyle.id;
          return (
            <li key={st.id}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => styleActions.edit(st.id)}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${on ? 'bg-ink-600 text-fg' : 'text-gray-300 hover:bg-ink-700'}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{st.name.trim() || 'Untitled'}</span>
                  <span className="block truncate text-xs text-gray-500">{summary(st)}</span>
                </span>
                {st.id === defaultStyle && <span className="shrink-0 rounded bg-brand/20 px-1.5 py-0.5 text-[11px] font-semibold text-brand-hi">Default</span>}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-1">
        <button type="button" className={small} onClick={styleActions.add} disabled={styles.length >= MAX_STYLES}>Add style</button>
        <button type="button" className={small} onClick={() => styleActions.duplicate(editingStyle.id)} disabled={styles.length >= MAX_STYLES}>Duplicate</button>
        <button type="button" className={small} onClick={() => styleActions.makeDefault(editingStyle.id)} disabled={editingStyle.id === defaultStyle}>Make default</button>
        <button type="button" className={`${small} text-danger`} onClick={() => setDeleting(editingStyle)} disabled={styles.length < 2}>Delete</button>
        {styles.length >= MAX_STYLES && <span className="text-xs text-gray-500">At most {MAX_STYLES} styles.</span>}
      </div>

      <div>
        <label htmlFor="imagine-style-name" className={heading}>Style name</label>
        <input
          id="imagine-style-name"
          value={name}
          maxLength={40}
          onChange={(e) => styleActions.rename(editingStyle.id, e.target.value)}
          className="input"
          aria-invalid={!!nameProblem}
          aria-describedby={nameProblem ? 'imagine-style-name-problem' : undefined}
        />
        {nameProblem && <p id="imagine-style-name-problem" className="mt-1 text-xs text-danger">{nameProblem}</p>}
      </div>

      {deleting && (
        <ConfirmDialog
          title={`Delete “${deleting.name.trim() || 'Untitled'}”?`}
          body={`Images already made with it stay. Their Variations, Upscale and Retry will use the default style${deleting.id === defaultStyle ? ', which becomes the first style left' : ''}. Nothing changes until you save.`}
          confirmLabel="Delete style"
          danger
          onConfirm={() => {
            styleActions.remove(deleting.id);
            setDeleting(null);
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  );
}
