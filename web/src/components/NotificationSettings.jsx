import { useState } from 'react';
import { getNotifyLevel, setNotifyLevel, getMessageSounds, setMessageSounds } from '../audio.js';
import { playMention } from '../sounds.js';

const LEVELS = [
  { value: 'off', label: 'Off', hint: 'No desktop notifications.' },
  { value: 'mentions', label: 'Mentions and DMs', hint: 'When someone @mentions you or sends you a direct message.' },
  { value: 'all', label: 'All messages', hint: 'Every new message in your servers, plus mentions and DMs.' },
];

const permissionNow = () => (typeof Notification === 'undefined' || !Notification ? 'unsupported' : Notification.permission);

// Settings → Notifications. The browser's permission prompt appears only when
// you choose a level here, never on page load.
export default function NotificationSettings() {
  const [level, setLevel] = useState(getNotifyLevel);
  const [sounds, setSounds] = useState(getMessageSounds);
  const [permission, setPermission] = useState(permissionNow);

  async function choose(next) {
    if (next === 'off') {
      setNotifyLevel('off');
      setLevel('off');
      return;
    }
    let p = permissionNow();
    if (p === 'default') {
      p = await Notification.requestPermission();
      setPermission(p);
    }
    if (p !== 'granted') return; // the notice below explains what to do
    setNotifyLevel(next);
    setLevel(next);
  }

  function toggleSounds(e) {
    setMessageSounds(e.target.checked);
    setSounds(e.target.checked);
    if (e.target.checked) playMention(); // a preview of what you'll hear
  }

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-2 text-sm text-gray-200">Desktop notifications</legend>
        <div className="space-y-1.5">
          {LEVELS.map((l) => (
            <label key={l.value} className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-ink-600/50">
              <input
                type="radio"
                name="notify-level"
                value={l.value}
                checked={level === l.value}
                onChange={() => choose(l.value)}
                className="mt-1 h-4 w-4 accent-brand"
                aria-label={l.label}
              />
              <span className="text-sm text-gray-200">
                {l.label}
                <span className="block text-xs text-gray-500">{l.hint}</span>
              </span>
            </label>
          ))}
        </div>
        {permission === 'denied' && (
          <p role="status" className="mt-2 rounded-lg bg-pink/10 px-3 py-2 text-xs text-pink">
            Notifications are blocked for this site in your browser. To turn them on, allow notifications in the
            site settings (the icon left of the address bar), then choose a level here again.
          </p>
        )}
        {permission === 'unsupported' && (
          <p role="status" className="mt-2 text-xs text-gray-500">
            This browser doesn't support desktop notifications. Message sounds still work.
          </p>
        )}
      </fieldset>

      <label className="flex items-center justify-between gap-3">
        <span className="text-sm text-gray-200">
          Message sounds
          <span className="block text-xs text-gray-500">
            A chime for mentions and DMs (and a soft blip for other messages at “All messages”).
          </span>
        </span>
        <input
          type="checkbox"
          checked={sounds}
          onChange={toggleSounds}
          className="h-4 w-4 accent-brand"
          aria-label="Message sounds"
        />
      </label>
    </div>
  );
}
