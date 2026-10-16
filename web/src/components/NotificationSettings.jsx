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
  // True after the browser's prompt was closed without Allow or Block.
  const [dismissed, setDismissed] = useState(false);
  const [testFailed, setTestFailed] = useState(false);

  async function choose(next) {
    setDismissed(false);
    if (next === 'off') {
      setNotifyLevel('off');
      setLevel('off');
      return;
    }
    let p = permissionNow();
    if (p === 'default') {
      p = await Notification.requestPermission();
      setPermission(p);
      if (p === 'default') setDismissed(true);
    }
    if (p !== 'granted') return; // the notices below explain what to do
    setNotifyLevel(next);
    setLevel(next);
  }

  function sendTest() {
    setTestFailed(false);
    try {
      new Notification('DisGourd test', { body: 'Desktop notifications are working.', icon: '/icon-192.png' });
    } catch {
      setTestFailed(true);
    }
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
        {dismissed && (
          <p role="status" className="mt-2 rounded-lg bg-idle/10 px-3 py-2 text-xs text-idle">
            The browser's prompt was closed without an answer, so notifications are still off. Choose a level again
            and click Allow. (In Chrome, the prompt may show as a small bell icon at the right of the address bar.)
          </p>
        )}
        {permission === 'granted' && (
          <div className="mt-2 flex items-center justify-between gap-3 px-2">
            <span className="text-xs text-gray-500">
              Nothing pops up? Check that your browser is allowed in Windows (or macOS) notification settings and that
              Do Not Disturb is off.
            </span>
            <button
              type="button"
              onClick={sendTest}
              className="shrink-0 rounded-md bg-ink-600 px-2.5 py-1 text-xs text-gray-200 hover:bg-ink-500"
            >
              Send a test notification
            </button>
          </div>
        )}
        {testFailed && (
          <p role="status" className="mt-2 text-xs text-pink">
            This browser wouldn't show a test notification from this page.
          </p>
        )}
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
