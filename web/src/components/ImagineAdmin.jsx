import { useEffect, useState } from 'react';
import * as api from '../api.js';

const FAMILIES = [
  { v: 'sd15', label: 'SD 1.5' },
  { v: 'sdxl', label: 'SDXL (incl. Illustrious, Pony)' },
  { v: 'flux', label: 'Flux' },
];
// A model in separate parts (P3-24): a diffusion model plus text encoder(s) and VAE.
const SPLIT_FAMILIES = [
  { v: 'flux', label: 'Flux' },
  { v: 'zimage', label: 'Z-Image Turbo' },
];
// Each model type's tuned defaults (match the server's FAMILIES), shown as
// "Default (…)" in the Advanced settings (P3-31).
const TYPE_DEFAULTS = {
  sd15: { sampler: 'dpmpp_2m', scheduler: 'karras', cfg: 7, steps: { draft: 16, standard: 26, high: 34 } },
  sdxl: { sampler: 'dpmpp_2m', scheduler: 'karras', cfg: 6, steps: { draft: 18, standard: 28, high: 36 } },
  flux: { sampler: 'euler', scheduler: 'simple', cfg: 1, steps: { draft: 12, standard: 20, high: 28 } },
  zimage: { sampler: 'res_multistep', scheduler: 'simple', cfg: 1, steps: { draft: 6, standard: 8, high: 10 } },
};
const QUALITY_NAMES = { draft: 'Draft', standard: 'Standard', high: 'High' };
// A number field's value for the API: blank is null.
const numOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

// Custom workflow placeholders (P3-34), shown as help next to the boxes.
const PLACEHOLDER_HELP = [
  ['{{prompt}}', 'the prompt (required)'],
  ['{{negative}}', 'the negative prompt, with the safety words outside 18+ channels'],
  ['{{seed}}', 'a new random seed each time'],
  ['{{width}} / {{height}}', 'from Shape, Quality and the VRAM tier'],
  ['{{steps}}', 'by Quality (Advanced steps, or the model type’s defaults)'],
  ['{{quality}}', 'draft, standard or high'],
];
const UPSCALE_PLACEHOLDER_HELP = [
  ['{{image}}', 'the picture to upscale, for a LoadImage node (required)'],
  ['{{scale}}', 'how much to enlarge it (2, or less to stay within 4096 px)'],
  ['{{prompt}}, {{negative}}, {{seed}}', 'as above'],
];

// The model <select> value: kind and file name (the same name can be in both lists).
const modelKey = (kind, name) => (name ? `${kind}:${name}` : '');
const TIERS = [
  { v: 'low', label: 'Low', hint: 'up to ~8 GB · about 1 megapixel' },
  { v: 'medium', label: 'Medium', hint: '12–16 GB · about 1.5 megapixels' },
  { v: 'high', label: 'High', hint: '24 GB or more · up to about 2.4 megapixels' },
];
const SHAPES = [
  { v: 'square', label: 'Square' },
  { v: 'portrait', label: 'Portrait' },
  { v: 'landscape', label: 'Landscape' },
  { v: 'wide', label: 'Wide' },
];
const QUALITIES = [
  { v: 'draft', label: 'Draft' },
  { v: 'standard', label: 'Standard' },
  { v: 'high', label: 'High' },
];
const heading = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400';

// A kie.ai price for display: the last real one, or an estimate (P2-20c).
export function priceLabel(p) {
  if (!p) return 'price unknown until first use';
  return p.estimate ? `≈ ${p.credits} credits (est.)` : `${p.credits} credits`;
}

// Site-admin panel (P2-20b): /imagine on this instance. ComfyUI's address, a
// model picked from what that ComfyUI has, its type and the VRAM tier; the
// daily allowance and the 18+ switch; and a test image to try it all out.
export default function ImagineAdmin() {
  const [data, setData] = useState(null);
  const [comfy, setComfy] = useState(null); // the ComfyUI draft
  const [kie, setKie] = useState(null); // the kie.ai draft (never holds the saved key)
  const [kieKey, setKieKey] = useState(''); // a new key typed in, sent once on Save
  const [kieNote, setKieNote] = useState({ text: '', ok: false });
  const [defaultEngine, setDefaultEngine] = useState(null);
  const [general, setGeneral] = useState(null); // { dailyLimit, permissive }
  const [models, setModels] = useState(null); // [{ name, kind, family }] once tested
  const [parts, setParts] = useState({ clips: [], vaes: [], upscalers: [], suggested: {}, tiledAvailable: null, samplers: [], schedulers: [], detectors: [], detailerAvailable: null }); // split models, hires fix, Upscale, Advanced
  const [filter, setFilter] = useState('');
  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [tryForm, setTryForm] = useState({ engine: '', prompt: '', shape: 'square', quality: 'standard' });
  const [trying, setTrying] = useState(false);
  const [result, setResult] = useState(null);
  const [tryError, setTryError] = useState('');

  function adopt(view) {
    setData(view);
    const c = view.engines.find((e) => e.id === 'comfyui')?.config || {};
    setComfy({
      enabled: !!c.enabled, url: c.url || '', model: c.model || '', kind: c.kind || 'checkpoint', family: c.family || (c.kind === 'unet' ? '' : 'sdxl'),
      tier: c.tier || 'medium', clip1: c.clip1 || '', clip2: c.clip2 || '', vae: c.vae || '',
      hires: c.hires !== false, upscaler: c.upscaler || '',
      upscaleMode: c.upscaleMode || 'model', tileDenoise: c.tileDenoise ?? 0.3, tileSize: c.tileSize || 1024,
      sampler: c.sampler || '', scheduler: c.scheduler || '', cfgScale: c.cfgScale ?? '', negative: c.negative || '',
      steps: { draft: c.steps?.draft ?? '', standard: c.steps?.standard ?? '', high: c.steps?.high ?? '' },
      detailer: !!c.detailer, detector: c.detector || '', detailerDenoise: c.detailerDenoise ?? 0.4,
      detailerPasses: c.detailerPasses || 1, tilePasses: c.tilePasses || 1, varyLoops: c.varyLoops || 2,
      workflowMode: c.workflowMode || 'builtin', workflow: c.workflow || '', upscaleWorkflow: c.upscaleWorkflow || '',
    });
    const k = view.engines.find((e) => e.id === 'kie')?.config || {};
    setKie({ enabled: !!k.enabled, model: k.model || '', customModel: k.customModel || '', monthlyCredits: k.monthlyCredits ?? '' });
    setKieKey('');
    setDefaultEngine(view.defaultEngine);
    setGeneral({ dailyLimit: view.dailyLimit, permissive: !!view.permissive });
    return c;
  }

  useEffect(() => {
    api
      .getImagineSettings()
      .then((view) => {
        const c = adopt(view);
        if (c.url) test(c.url, { quiet: true });
      })
      .catch((err) => setError(err.message || 'Could not load the image settings'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function test(url = comfy?.url, { quiet = false } = {}) {
    setTesting(true);
    setTestNote('');
    try {
      const res = await api.testComfyUI(url);
      setModels(res.models);
      setParts({
        clips: res.clips || [], vaes: res.vaes || [], upscalers: res.upscalers || [], suggested: res.suggested || {}, tiledAvailable: !!res.tiledAvailable, tiledPassesAvailable: !!res.tiledPassesAvailable,
        samplers: res.samplers || [], schedulers: res.schedulers || [], detectors: res.detectors || [], detailerAvailable: !!res.detailerAvailable,
      });
      // The upscale model and face detector: the suggested ones until the host picks.
      setComfy((c) => ({ ...c, url: res.url, upscaler: c.upscaler || res.suggested?.upscaler || '', detector: c.detector || res.suggested?.detector || '' }));
      const count = (kind) => res.models.filter((m) => (m.kind || 'checkpoint') === kind).length;
      const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
      const split = count('unet');
      setTestNote(`Connected · ${plural(count('checkpoint'), 'checkpoint')}${split ? ` · ${plural(split, 'diffusion model')}` : ''}`);
    } catch (err) {
      setModels(null);
      if (!quiet || err.message) setTestNote(err.message || 'Could not reach ComfyUI');
    } finally {
      setTesting(false);
    }
  }

  function pickModel(key) {
    const kind = key.startsWith('unet:') ? 'unet' : 'checkpoint';
    const name = key.slice(kind.length + 1);
    const m = models?.find((x) => x.name === name && (x.kind || 'checkpoint') === kind);
    setComfy((c) => {
      const family = m ? m.family || '' : c.family;
      return kind === 'unet' ? withParts({ ...c, model: name, kind, family }) : { ...c, model: name, kind, family: family || 'sdxl' };
    });
  }

  // A split model's suggested text encoders and VAE for its type (blank where
  // this ComfyUI has nothing that fits; the host picks from the lists).
  function withParts(c) {
    const s = parts.suggested?.[c.family];
    if (!s) return c;
    return { ...c, clip1: s.clip1 || '', clip2: c.family === 'flux' ? s.clip2 || '' : '', vae: s.vae || '' };
  }

  function pickFamily(family) {
    setComfy((c) => (c.kind === 'unet' ? withParts({ ...c, family }) : { ...c, family }));
  }

  async function testKie() {
    setKieNote({ text: 'Checking…', ok: false });
    try {
      const { credits } = await api.testKie(kieKey);
      setKieNote({ text: `The key works · ${credits ?? '?'} credits left`, ok: true });
    } catch (err) {
      setKieNote({ text: err.message || 'Could not check the key', ok: false });
    }
  }

  async function save() {
    setSaving(true);
    setError('');
    setSaved(false);
    // The default: the chosen one if it's on, else whichever engine is on.
    const on = [comfy.enabled && 'comfyui', kie.enabled && 'kie'].filter(Boolean);
    const chosenDefault = on.includes(defaultEngine) ? defaultEngine : on[0] || data.defaultEngine;
    try {
      const view = await api.saveImagineSettings({
        engines: {
          comfyui: {
            enabled: comfy.enabled, url: comfy.url, model: comfy.model || null, kind: comfy.kind, family: comfy.family || null, tier: comfy.tier,
            clip1: comfy.kind === 'unet' ? comfy.clip1 || null : null,
            clip2: comfy.kind === 'unet' && comfy.family === 'flux' ? comfy.clip2 || null : null,
            vae: comfy.kind === 'unet' ? comfy.vae || null : null,
            hires: comfy.hires,
            upscaler: comfy.upscaler || null,
            upscaleMode: comfy.upscaleMode,
            ...(comfy.upscaleMode === 'tiled' ? { tileDenoise: Number(comfy.tileDenoise), tileSize: Number(comfy.tileSize), tilePasses: Number(comfy.tilePasses) } : {}),
            // Advanced (P3-31): blanks go back to the model type's defaults.
            sampler: comfy.sampler || null,
            scheduler: comfy.scheduler || null,
            cfgScale: numOrNull(comfy.cfgScale),
            steps: { draft: numOrNull(comfy.steps.draft), standard: numOrNull(comfy.steps.standard), high: numOrNull(comfy.steps.high) },
            negative: comfy.negative.trim() || null,
            varyLoops: Number(comfy.varyLoops),
            detailer: comfy.detailer,
            detector: comfy.detector || null,
            ...(comfy.detailer ? { detailerDenoise: Number(comfy.detailerDenoise), detailerPasses: Number(comfy.detailerPasses) } : {}),
            // Custom workflows (P3-34): the boxes are kept even while Built-in is chosen.
            workflowMode: comfy.workflowMode,
            workflow: comfy.workflow.trim() || null,
            upscaleWorkflow: comfy.upscaleWorkflow.trim() || null,
          },
          kie: {
            enabled: kie.enabled,
            model: kie.model || undefined,
            customModel: kie.customModel,
            monthlyCredits: kie.monthlyCredits === '' ? null : Number(kie.monthlyCredits),
            ...(kieKey.trim() ? { apiKey: kieKey.trim() } : {}),
          },
        },
        defaultEngine: chosenDefault,
        dailyLimit: general.dailyLimit,
        permissive: general.permissive,
      });
      adopt(view);
      setSaved(true);
    } catch (err) {
      setError(err.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  async function tryIt(e) {
    e.preventDefault();
    setTrying(true);
    setTryError('');
    setResult(null);
    try {
      setResult(await api.tryImagine({ ...tryForm, engine: tryForm.engine || tryEngines[0]?.id }));
    } catch (err) {
      setTryError(err.message || 'Could not generate');
    } finally {
      setTrying(false);
    }
  }

  if (!data || !comfy) return <div className="text-sm text-gray-500">{error || 'Loading…'}</div>;

  const savedComfy = data.engines.find((e) => e.id === 'comfyui')?.config || {};
  const kieEngine = data.engines.find((e) => e.id === 'kie');
  const savedKie = kieEngine?.config || {};
  const kieModels = kieEngine?.models || [];
  const kieModel = kieModels.find((m) => m.id === kie.model);
  // Engines with saved settings, for the test image.
  const tryEngines = [
    savedComfy.model && { id: 'comfyui', name: 'ComfyUI', detail: savedComfy.model },
    savedKie.model && (savedKie.keySaved || savedKie.envKey) && {
      id: 'kie', name: 'kie.ai', detail: savedKie.model === 'custom' ? savedKie.customModel : kieModels.find((m) => m.id === savedKie.model)?.name,
    },
  ].filter(Boolean);
  const bothOn = comfy.enabled && kie.enabled;
  const list = (models || (comfy.model ? [{ name: comfy.model, kind: comfy.kind, family: comfy.family }] : [])).filter(
    (m) => !filter || m.name.toLowerCase().includes(filter.toLowerCase()) || m.name === comfy.model
  );
  const checkpoints = list.filter((m) => (m.kind || 'checkpoint') === 'checkpoint');
  const splitModels = list.filter((m) => m.kind === 'unet');
  const split = comfy.kind === 'unet';
  // The lists for a part: what ComfyUI has, or (before a test) the saved choice.
  const partOptions = (list, current) => (list.length ? list : current ? [current] : []);

  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-400">
        Let people make images with <code className="text-brand-hi">/imagine</code>. Each server’s owner still turns it on for their server and
        chooses which roles may use it.
      </p>

      <fieldset className="space-y-3 rounded-lg bg-ink-900/60 p-3">
        <legend className="sr-only">ComfyUI</legend>
        <label className="flex items-center gap-2 text-sm font-semibold text-gray-200">
          <input type="checkbox" checked={comfy.enabled} onChange={(e) => setComfy((c) => ({ ...c, enabled: e.target.checked }))} className="h-4 w-4 accent-brand" />
          Use my ComfyUI (local, free)
        </label>

        <div>
          <label htmlFor="imagine-comfy-url" className={heading}>ComfyUI address</label>
          <div className="flex gap-2">
            <input
              id="imagine-comfy-url"
              value={comfy.url}
              onChange={(e) => setComfy((c) => ({ ...c, url: e.target.value }))}
              placeholder="http://192.168.1.20:8188"
              className="input flex-1"
            />
            <button
              type="button"
              onClick={() => test()}
              disabled={testing || !comfy.url.trim()}
              className="rounded-lg bg-ink-600 px-3 py-2 text-sm font-medium text-fg hover:bg-ink-500 disabled:opacity-60"
            >
              {testing ? 'Testing…' : 'Test connection'}
            </button>
          </div>
          {testNote && (
            <p role="status" className={`mt-1 text-xs ${models ? 'text-online' : 'text-danger'}`}>{testNote}</p>
          )}
          <p className="mt-1 text-xs text-gray-500">
            ComfyUI on another computer must be started with <code>--listen</code>, and that computer needs a fixed address.
          </p>
        </div>

        <fieldset>
          <legend className={heading}>Workflow</legend>
          <div className="space-y-1">
            {[['builtin', 'Built-in', 'DisGourd builds it from the settings below'], ['custom', 'My own', 'a workflow you built in ComfyUI, with placeholders']].map(([v, label, hint]) => (
              <label key={v} className="flex items-baseline gap-2 text-sm text-gray-200">
                <input type="radio" name="imagine-workflow-mode" checked={comfy.workflowMode === v} onChange={() => setComfy((c) => ({ ...c, workflowMode: v }))} className="accent-brand" />
                {label}
                <span className="text-xs text-gray-500">{hint}</span>
              </label>
            ))}
          </div>
          {comfy.workflowMode === 'custom' && (
            <div className="mt-2 space-y-3">
              {[
                ['workflow', 'Workflow (API format)', PLACEHOLDER_HELP, 'Paste the JSON from ComfyUI’s Export (API)…'],
                ['upscaleWorkflow', 'Upscale workflow (optional)', UPSCALE_PLACEHOLDER_HELP, 'Optional: a workflow for the Upscale button. Blank uses the built-in upscale.'],
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

        <div>
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
          <div className="space-y-3" role="group" aria-label="Model parts">
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
            <p className="text-xs text-gray-500">Suggested by name from what your ComfyUI has. Change them if your files are named differently.</p>
          </div>
        )}

        <fieldset>
          <legend className={heading}>Graphics card memory (VRAM)</legend>
          <div className="space-y-1">
            {TIERS.map((t) => (
              <label key={t.v} className="flex items-baseline gap-2 text-sm text-gray-200">
                <input type="radio" name="imagine-tier" checked={comfy.tier === t.v} onChange={() => setComfy((c) => ({ ...c, tier: t.v }))} className="accent-brand" />
                {t.label}
                <span className="text-xs text-gray-500">{t.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="imagine-upscaler" className={heading}>Upscale model</label>
          <select id="imagine-upscaler" value={comfy.upscaler} onChange={(e) => setComfy((c) => ({ ...c, upscaler: e.target.value }))} className="input">
            <option value="">Automatic (picked by name)</option>
            {(parts.upscalers.length ? parts.upscalers : comfy.upscaler ? [comfy.upscaler] : []).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <p className="mt-1 text-xs text-gray-500">Used by the hires fix and the Upscale button.</p>
          {models && !parts.upscalers.length && (
            <p className="mt-1 text-xs text-gray-500">This ComfyUI has no upscale models (models/upscale_models), so there’s no hires fix or Upscale button.</p>
          )}
        </div>

        <div>
          <label className={`flex items-center gap-2 text-sm ${comfy.workflowMode === 'custom' ? 'text-gray-500' : 'text-gray-200'}`}>
            <input type="checkbox" checked={comfy.hires} disabled={comfy.workflowMode === 'custom'} onChange={(e) => setComfy((c) => ({ ...c, hires: e.target.checked }))} className="h-4 w-4 accent-brand" />
            Hires fix for High quality
          </label>
          {comfy.workflowMode === 'custom' && <p className="mt-1 text-xs text-gray-500">Not used with your own workflow: it decides this.</p>}
          <p className="mt-1 text-xs text-gray-500">
            High-quality images are made at the Standard size, enlarged about 1.5× with the upscale model, then lightly repainted for detail. Slower, sharper.
          </p>
        </div>

        <fieldset disabled={comfy.workflowMode === 'custom' && !!comfy.upscaleWorkflow.trim()}>
          <legend className={heading}>Upscale button (2×, up to 4096 px)</legend>
          {comfy.workflowMode === 'custom' && comfy.upscaleWorkflow.trim() && (
            <p className="mb-1 text-xs text-gray-500">Your upscale workflow is used instead of these.</p>
          )}
          <div className="space-y-1">
            <label className="flex items-baseline gap-2 text-sm text-gray-200">
              <input type="radio" name="imagine-upscale-mode" checked={comfy.upscaleMode !== 'tiled'} onChange={() => setComfy((c) => ({ ...c, upscaleMode: 'model' }))} className="accent-brand" />
              Upscale model only
              <span className="text-xs text-gray-500">fast, nothing to tune</span>
            </label>
            <label className={`flex items-baseline gap-2 text-sm ${parts.tiledAvailable === false ? 'text-gray-500' : 'text-gray-200'}`}>
              <input
                type="radio"
                name="imagine-upscale-mode"
                checked={comfy.upscaleMode === 'tiled'}
                disabled={parts.tiledAvailable === false && comfy.upscaleMode !== 'tiled'}
                onChange={() => setComfy((c) => ({ ...c, upscaleMode: 'tiled' }))}
                className="accent-brand"
              />
              Tiled repaint
              <span className="text-xs text-gray-500">adds detail; may need tuning</span>
            </label>
          </div>
          {parts.tiledAvailable === false && (
            <p className="mt-1 text-xs text-gray-500">
              Tiled repaint needs the <strong>ComfyUI_UltimateSDUpscale</strong> custom node (by ssitu), which ComfyUI Manager can install.
            </p>
          )}
          {parts.tiledAvailable === false && comfy.upscaleMode === 'tiled' && (
            <p role="alert" className="mt-1 rounded-md bg-idle/15 px-2 py-1 text-xs text-idle">
              Tiled repaint is chosen, but this ComfyUI doesn’t have it, so the Upscale button uses the upscale model only.
            </p>
          )}
          {comfy.upscaleMode === 'tiled' && (
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="imagine-tile-denoise" className={heading}>Repaint strength</label>
                <input
                  id="imagine-tile-denoise"
                  type="number"
                  min="0.05"
                  max="0.6"
                  step="0.05"
                  value={comfy.tileDenoise}
                  onChange={(e) => setComfy((c) => ({ ...c, tileDenoise: e.target.value }))}
                  className="input"
                />
              </div>
              <div>
                <label htmlFor="imagine-tile-size" className={heading}>Tile size</label>
                <select id="imagine-tile-size" value={comfy.tileSize} onChange={(e) => setComfy((c) => ({ ...c, tileSize: Number(e.target.value) }))} className="input">
                  {[512, 768, 1024, 1280, 1536, 2048].map((n) => <option key={n} value={n}>{n} px</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="imagine-tile-passes" className={heading}>Tiled passes</label>
                <select id="imagine-tile-passes" value={comfy.tilePasses} disabled={parts.tiledPassesAvailable === false}
                  onChange={(e) => setComfy((c) => ({ ...c, tilePasses: Number(e.target.value) }))} className="input">
                  {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <p className="col-span-2 text-xs text-gray-500">
                Lower strength keeps the image as it is; higher adds detail but can change faces or repeat things across tiles (0.2–0.35 is usual). Bigger tiles need more VRAM. Each extra pass repaints the enlarged image again and takes about as long as the first.
              </p>
            </div>
          )}
        </fieldset>

        <details className="rounded-lg bg-ink-800/60 px-3 py-2" aria-label="Advanced settings">
          <summary className="cursor-pointer select-none text-sm font-semibold text-gray-200">Advanced</summary>
          {(() => {
            const d = TYPE_DEFAULTS[comfy.family] || TYPE_DEFAULTS.sdxl;
            const listOr = (list, current) => (list.length ? list : current ? [current] : []);
            return (
              <div className="mt-3 space-y-3">
                <p className="text-xs text-gray-500">For every /imagine on this instance. Blank uses the model type’s tuned default.</p>
                {comfy.workflowMode === 'custom' && (
                  <p className="rounded-md bg-ink-900/60 px-2 py-1 text-xs text-gray-400">
                    With your own workflow, only Steps and the Negative prompt are used (through {'{{steps}}'} and {'{{negative}}'}); the rest is up to the workflow.
                  </p>
                )}
                <div className="grid grid-cols-2 gap-3">
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
                <div>
                  <label htmlFor="imagine-negative" className={heading}>Negative prompt</label>
                  <textarea id="imagine-negative" rows={2} maxLength={1000} value={comfy.negative} placeholder="Default (lowres, worst quality, blurry, watermark…)"
                    onChange={(e) => setComfy((c) => ({ ...c, negative: e.target.value }))} className="input" />
                  <p className="mt-1 text-xs text-gray-500">Replaces the built-in one. Outside 18+ channels the safety words are still added for SD 1.5 / SDXL. Flux and Z-Image mostly ignore it.</p>
                </div>
                <div>
                  <label htmlFor="imagine-vary-loops" className={heading}>Variation loops</label>
                  <select id="imagine-vary-loops" value={comfy.varyLoops} onChange={(e) => setComfy((c) => ({ ...c, varyLoops: Number(e.target.value) }))} className="input">
                    {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    Subtle and Strong variations are a loopback: each loop repaints the whole image (about 0.3 for Subtle, 0.5 for Strong, a new seed each
                    time), runs the face detailer if it’s on, and feeds the result into the next loop.
                  </p>
                </div>
                <fieldset disabled={parts.detailerAvailable === false && !comfy.detailer}>
                  <label className="flex items-center gap-2 text-sm text-gray-200">
                    <input type="checkbox" checked={comfy.detailer} onChange={(e) => setComfy((c) => ({ ...c, detailer: e.target.checked }))} className="h-4 w-4 accent-brand" />
                    Face detailer on Standard and High
                  </label>
                  <p className="mt-1 text-xs text-gray-500">Finds faces and repaints them at a better size. Adds a few seconds to images with faces.</p>
                  {parts.detailerAvailable === false && (
                    <p className="mt-1 text-xs text-gray-500">
                      Needs the <strong>ComfyUI-Impact-Pack</strong> and <strong>ComfyUI-Impact-Subpack</strong> custom nodes (by ltdrdata; ComfyUI Manager can install
                      both), plus a face detector model such as face_yolov8m.pt in models/ultralytics/bbox.
                    </p>
                  )}
                  {parts.detailerAvailable === false && comfy.detailer && (
                    <p role="alert" className="mt-1 rounded-md bg-idle/15 px-2 py-1 text-xs text-idle">
                      The face detailer is on, but this ComfyUI doesn’t have it, so images are made without it.
                    </p>
                  )}
                  {comfy.detailer && (
                    <div className="mt-2 grid grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="imagine-detector" className={heading}>Face detector</label>
                        <select id="imagine-detector" value={comfy.detector} onChange={(e) => setComfy((c) => ({ ...c, detector: e.target.value }))} className="input">
                          <option value="">Automatic (picked by name)</option>
                          {listOr(parts.detectors, comfy.detector).map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="imagine-detailer-denoise" className={heading}>Face repaint strength</label>
                        <input id="imagine-detailer-denoise" type="number" min="0.1" max="0.8" step="0.05" value={comfy.detailerDenoise}
                          onChange={(e) => setComfy((c) => ({ ...c, detailerDenoise: e.target.value }))} className="input" />
                      </div>
                      <div>
                        <label htmlFor="imagine-detailer-passes" className={heading} title="Repeats the repaint inside each face crop; not a loopback of the whole image">Face detailer passes</label>
                        <select id="imagine-detailer-passes" value={comfy.detailerPasses} onChange={(e) => setComfy((c) => ({ ...c, detailerPasses: Number(e.target.value) }))} className="input">
                          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </div>
                      <p className="col-span-2 text-xs text-gray-500">
                        Passes repeat the repaint inside each face crop (it isn’t a loopback of the whole image; that’s Variation loops above). 1 is usually enough.
                      </p>
                    </div>
                  )}
                </fieldset>
              </div>
            );
          })()}
        </details>
      </fieldset>

      <fieldset className="space-y-3 rounded-lg bg-ink-900/60 p-3">
        <legend className="sr-only">kie.ai</legend>
        <label className="flex items-center gap-2 text-sm font-semibold text-gray-200">
          <input type="checkbox" checked={kie.enabled} onChange={(e) => setKie((k) => ({ ...k, enabled: e.target.checked }))} className="h-4 w-4 accent-brand" />
          Use kie.ai (paid, with your API key)
        </label>
        <div>
          <label htmlFor="imagine-kie-key" className={heading}>kie.ai API key</label>
          {savedKie.envKey ? (
            <p className="text-sm text-gray-400">Using the KIEAI_API_KEY set in the server’s environment.</p>
          ) : (
            <input
              id="imagine-kie-key"
              type="password"
              autoComplete="off"
              value={kieKey}
              onChange={(e) => setKieKey(e.target.value)}
              placeholder={savedKie.keySaved ? `A key is saved (${savedKie.keyHint}) — type to replace it` : 'Paste your kie.ai API key'}
              className="input"
            />
          )}
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              onClick={testKie}
              disabled={!kieKey.trim() && !savedKie.keySaved && !savedKie.envKey}
              className="rounded-lg bg-ink-600 px-3 py-1.5 text-sm font-medium text-fg hover:bg-ink-500 disabled:opacity-60"
            >
              Test key
            </button>
            {kieNote.text && <span role="status" className={`text-xs ${kieNote.ok ? 'text-online' : 'text-gray-400'}`}>{kieNote.text}</span>}
          </div>
          <p className="mt-1 text-xs text-gray-500">The key stays on the server; it’s never shown again or sent to anyone’s browser.</p>
        </div>
        <div>
          <label htmlFor="imagine-kie-model" className={heading}>kie.ai model</label>
          <select id="imagine-kie-model" value={kie.model} onChange={(e) => setKie((k) => ({ ...k, model: e.target.value }))} className="input">
            <option value="">Pick a model…</option>
            {kieModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id === 'custom' ? 'Custom model ID…' : `${m.name} — ${priceLabel(m.price)}`}
              </option>
            ))}
          </select>
          {kieModel && (
            <p className="mt-1 text-xs text-gray-500">
              {kieModel.note} {kieModel.filterable ? 'Content filter on outside 18+ channels.' : ''}
            </p>
          )}
          {kie.model === 'custom' && (
            <input
              aria-label="Custom model ID"
              value={kie.customModel}
              onChange={(e) => setKie((k) => ({ ...k, customModel: e.target.value }))}
              placeholder="vendor/model-name, as kie.ai lists it"
              className="input mt-2"
            />
          )}
        </div>
        <div>
          <label htmlFor="imagine-kie-cap" className={heading}>Monthly credit cap</label>
          <input
            id="imagine-kie-cap"
            type="number"
            min={0}
            value={kie.monthlyCredits}
            onChange={(e) => setKie((k) => ({ ...k, monthlyCredits: e.target.value }))}
            placeholder="No cap"
            className="input w-40"
          />
          <p className="mt-1 text-xs text-gray-500">
            /imagine stops using kie.ai for the rest of the month once this many credits are used. Prices change and new models appear:
            check{' '}
            <a href="https://kie.ai/pricing" target="_blank" rel="noreferrer" className="text-brand-hi underline">kie.ai’s pricing</a> and{' '}
            <a href="https://kie.ai/market" target="_blank" rel="noreferrer" className="text-brand-hi underline">model list</a>. Prices here are the last
            real cost DisGourd saw.
          </p>
        </div>
      </fieldset>

      {bothOn && (
        <fieldset>
          <legend className={heading}>Default engine</legend>
          <div className="flex gap-4 text-sm text-gray-200">
            {[['comfyui', 'ComfyUI'], ['kie', 'kie.ai']].map(([id, name]) => (
              <label key={id} className="flex items-center gap-1.5">
                <input type="radio" name="imagine-default" checked={(defaultEngine || 'comfyui') === id} onChange={() => setDefaultEngine(id)} className="accent-brand" />
                {name}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-gray-500">People can still pick the other one in the /imagine panel.</p>
        </fieldset>
      )}

      <fieldset className="space-y-3">
        <legend className="sr-only">For everyone</legend>
        <div>
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
          <p className="mt-1 text-xs text-gray-500">
            The default for every server. A server can set its own number (up to {data.dailyCeiling}), which takes priority.
          </p>
          {data.serverLimits?.length > 0 && (
            <div className="mt-2 rounded-lg bg-ink-900/60 px-3 py-2 text-xs text-gray-300" aria-label="Servers with their own limit">
              <p className="mb-1 font-semibold">These servers set their own limit, which takes priority:</p>
              <ul className="space-y-0.5">
                {data.serverLimits.map((s) => (
                  <li key={s.space}>
                    {s.space} — {s.limit} a day
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-gray-500">Change one in that server’s menu → Image generation (blank uses this default).</p>
            </div>
          )}
        </div>
        <label className="flex items-start gap-2 text-sm text-gray-200">
          <input type="checkbox" checked={general.permissive} onChange={(e) => setGeneral((g) => ({ ...g, permissive: e.target.checked }))} className="mt-0.5 h-4 w-4 accent-brand" />
          <span>
            Allow unfiltered images in channels marked 18+
            <span className="mt-1 block text-xs text-gray-500">
              ComfyUI has no content filter of its own. Outside 18+ channels DisGourd only adds “nsfw, nude” to the negative prompt for SD 1.5 and SDXL,
              which discourages but doesn’t block (Flux ignores it). Sexual images involving minors are refused everywhere. You’re responsible for
              what your instance makes.
            </span>
          </span>
        </label>
      </fieldset>

      {error && <div role="alert" className="text-sm text-danger">{error}</div>}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && <span role="status" className="text-sm text-online">Saved</span>}
      </div>

      <form onSubmit={tryIt} className="space-y-2 rounded-lg bg-ink-900/60 p-3" aria-label="Generate a test image">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Generate a test image</div>
        {!tryEngines.length ? (
          <p className="text-sm text-gray-500">Save an engine’s settings first.</p>
        ) : (
          <>
            <input
              value={tryForm.prompt}
              onChange={(e) => setTryForm((f) => ({ ...f, prompt: e.target.value }))}
              placeholder="a friendly gourd wearing a top hat"
              aria-label="Test prompt"
              maxLength={1000}
              className="input"
            />
            <div className="flex flex-wrap gap-2">
              {tryEngines.length > 1 && (
                <select aria-label="Engine" value={tryForm.engine || tryEngines[0].id} onChange={(e) => setTryForm((f) => ({ ...f, engine: e.target.value }))} className="input w-auto">
                  {tryEngines.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              )}
              <select aria-label="Shape" value={tryForm.shape} onChange={(e) => setTryForm((f) => ({ ...f, shape: e.target.value }))} className="input w-auto">
                {SHAPES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
              </select>
              <select aria-label="Quality" value={tryForm.quality} onChange={(e) => setTryForm((f) => ({ ...f, quality: e.target.value }))} className="input w-auto">
                {QUALITIES.map((q) => <option key={q.v} value={q.v}>{q.label}</option>)}
              </select>
              <button
                type="submit"
                disabled={trying || !tryForm.prompt.trim()}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
              >
                {trying ? 'Generating…' : 'Generate'}
              </button>
            </div>
            <p className="text-xs text-gray-500">
              Uses the saved settings ({(tryEngines.find((e) => e.id === tryForm.engine) || tryEngines[0]).detail}).
            </p>
          </>
        )}
        {tryError && <div role="alert" className="text-sm text-danger">{tryError}</div>}
        {result && (
          <figure>
            <img src={result.url} alt={`Test image: ${tryForm.prompt}`} className="max-h-80 rounded-lg" />
            <figcaption className="mt-1 text-xs text-gray-400">
              {result.width && result.height ? `${result.width}×${result.height} · ` : ''}
              {(result.ms / 1000).toFixed(1)} s{result.cost != null ? ` · ${result.cost} credits` : ''}
            </figcaption>
          </figure>
        )}
      </form>
    </div>
  );
}
