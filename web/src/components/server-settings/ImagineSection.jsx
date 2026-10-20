import { useEffect, useState } from 'react';
import SaveBar from '../settings/SaveBar.jsx';
import SettingRow from '../settings/SettingRow.jsx';
import Switch from '../settings/Switch.jsx';
import * as api from '../../api.js';

// Server settings › Image generation (P2-20d; a section since P5-04), for
// people who may edit the server: allow /imagine here and set a daily limit
// per person (blank = the instance's default; the server caps it at the
// instance ceiling). `info` is the server's `imagine` from GET /spaces.
// Changes wait for the save bar; onDirtyChange tells the window.
export default function ImagineSection({ space, info, onSaved, onDirtyChange }) {
  const fromInfo = () => ({ enabled: !!info?.serverEnabled, limit: info?.ownLimit == null ? '' : String(info.ownLimit) });
  const [saved, setSaved] = useState(fromInfo);
  const [enabled, setEnabled] = useState(saved.enabled);
  const [limit, setLimit] = useState(saved.limit);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const noEngine = !info?.engines?.length;
  const instanceLimit = info?.instanceLimit ?? info?.dailyLimit ?? '—';
  const dirty = enabled !== saved.enabled || limit !== saved.limit;
  useEffect(() => {
    onDirtyChange?.(dirty);
    if (dirty) setDone(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  async function save() {
    setBusy(true);
    setError('');
    try {
      await api.setServerImagine(space, { enabled, dailyLimit: limit === '' ? null : parseInt(limit, 10) });
      setSaved({ enabled, limit });
      setDone(true);
      onSaved?.();
    } catch (err) {
      setError(err.message || 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setEnabled(saved.enabled);
    setLimit(saved.limit);
    setError('');
  }

  return (
    <div className="space-y-5">
      <SettingRow label={<>Allow <code className="text-brand-hi">/imagine</code> in this server</>}>
        <Switch label="Allow /imagine in this server" checked={enabled} onChange={setEnabled} />
      </SettingRow>
      {noEngine && (
        <p className="rounded-lg bg-ink-700/60 px-3 py-2 text-sm text-gray-300">
          No image engine is set up on this instance yet. A site admin sets one up in Settings → Image generation.
        </p>
      )}
      <div className="rounded-xl bg-ink-900/60 p-4">
        <label htmlFor="server-imagine-limit" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">
          Images per person per day
        </label>
        <input
          id="server-imagine-limit"
          type="number"
          min={1}
          value={limit}
          onChange={(e) => setLimit(e.target.value.replace(/\D/g, ''))}
          placeholder={`Instance default (${instanceLimit})`}
          className="input w-48"
        />
        <p className="mt-1 text-xs text-gray-500">
          Leave blank to use the instance’s default ({instanceLimit} a day, set in Settings → Image generation). A
          number here takes priority over it.
        </p>
      </div>
      <p className="text-sm text-gray-400">
        Who may use it: give roles the <span className="font-semibold text-gray-200">Generate images</span> permission in Roles.
        Channels marked 18+ (in channel settings) may allow unfiltered images, if the instance allows it.
      </p>
      {dirty ? (
        <SaveBar dirty saving={busy} error={error} onSave={save} onReset={reset} />
      ) : done ? (
        <p role="status" className="text-sm text-online">
          Saved
        </p>
      ) : null}
    </div>
  );
}
