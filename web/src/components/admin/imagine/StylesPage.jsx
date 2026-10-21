import { useImagine, ImagineLoading } from './ImagineSettings.jsx';
import {
  FAMILIES, SPLIT_FAMILIES, PLACEHOLDER_HELP, UPSCALE_PLACEHOLDER_HELP, IMG2IMG_PLACEHOLDER_HELP, TYPE_DEFAULTS, QUALITY_NAMES, modelKey, heading, card,
} from './constants.js';
import StylesSection, { StyleNameField } from './StylesSection.jsx';

// Image generation › Styles (P10-05): everything about one style on one page.
// The list (Add, Duplicate, Make default, Delete) picks the style; the panel
// under it is that style: its name, workflow, model and parts, prompt prefix,
// and (folded) its Advanced settings, which used to sit on the Quality page
// behind a second Style picker. Settings shared by every style stay on
// ComfyUI (address, graphics memory) and Quality (hires, upscale, faces).
export default function StylesPage() {
  const s = useImagine();
  if (!s.ready) return <ImagineLoading />;
  const { comfy, setComfy, editingStyle, models, parts, filter, setFilter, pickModel, pickFamily } = s;

  const list = (models || (comfy.model ? [{ name: comfy.model, kind: comfy.kind, family: comfy.family }] : [])).filter(
    (m) => !filter || m.name.toLowerCase().includes(filter.toLowerCase()) || m.name === comfy.model
  );
  const checkpoints = list.filter((m) => (m.kind || 'checkpoint') === 'checkpoint');
  const splitModels = list.filter((m) => m.kind === 'unet');
  const split = comfy.kind === 'unet';
  // The lists for a part: what ComfyUI has, or (before a test) the saved choice.
  const partOptions = (options, current) => (options.length ? options : current ? [current] : []);
  const custom = comfy.workflowMode === 'custom';
  const d = TYPE_DEFAULTS[comfy.family] || TYPE_DEFAULTS.sdxl;
  const listOr = (items, current) => (items.length ? items : current ? [current] : []);

  return (
    <div className="space-y-5">
      <StylesSection />

      <section aria-labelledby="imagine-style-editor" className="space-y-4 rounded-xl p-4 ring-1 ring-brand/40">
        <h3 id="imagine-style-editor" className="text-sm font-semibold text-fg">Editing style: {editingStyle.name.trim() || 'Untitled'}</h3>
        <StyleNameField />
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

        <div className={card}>
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
            <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="Model parts">
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
        <details className="rounded-xl bg-ink-900/60 px-4 py-3" aria-label="Advanced settings">
          <summary className="cursor-pointer select-none text-sm font-semibold text-gray-200">Advanced</summary>
          <div className="mt-3 space-y-3">
            <p className="text-xs text-gray-500">Blank uses the model type’s tuned default.</p>
            {custom && (
              <p className="rounded-md bg-ink-800 px-2 py-1 text-xs text-gray-400">
                With your own workflow, only Steps and the Negative prompt are used (through {'{{steps}}'} and {'{{negative}}'}); the rest is up to the workflow.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="imagine-sampler" className={heading}>Sampler</label>
                <select id="imagine-sampler" value={comfy.sampler} onChange={(e) => setComfy((c) => ({ ...c, sampler: e.target.value }))} className="input">
                  <option value="">Default ({d.sampler})</option>
                  {listOr(parts.samplers, comfy.sampler).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="imagine-scheduler" className={heading}>Scheduler</label>
                <select id="imagine-scheduler" value={comfy.scheduler} onChange={(e) => setComfy((c) => ({ ...c, scheduler: e.target.value }))} className="input">
                  <option value="">Default ({d.scheduler})</option>
                  {listOr(parts.schedulers, comfy.scheduler).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="imagine-cfg" className={heading}>CFG</label>
                <input id="imagine-cfg" type="number" min="0" max="30" step="0.5" value={comfy.cfgScale} placeholder={`Default (${d.cfg})`}
                  onChange={(e) => setComfy((c) => ({ ...c, cfgScale: e.target.value }))} className="input" />
              </div>
            </div>
            <fieldset>
              <legend className={heading}>Steps</legend>
              <div className="grid grid-cols-3 gap-3">
                {['draft', 'standard', 'high'].map((q) => (
                  <div key={q}>
                    <label htmlFor={`imagine-steps-${q}`} className="mb-1 block text-xs text-gray-400">{QUALITY_NAMES[q]}</label>
                    <input id={`imagine-steps-${q}`} type="number" min="1" max="150" step="1" value={comfy.steps[q]} placeholder={`Default (${d.steps[q]})`}
                      onChange={(e) => setComfy((c) => ({ ...c, steps: { ...c.steps, [q]: e.target.value } }))} className="input" />
                  </div>
                ))}
              </div>
            </fieldset>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="imagine-hires-steps" className={heading}>Hires steps</label>
                <input id="imagine-hires-steps" type="number" min="1" max="150" step="1" value={comfy.hiresSteps} placeholder={`Default (${d.hiresSteps})`}
                  onChange={(e) => setComfy((c) => ({ ...c, hiresSteps: e.target.value }))} className="input" />
              </div>
              {comfy.kind !== 'unet' && (comfy.family === 'sdxl' || comfy.family === 'sd15') && (
                <div>
                  <label htmlFor="imagine-clip-skip" className={heading}>CLIP skip</label>
                  <select id="imagine-clip-skip" value={comfy.clipSkip} onChange={(e) => setComfy((c) => ({ ...c, clipSkip: e.target.value }))} className="input">
                    <option value="">Default ({d.clipSkip})</option>
                    <option value="1">1 (off)</option>
                    <option value="2">2</option>
                  </select>
                </div>
              )}
            </div>
            <div>
              <label htmlFor="imagine-negative" className={heading}>Negative prompt</label>
              <textarea id="imagine-negative" rows={2} maxLength={1000} value={comfy.negative} placeholder="Default (lowres, worst quality, blurry, watermark…)"
                onChange={(e) => setComfy((c) => ({ ...c, negative: e.target.value }))} className="input" />
              <p className="mt-1 text-xs text-gray-500">Replaces the built-in one. Outside 18+ channels the safety words are still added for SD 1.5 / SDXL. Flux and Z-Image mostly ignore it.</p>
            </div>
          </div>
        </details>
      </section>
    </div>
  );
}
