import { useImagine, ImagineLoading } from './ImagineSettings.jsx';
import { TIERS, heading, card } from './constants.js';
import SettingRow from '../../settings/SettingRow.jsx';
import Switch from '../../settings/Switch.jsx';

// Image generation › ComfyUI: where it is and how much graphics memory there
// is, shared by every style. Each style's workflow and model are on the
// Styles page (P10-05).
export default function ComfyPage() {
  const s = useImagine();
  if (!s.ready) return <ImagineLoading />;
  const { comfy, setComfy, models, styles, defaultStyle, testing, testNote, test, onNavigate } = s;
  const def = styles.find((st) => st.id === defaultStyle);

  return (
    <div className="space-y-5">
      <SettingRow label="Use my ComfyUI (local, free)" description="Runs on your own computer with your own models.">
        <Switch label="Use my ComfyUI (local, free)" checked={comfy.enabled} onChange={(on) => setComfy((c) => ({ ...c, enabled: on }))} />
      </SettingRow>

      <div className={card}>
        <label htmlFor="imagine-comfy-url" className={heading}>ComfyUI address</label>
        <div className="flex gap-2">
          <input
            id="imagine-comfy-url"
            value={comfy.url}
            onChange={(e) => setComfy((c) => ({ ...c, url: e.target.value }))}
            placeholder="http://192.168.1.20:8188"
            className="input min-w-0 flex-1"
          />
          <button
            type="button"
            onClick={() => test()}
            disabled={testing || !comfy.url.trim()}
            className="shrink-0 rounded-lg bg-ink-600 px-3 py-2 text-sm font-medium text-fg hover:bg-ink-500 disabled:opacity-60"
          >
            {testing ? 'Testing…' : 'Test connection'}
          </button>
        </div>
        {testNote && (
          <p role="status" className={`text-xs ${models ? 'text-online' : 'text-danger'}`}>{testNote}</p>
        )}
        <p className="text-xs text-gray-500">
          ComfyUI on another computer must be started with <code>--listen</code>, and that computer needs a fixed address.
        </p>
      </div>

      <fieldset className={card}>
        <legend className={`${heading} float-left w-full`}>Graphics card memory (VRAM)</legend>
        <div className="clear-both grid gap-2 sm:grid-cols-3">
          {TIERS.map((t) => (
            <label key={t.v} className="flex items-start gap-2 text-sm text-gray-200">
              <input type="radio" name="imagine-tier" checked={comfy.tier === t.v} onChange={() => setComfy((c) => ({ ...c, tier: t.v }))} className="mt-1 accent-brand" />
              <span>
                {t.label}
                <span className="block text-xs text-gray-500">{t.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* P10-05: each style's workflow, model and Advanced settings have their own page. */}
      <div className={`${card} flex items-center gap-3`}>
        <p className="min-w-0 flex-1 text-sm text-gray-300">
          {styles.length === 1 ? '1 style' : `${styles.length} styles`}
          {def ? <span className="text-gray-500"> · default: {def.name.trim() || 'Untitled'}</span> : null}
          <span className="block text-xs text-gray-500">Each style has its own workflow, model and Advanced settings.</span>
        </p>
        {onNavigate && (
          <button type="button" onClick={() => onNavigate('imagine-styles')} className="shrink-0 rounded-lg bg-ink-600 px-3 py-1.5 text-sm font-medium text-fg hover:bg-ink-500">
            Edit styles
          </button>
        )}
      </div>
    </div>
  );
}
