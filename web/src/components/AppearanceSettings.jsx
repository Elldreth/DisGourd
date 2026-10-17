import { useState } from 'react';
import { getTheme, setTheme } from '../theme.js';

const CHOICES = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'Match my system', hint: 'Follows your device’s light or dark setting.' },
];

// Settings → Appearance: the theme for this browser.
export default function AppearanceSettings() {
  const [choice, setChoice] = useState(getTheme);

  function choose(value) {
    setTheme(value);
    setChoice(value);
  }

  return (
    <fieldset>
      <legend className="mb-2 text-sm text-gray-200">Theme</legend>
      <div className="space-y-1.5">
        {CHOICES.map((c) => (
          <label key={c.value} className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-ink-600/50">
            <input
              type="radio"
              name="theme"
              value={c.value}
              checked={choice === c.value}
              onChange={() => choose(c.value)}
              className="mt-1 h-4 w-4 accent-brand"
              aria-label={c.label}
            />
            <span className="text-sm text-gray-200">
              {c.label}
              {c.hint && <span className="block text-xs text-gray-500">{c.hint}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
