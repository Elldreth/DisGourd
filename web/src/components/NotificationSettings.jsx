import { useEffect, useState } from 'react';
import { getNotifyLevel, setNotifyLevel, getMessageSounds, setMessageSounds } from '../audio.js';
import { playMention } from '../sounds.js';
import { getPushSubscription, pushSupport, subscribeToPush, unsubscribeFromPush } from '../pwa.js';

const PREVIEWS_KEY = 'disgourd.pushPreviews';
const getPushPreviews = () => localStorage.getItem(PREVIEWS_KEY) !== '0';

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
  // Web Push (P2-18b): on when this browser has a subscription saved.
  const [support] = useState(() => pushSupport());
  const [pushOn, setPushOn] = useState(null); // null until checked
  const [pushPreviews, setPushPreviews] = useState(getPushPreviews);
  const [pushError, setPushError] = useState('');
  const [pushBusy, setPushBusy] = useState(false);
  useEffect(() => {
    if (!support.supported) return;
    let live = true;
    getPushSubscription()
      .then((sub) => live && setPushOn(!!sub))
      .catch(() => live && setPushOn(false));
    return () => {
      live = false;
    };
  }, [support.supported]);

  async function togglePush(e) {
    const on = e.target.checked;
    setPushError('');
    setPushBusy(true);
    try {
      if (on) {
        await subscribeToPush({ previews: pushPreviews });
        setPushOn(true);
        setPermission(permissionNow());
      } else {
        await unsubscribeFromPush();
        setPushOn(false);
      }
    } catch (err) {
      setPushError(err.message || 'Could not change push notifications');
      setPermission(permissionNow());
    } finally {
      setPushBusy(false);
    }
  }

  async function togglePushPreviews(e) {
    const on = e.target.checked;
    localStorage.setItem(PREVIEWS_KEY, on ? '1' : '0');
    setPushPreviews(on);
    if (!pushOn) return;
    setPushError('');
    try {
      await subscribeToPush({ previews: on }); // re-saves the subscription with the choice
    } catch (err) {
      setPushError(err.message || 'Could not save that');
    }
  }

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

      <fieldset>
        <legend className="mb-2 text-sm text-gray-200">When DisGourd is closed</legend>
        {support.supported ? (
          <div className="space-y-2">
            <label className="flex items-center justify-between gap-3">
              <span className="text-sm text-gray-200">
                Push notifications for mentions and DMs
                <span className="block text-xs text-gray-500">
                  Sent to this device when you have no DisGourd tab open and aren’t in Do Not Disturb.
                </span>
              </span>
              <input
                type="checkbox"
                checked={!!pushOn}
                disabled={pushOn === null || pushBusy}
                onChange={togglePush}
                className="h-4 w-4 accent-brand"
                aria-label="Push notifications for mentions and DMs"
              />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span className="text-sm text-gray-200">
                Include message text
                <span className="block text-xs text-gray-500">Off: the notification only says who wrote and where.</span>
              </span>
              <input
                type="checkbox"
                checked={pushPreviews}
                onChange={togglePushPreviews}
                className="h-4 w-4 accent-brand"
                aria-label="Include message text in push notifications"
              />
            </label>
            {pushError && (
              <p role="alert" className="text-xs text-pink">
                {pushError}
              </p>
            )}
          </div>
        ) : support.needsHomeScreen ? (
          <p role="status" className="text-xs text-gray-500">
            On iPhone and iPad, add DisGourd to your Home Screen first (Share → Add to Home Screen), then open it from there to
            turn on push notifications.
          </p>
        ) : (
          <p role="status" className="text-xs text-gray-500">
            This browser can’t receive push notifications while the app is closed.
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
