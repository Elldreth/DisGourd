import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import * as api from '../../../api.js';
import { numOrNull } from './constants.js';
import SaveBar from '../../settings/SaveBar.jsx';

// Site admin › Image generation (P2-20b, split into pages in P5-03): the
// drafts for every page live here, so an edit on one page survives a look at
// another and one save sends them all, exactly as the single form did.
// Wrap the pages in <ImagineSettingsProvider>; each page reads useImagine().
//   onDirtyChange(bool)  told when there are unsaved changes (Settings asks
//                        before closing)
//   onNavigate(page)     opens another page (the Overview's cards)
const Ctx = createContext(null);
export const useImagine = () => useContext(Ctx);

// The ComfyUI draft from the saved settings.
function comfyDraft(c) {
  return {
    enabled: !!c.enabled, url: c.url || '', model: c.model || '', kind: c.kind || 'checkpoint', family: c.family || (c.kind === 'unet' ? '' : 'sdxl'),
    tier: c.tier || 'medium', clip1: c.clip1 || '', clip2: c.clip2 || '', vae: c.vae || '',
    hires: c.hires !== false, upscaler: c.upscaler || '',
    upscaleMode: c.upscaleMode || 'model', tileDenoise: c.tileDenoise ?? 0.3, tileSize: c.tileSize || 1024,
    sampler: c.sampler || '', scheduler: c.scheduler || '', cfgScale: c.cfgScale ?? '', negative: c.negative || '',
    steps: { draft: c.steps?.draft ?? '', standard: c.steps?.standard ?? '', high: c.steps?.high ?? '' },
    detailer: !!c.detailer, detector: c.detector || '', detailerDenoise: c.detailerDenoise ?? 0.4,
    detailerPasses: c.detailerPasses || 1, tilePasses: c.tilePasses || 1, varyLoops: c.varyLoops || 2,
    varySubtle: c.varySubtle ?? 0.3, varyStrong: c.varyStrong ?? 0.65,
    workflowMode: c.workflowMode || 'builtin', workflow: c.workflow || '', upscaleWorkflow: c.upscaleWorkflow || '', img2imgWorkflow: c.img2imgWorkflow || '',
  };
}

// What Save sends (unchanged from the single form).
export function saveBody({ comfy, kie, kieKey, defaultEngine, general, savedDefault }) {
  // The default: the chosen one if it's on, else whichever engine is on.
  const on = [comfy.enabled && 'comfyui', kie.enabled && 'kie'].filter(Boolean);
  const chosenDefault = on.includes(defaultEngine) ? defaultEngine : on[0] || savedDefault;
  return {
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
        varySubtle: Number(comfy.varySubtle),
        varyStrong: Number(comfy.varyStrong),
        detailer: comfy.detailer,
        detector: comfy.detector || null,
        ...(comfy.detailer ? { detailerDenoise: Number(comfy.detailerDenoise), detailerPasses: Number(comfy.detailerPasses) } : {}),
        // Custom workflows (P3-34): the boxes are kept even while Built-in is chosen.
        workflowMode: comfy.workflowMode,
        workflow: comfy.workflow.trim() || null,
        upscaleWorkflow: comfy.upscaleWorkflow.trim() || null,
        img2imgWorkflow: comfy.img2imgWorkflow.trim() || null,
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
  };
}

const NO_PARTS = { clips: [], vaes: [], upscalers: [], suggested: {}, tiledAvailable: null, samplers: [], schedulers: [], detectors: [], detailerAvailable: null };

export function ImagineSettingsProvider({ children, onDirtyChange, onNavigate }) {
  const [data, setData] = useState(null);
  const [comfy, setComfy] = useState(null); // the ComfyUI draft
  const [kie, setKie] = useState(null); // the kie.ai draft (never holds the saved key)
  const [kieKey, setKieKey] = useState(''); // a new key typed in, sent once on Save
  const [kieNote, setKieNote] = useState({ text: '', ok: false });
  const [defaultEngine, setDefaultEngine] = useState(null);
  const [general, setGeneral] = useState(null); // { dailyLimit, permissive }
  const [baseline, setBaseline] = useState(null); // the drafts as last loaded or saved
  const [models, setModels] = useState(null); // [{ name, kind, family }] once tested
  const [parts, setParts] = useState(NO_PARTS); // split models, hires fix, Upscale, Advanced
  const [filter, setFilter] = useState('');
  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(''); // loading or saving failed

  function adopt(view) {
    setData(view);
    const c = view.engines.find((e) => e.id === 'comfyui')?.config || {};
    const k = view.engines.find((e) => e.id === 'kie')?.config || {};
    const drafts = {
      comfy: comfyDraft(c),
      kie: { enabled: !!k.enabled, model: k.model || '', customModel: k.customModel || '', monthlyCredits: k.monthlyCredits ?? '' },
      kieKey: '',
      defaultEngine: view.defaultEngine,
      general: { dailyLimit: view.dailyLimit, permissive: !!view.permissive },
    };
    setComfy(drafts.comfy);
    setKie(drafts.kie);
    setKieKey('');
    setDefaultEngine(drafts.defaultEngine);
    setGeneral(drafts.general);
    setBaseline(drafts);
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

  const current = comfy && { comfy, kie, kieKey, defaultEngine, general };
  const dirty = useMemo(() => !!(current && baseline) && JSON.stringify(current) !== JSON.stringify(baseline), [current, baseline]);
  useEffect(() => {
    onDirtyChange?.(dirty);
    if (dirty) setSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

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
      const fill = (c) => ({ ...c, url: res.url, upscaler: c.upscaler || res.suggested?.upscaler || '', detector: c.detector || res.suggested?.detector || '' });
      setComfy(fill);
      // The automatic test on open isn't an edit: what it fills in counts as loaded.
      if (quiet) setBaseline((b) => (b ? { ...b, comfy: fill(b.comfy) } : b));
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

  // A split model's suggested text encoders and VAE for its type (blank where
  // this ComfyUI has nothing that fits; the host picks from the lists).
  function withParts(c) {
    const s = parts.suggested?.[c.family];
    if (!s) return c;
    return { ...c, clip1: s.clip1 || '', clip2: c.family === 'flux' ? s.clip2 || '' : '', vae: s.vae || '' };
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
    try {
      const view = await api.saveImagineSettings(saveBody({ comfy, kie, kieKey, defaultEngine, general, savedDefault: data.defaultEngine }));
      adopt(view);
      setSaved(true);
    } catch (err) {
      setError(err.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setComfy(baseline.comfy);
    setKie(baseline.kie);
    setKieKey('');
    setDefaultEngine(baseline.defaultEngine);
    setGeneral(baseline.general);
    setError('');
  }

  const value = {
    ready: !!(data && comfy), loadError: !data ? error : '', data,
    comfy, setComfy, kie, setKie, kieKey, setKieKey, kieNote, defaultEngine, setDefaultEngine, general, setGeneral,
    models, parts, filter, setFilter, testing, testNote, test, pickModel, pickFamily, testKie,
    dirty, saving, saved, error, save, reset, onNavigate,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// "Loading…" (or why it failed) until the settings arrive.
export function ImagineLoading() {
  const s = useImagine();
  return <div className="text-sm text-gray-500">{s.loadError || 'Loading…'}</div>;
}

// The save bar under each page; "Saved" for a moment after a save.
export function ImagineSaveBar() {
  const s = useImagine();
  if (!s.ready) return null;
  if (!s.dirty)
    return s.saved ? (
      <p role="status" className="mt-6 text-sm text-online">
        Saved
      </p>
    ) : null;
  return <SaveBar dirty saving={s.saving} error={s.error} onSave={s.save} onReset={s.reset} />;
}
