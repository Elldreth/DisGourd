import { useEffect, useState } from 'react';
import * as api from '../api.js';

const FAMILIES = [
  { v: 'sd15', label: 'SD 1.5' },
  { v: 'sdxl', label: 'SDXL (incl. Illustrious, Pony)' },
  { v: 'flux', label: 'Flux' },
];
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

// Site-admin panel (P2-20b): /imagine on this instance. ComfyUI's address, a
// model picked from what that ComfyUI has, its type and the VRAM tier; the
// daily allowance and the 18+ switch; and a test image to try it all out.
export default function ImagineAdmin() {
  const [data, setData] = useState(null);
  const [comfy, setComfy] = useState(null); // the ComfyUI draft
  const [general, setGeneral] = useState(null); // { dailyLimit, permissive }
  const [models, setModels] = useState(null); // [{ name, family }] once tested
  const [filter, setFilter] = useState('');
  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [tryForm, setTryForm] = useState({ prompt: '', shape: 'square', quality: 'standard' });
  const [trying, setTrying] = useState(false);
  const [result, setResult] = useState(null);
  const [tryError, setTryError] = useState('');

  function adopt(view) {
    setData(view);
    const c = view.engines.find((e) => e.id === 'comfyui')?.config || {};
    setComfy({ enabled: !!c.enabled, url: c.url || '', model: c.model || '', family: c.family || 'sdxl', tier: c.tier || 'medium' });
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
      setComfy((c) => ({ ...c, url: res.url }));
      setTestNote(`Connected · ${res.models.length} checkpoint${res.models.length === 1 ? '' : 's'}`);
    } catch (err) {
      setModels(null);
      if (!quiet || err.message) setTestNote(err.message || 'Could not reach ComfyUI');
    } finally {
      setTesting(false);
    }
  }

  function pickModel(name) {
    const m = models?.find((x) => x.name === name);
    setComfy((c) => ({ ...c, model: name, family: m ? m.family : c.family }));
  }

  async function save() {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const view = await api.saveImagineSettings({
        engines: { comfyui: { enabled: comfy.enabled, url: comfy.url, model: comfy.model || null, family: comfy.family, tier: comfy.tier } },
        defaultEngine: comfy.enabled ? 'comfyui' : data.defaultEngine,
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
      setResult(await api.tryImagine({ engine: 'comfyui', ...tryForm }));
    } catch (err) {
      setTryError(err.message || 'Could not generate');
    } finally {
      setTrying(false);
    }
  }

  if (!data || !comfy) return <div className="text-sm text-gray-500">{error || 'Loading…'}</div>;

  const savedComfy = data.engines.find((e) => e.id === 'comfyui')?.config || {};
  const list = (models || (comfy.model ? [{ name: comfy.model, family: comfy.family }] : [])).filter(
    (m) => !filter || m.name.toLowerCase().includes(filter.toLowerCase()) || m.name === comfy.model
  );

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

        <div>
          <label htmlFor="imagine-model" className={heading}>Model</label>
          {models && models.length > 12 && (
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter models" aria-label="Filter models" className="input mb-2" />
          )}
          <select id="imagine-model" value={comfy.model} onChange={(e) => pickModel(e.target.value)} className="input" disabled={!list.length}>
            <option value="">{models ? 'Pick a model…' : 'Test the connection to list models'}</option>
            {list.map((m) => (
              <option key={m.name} value={m.name}>{m.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="imagine-family" className={heading}>Model type</label>
          <select id="imagine-family" value={comfy.family} onChange={(e) => setComfy((c) => ({ ...c, family: e.target.value }))} className="input">
            {FAMILIES.map((f) => <option key={f.v} value={f.v}>{f.label}</option>)}
          </select>
          <p className="mt-1 text-xs text-gray-500">Guessed from the model’s folder and name. It picks the workflow and the image sizes.</p>
        </div>

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
      </fieldset>

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
          <p className="mt-1 text-xs text-gray-500">Server owners can set a lower number for their server.</p>
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
        {!savedComfy.model ? (
          <p className="text-sm text-gray-500">Save an address and a model first.</p>
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
            <p className="text-xs text-gray-500">Uses the saved settings ({savedComfy.model}).</p>
          </>
        )}
        {tryError && <div role="alert" className="text-sm text-danger">{tryError}</div>}
        {result && (
          <figure>
            <img src={result.url} alt={`Test image: ${tryForm.prompt}`} className="max-h-80 rounded-lg" />
            <figcaption className="mt-1 text-xs text-gray-400">
              {result.width}×{result.height} · {(result.ms / 1000).toFixed(1)} s
            </figcaption>
          </figure>
        )}
      </form>
    </div>
  );
}
