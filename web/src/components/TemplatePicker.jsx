import { useId } from 'react';
import { SERVER_TEMPLATES } from '../serverTemplates.js';

// "Start with": radio cards for a new server's starter channels, each showing
// the channels it creates. Used by Add a server and the setup wizard.
export default function TemplatePicker({ value, onChange, legend = 'Start with' }) {
  const group = useId();
  return (
    <fieldset>
      <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{legend}</legend>
      <div className="grid grid-cols-2 gap-2">
        {SERVER_TEMPLATES.map((t) => (
          <label
            key={t.id}
            className={`flex cursor-pointer flex-col rounded-lg p-2 ring-1 transition ${
              value === t.id ? 'bg-ink-700 ring-brand-hi' : 'ring-ink-500 hover:bg-ink-700/60'
            }`}
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-gray-100">
              <input
                type="radio"
                name={group}
                value={t.id}
                checked={value === t.id}
                onChange={() => onChange(t.id)}
                className="h-3.5 w-3.5 accent-brand"
              />
              {t.label}
            </span>
            <span className="mt-1 text-[11px] leading-snug text-gray-400">{t.channels.join(' · ')}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
