import { useImagine, ImagineLoading } from './ImagineSettings.jsx';
import {
  FAMILIES, SPLIT_FAMILIES, PLACEHOLDER_HELP, UPSCALE_PLACEHOLDER_HELP, IMG2IMG_PLACEHOLDER_HELP, modelKey, TIERS, heading, card,
} from './constants.js';
import SettingRow from '../../settings/SettingRow.jsx';
import Switch from '../../settings/Switch.jsx';
import StylesSection from './StylesSection.jsx';

// Image generation › ComfyUI: where it is, which workflow, which model and
// its parts, and how much graphics memory there is.
export default function ComfyPage() {
  const s = useImagine();
  if (!s.ready) return <ImagineLoading />;
  const { comfy, setComfy, editingStyle, models, parts, filter, setFilter, testing, testNote, test, pickModel, pickFamily } = s;

  const list = (models || (comfy.model ? [{ name: comfy.model, kind: comfy.kind, family: comfy.family }] : [])).filter(
    (m) => !filter || m.name.toLowerCase().includes(filter.toLowerCase()) || m.name === comfy.model
  );
  const checkpoints = list.filter((m) => (m.kind || 'checkpoint') === 'checkpoint');
  const splitModels = list.filter((m) => m.kind === 'unet');
  const split = comfy.kind === 'unet';
  // The lists for a part: what ComfyUI has, or (before a test) the saved choice.
  const partOptions = (options, current) => (options.length ? options : current ? [current] : []);

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

      <StylesSection />

      <p className="text-sm font-semibold text-fg">Editing style: {editingStyle.name.trim() || 'Untitled'}</p>

      <fieldset className={card}>
        <legend className={`${heading} float-left w-full`}>Workflow</legend>
        <div className="clear-both grid gap-2 sm:grid-cols-2">
          {[['builtin', 'Built-in', 'DisGourd builds it from these settings'], ['custom', 'My own', 'a workflow you built in ComfyUI, with placeholders']].map(([v, label, hint]) => (
            <label key={v} className="flex items-start gap-2 text-sm text-gray-200">
              <input type="radio" name="imagine-workflow-mode" checked={comfy.workflowMode === v} onChange={() => setComfy((c) => ({ ...c, workflowMode: v }))} className="mt-1 accent-brand" />
              <span>
                {label}
                <span className="block text-xs text-gray-500">{hint}</span>
              </span>
            </label>
          ))}
        </div>
        {comfy.workflowMode === 'custom' && (
          <div className="space-y-3 pt-1">
            {[
              ['workflow', 'Workflow (API format)', PLACEHOLDER_HELP, 'Paste the JSON from ComfyUI’s Export (API)…'],
              ['upscaleWorkflow', 'Upscale workflow (optional)', UPSCALE_PLACEHOLDER_HELP, 'Optional: a workflow for the Upscale button. Blank uses the built-in upscale.'],
              ['img2imgWorkflow', 'Image-to-image workflow (optional)', IMG2IMG_PLACEHOLDER_HELP, 'Optional: a workflow for Variations and “Start from a picture”. Blank uses the built-in image-to-image.'],
            ].map(([key, label, help, placeholder]) => (
              <div key={key}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label htmlFor={`imagine-${key}`} className={heading.replace('mb-1 ', '')}>{label}</label>
                  <label className="cursor-pointer rounded-md px-2 py-0.5 text-xs font-medium text-brand-hi hover:bg-ink-700">
                    Load file…
                    <input
                      type="file"
                      accept=".json,application/json"
                      className="sr-only"
                      aria-label={`Load ${label.toLowerCase()} from a file`}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const text = await file.text();
                          setComfy((c) => ({ ...c, [key]: text }));
                        }
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
                <textarea
                  id={`imagine-${key}`}
                  rows={6}
                  spellCheck={false}
                  value={comfy[key]}
                  placeholder={placeholder}
                  onChange={(e) => setComfy((c) => ({ ...c, [key]: e.target.value }))}
                  className="input font-mono text-xs"
                />
                <details className="mt-1 text-xs text-gray-500">
                  <summary className="cursor-pointer select-none">Placeholders</summary>
                  <ul className="mt-1 space-y-0.5">
                    {help.map(([name, what]) => (
                      <li key={name}><code className="text-brand-hi">{name}</code> — {what}</li>
                    ))}
                  </ul>
                </details>
              </div>
            ))}
            <p className="text-xs text-gray-500">
              In ComfyUI, put the placeholders in your workflow’s fields (e.g. a prompt box reading <code>masterpiece, {'{{prompt}}'}</code>, a seed of
              {' '}<code>{'{{seed}}'}</code>), then use <strong>Export (API)</strong>. On Save, DisGourd checks that every node in it is installed. Every image the
              workflow saves or previews is posted (up to 4).
            </p>
          </div>
        )}
      </fieldset>

      <div className={`${card} sm:grid sm:grid-cols-2 sm:gap-x-3 sm:space-y-0 sm:gap-y-3`}>
        <div className="min-w-0">
          <label htmlFor="imagine-model" className={heading}>Model</label>
          {models && models.length > 12 && (
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter models" aria-label="Filter models" className="input mb-2" />
          )}
          <select id="imagine-model" value={modelKey(comfy.kind, comfy.model)} onChange={(e) => pickModel(e.target.value)} className="input" disabled={!list.length}>
            <option value="">{models ? 'Pick a model…' : 'Test the connection to list models'}</option>
            {splitModels.length > 0 ? (
              <>
                <optgroup label="Checkpoints">
                  {checkpoints.map((m) => <option key={`c${m.name}`} value={modelKey('checkpoint', m.name)}>{m.name}</option>)}
                </optgroup>
                <optgroup label="Separate parts (diffusion models)">
                  {splitModels.map((m) => <option key={`u${m.name}`} value={modelKey('unet', m.name)}>{m.name}</option>)}
                </optgroup>
              </>
            ) : (
              checkpoints.map((m) => <option key={`c${m.name}`} value={modelKey('checkpoint', m.name)}>{m.name}</option>)
            )}
          </select>
          {split && <p className="mt-1 text-xs text-gray-500">This model comes in separate parts: pick its text encoder and VAE below.</p>}
        </div>

        <div>
          <label htmlFor="imagine-family" className={heading}>Model type</label>
          <select id="imagine-family" value={comfy.family} onChange={(e) => pickFamily(e.target.value)} className="input">
            {split && !comfy.family && <option value="">Pick the type…</option>}
            {(split ? SPLIT_FAMILIES : FAMILIES).map((f) => <option key={f.v} value={f.v}>{f.label}</option>)}
          </select>
          <p className="mt-1 text-xs text-gray-500">Guessed from the model’s folder and name. It picks the workflow and the image sizes.</p>
        </div>

        {split && comfy.family && (
          <div className="sm:col-span-2 grid gap-3 sm:grid-cols-2" role="group" aria-label="Model parts">
            {[
              ['clip1', comfy.family === 'flux' ? 'Text encoder (CLIP-L)' : 'Text encoder', parts.clips],
              ...(comfy.family === 'flux' ? [['clip2', 'Text encoder (T5-XXL)', parts.clips]] : []),
              ['vae', 'VAE', parts.vaes],
            ].map(([key, label, options]) => (
              <div key={key}>
                <label htmlFor={`imagine-${key}`} className={heading}>{label}</label>
                <select id={`imagine-${key}`} value={comfy[key]} onChange={(e) => setComfy((c) => ({ ...c, [key]: e.target.value }))} className="input">
                  <option value="">Pick one…</option>
                  {partOptions(options, comfy[key]).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            ))}
            <p className="text-xs text-gray-500 sm:col-span-2">Suggested by name from what your ComfyUI has. Change them if your files are named differently.</p>
          </div>
        )}
      </div>

      <div className={card}>
        <label htmlFor="imagine-prompt-prefix" className={heading}>Prompt prefix (optional)</label>
        <input
          id="imagine-prompt-prefix"
          value={comfy.promptPrefix}
          maxLength={300}
          onChange={(e) => setComfy((c) => ({ ...c, promptPrefix: e.target.value }))}
          placeholder="e.g. RAW photo, natural light,"
          className="input"
        />
        <p className="text-xs text-gray-500">Goes in front of every prompt in this style. The message in chat still shows only what the person typed.</p>
      </div>

      <p className="text-sm font-semibold text-fg">Shared by every style</p>

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
    </div>
  );
}
