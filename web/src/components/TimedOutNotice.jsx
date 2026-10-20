import { useEffect, useState } from 'react';
import Mascot from './Mascot.jsx';
import { formatTime } from '../util.js';

// In place of the message box while I'm timed out in this server (P3-26c):
// "You're timed out in this server until 4:30 PM" (with the day when it isn't
// today) and the reason.
export function timeoutEnd(until, now = new Date()) {
  const d = new Date(until);
  const today = d.toDateString() === now.toDateString();
  return today ? formatTime(until) : `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}, ${formatTime(until)}`;
}

// `timeout` ({ until, reason } from the server) while it lasts, else null. A
// timer re-renders when it ends, so the message box comes back by itself.
export function useActiveTimeout(timeout) {
  const [now, setNow] = useState(() => Date.now());
  const until = timeout?.until ?? 0;
  useEffect(() => {
    if (until <= Date.now()) return undefined;
    const t = setTimeout(() => setNow(Date.now()), Math.min(until - Date.now() + 50, 2 ** 31 - 1));
    return () => clearTimeout(t);
  }, [until]);
  return timeout && until > Math.max(now, Date.now()) ? timeout : null;
}

export default function TimedOutNotice({ timeout }) {
  return (
    <div role="status" className="mx-4 mb-5 mt-1 rounded-xl bg-ink-800 px-4 py-3 text-center text-sm text-gray-300 ring-1 ring-danger/50">
      <div className="flex items-center justify-center gap-2">
        <Mascot pose="shush" size={28} className="shrink-0" />
        You’re timed out in this server until {timeoutEnd(timeout.until)}.
      </div>
      {timeout.reason && <div className="mt-1 text-xs text-gray-400">Reason: {timeout.reason}</div>}
    </div>
  );
}
