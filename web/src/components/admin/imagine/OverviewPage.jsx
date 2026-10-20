import { useImagine, ImagineLoading } from './ImagineSettings.jsx';
import { heading, card } from './constants.js';
import SettingRow from '../../settings/SettingRow.jsx';
import Switch from '../../settings/Switch.jsx';
import Icon from '../../Icon.jsx';

// Image generation › Overview: is each engine set up (a card that opens its
// page), which one is the default, and the rules for everyone: the daily
// allowance and the 18+ policy.
export default function OverviewPage() {
  const s = useImagine();
  if (!s.ready) return <ImagineLoading />;
  const { data, comfy, kie, defaultEngine, setDefaultEngine, general, setGeneral, models, testNote, onNavigate } = s;
  const savedComfy = data.engines.find((e) => e.id === 'comfyui')?.config || {};
  const kieEngine = data.engines.find((e) => e.id === 'kie');
  const savedKie = kieEngine?.config || {};
  const kieModelName = savedKie.model === 'custom' ? savedKie.customModel : kieEngine?.models?.find((m) => m.id === savedKie.model)?.name;
  const bothOn = comfy.enabled && kie.enabled;

  const engines = [
    {
      id: 'comfyui',
      name: 'ComfyUI',
      on: !!savedComfy.enabled,
      lines: [
        savedComfy.model ? savedComfy.model : 'No model picked yet',
        savedComfy.url ? (models ? `Reachable · ${models.length} model${models.length === 1 ? '' : 's'}` : testNote ? 'Not reachable right now' : 'Checking…') : 'No address yet',
      ],
      bad: savedComfy.url && !models && !!testNote,
    },
    kieEngine && {
      id: 'kie',
      name: 'kie.ai',
      on: !!savedKie.enabled,
      lines: [
        kieModelName || 'No model picked yet',
        savedKie.keySaved || savedKie.envKey ? (savedKie.monthlyCredits ? `Cap: ${savedKie.monthlyCredits} credits a month` : 'No monthly cap') : 'No API key yet',
      ],
    },
  ].filter(Boolean);

  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-400">
        Let people make images with <code className="text-brand-hi">/imagine</code>. Each server’s owner still turns it on for their server and chooses
        which roles may use it.
      </p>

      <div className="grid gap-3 sm:grid-cols-2" role="list" aria-label="Engines">
        {engines.map((e) => (
          <button
            key={e.id}
            type="button"
            role="listitem"
            onClick={() => onNavigate?.(e.id === 'comfyui' ? 'imagine-comfy' : 'imagine-kie')}
            className="group flex flex-col gap-1 rounded-xl bg-ink-900/60 p-4 text-left ring-1 ring-ink-500/40 transition hover:ring-brand-hi"
          >
            <span className="flex items-center gap-2">
              <span className="text-sm font-semibold text-fg">{e.name}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${e.on ? 'bg-online/15 text-online' : 'bg-ink-600 text-gray-400'}`}>{e.on ? 'On' : 'Off'}</span>
              <Icon name="chevronLeft" size={16} className="ml-auto rotate-180 text-gray-500 transition group-hover:text-fg" />
            </span>
            <span className="truncate text-xs text-gray-400">{e.lines[0]}</span>
            <span className={`truncate text-xs ${e.bad ? 'text-danger' : 'text-gray-500'}`}>{e.lines[1]}</span>
          </button>
        ))}
      </div>

      {bothOn && (
        <fieldset className={card}>
          <legend className={`${heading} float-left w-full`}>Default engine</legend>
          <div className="clear-both flex gap-4 text-sm text-gray-200">
            {[['comfyui', 'ComfyUI'], ['kie', 'kie.ai']].map(([id, name]) => (
              <label key={id} className="flex items-center gap-1.5">
                <input type="radio" name="imagine-default" checked={(defaultEngine || 'comfyui') === id} onChange={() => setDefaultEngine(id)} className="accent-brand" />
                {name}
              </label>
            ))}
          </div>
          <p className="text-xs text-gray-500">People can still pick the other one in the /imagine panel.</p>
        </fieldset>
      )}

      <div className={card}>
        <label htmlFor="imagine-daily" className={heading}>Images per person per day</label>
        <input
          id="imagine-daily"
          type="number"
          min={1}
          max={data.dailyCeiling}
          value={general.dailyLimit}
          onChange={(e) => setGeneral((g) => ({ ...g, dailyLimit: parseInt(e.target.value, 10) || 1 }))}
          className="input w-28"
        />
        <p className="text-xs text-gray-500">
          The default for every server. A server can set its own number (up to {data.dailyCeiling}), which takes priority.
        </p>
        {data.serverLimits?.length > 0 && (
          <div className="rounded-lg bg-ink-800 px-3 py-2 text-xs text-gray-300" aria-label="Servers with their own limit">
            <p className="mb-1 font-semibold">These servers set their own limit, which takes priority:</p>
            <ul className="space-y-0.5">
              {data.serverLimits.map((sl) => (
                <li key={sl.space}>
                  {sl.space} — {sl.limit} a day
                </li>
              ))}
            </ul>
            <p className="mt-1 text-gray-500">Change one in that server’s Server settings → Image generation (blank uses this default).</p>
          </div>
        )}
      </div>

      <SettingRow
        label="Allow unfiltered images in channels marked 18+"
        description="ComfyUI has no content filter of its own. Outside 18+ channels DisGourd only adds “nsfw, nude” to the negative prompt for SD 1.5 and SDXL, which discourages but doesn’t block (Flux ignores it). Sexual images involving minors are refused everywhere. You’re responsible for what your instance makes."
      >
        <Switch label="Allow unfiltered images in channels marked 18+" checked={general.permissive} onChange={(on) => setGeneral((g) => ({ ...g, permissive: on }))} />
      </SettingRow>
    </div>
  );
}
