import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
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

// Style presets (P9-04b): what belongs to one style; the rest is shared.
export const STYLE_FIELDS = ['model', 'kind', 'family', 'clip1', 'clip2', 'vae', 'sampler', 'scheduler', 'cfgScale', 'negative', 'steps', 'promptPrefix', 'workflowMode', 'workflow', 'upscaleWorkflow', 'img2imgWorkflow', 'clipSkip', 'hiresSteps'];
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));
const omit = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

// One style's draft from the saved settings.
export function styleDraft(c = {}) {
  return {
    model: c.model || '', kind: c.kind || 'checkpoint', family: c.family || (c.kind === 'unet' ? '' : 'sdxl'),
    clip1: c.clip1 || '', clip2: c.clip2 || '', vae: c.vae || '',
    sampler: c.sampler || '', scheduler: c.scheduler || '', cfgScale: c.cfgScale ?? '', negative: c.negative || '',
    steps: { draft: c.steps?.draft ?? '', standard: c.steps?.standard ?? '', high: c.steps?.high ?? '' },
    promptPrefix: c.promptPrefix || '',
    clipSkip: c.clipSkip ? String(c.clipSkip) : '', hiresSteps: c.hiresSteps ?? '', // P9-08
    workflowMode: c.workflowMode || 'builtin', workflow: c.workflow || '', upscaleWorkflow: c.upscaleWorkflow || '', img2imgWorkflow: c.img2imgWorkflow || '',
  };
}

// The ComfyUI draft from the saved settings: the shared settings, plus
// `styles` ([{ id, name, saved, …style }]) and `defaultStyle`.
function comfyDraft(c) {
  const presets = c.presets?.length ? c.presets : [{ id: 'default', name: 'Default', ...c }];
  return {
    enabled: !!c.enabled, url: c.url || '',
    tier: c.tier || 'medium',
    hires: c.hires !== false, upscaler: c.upscaler || '', hiresDenoise: c.hiresDenoise ?? 0.45,
    upscaleMode: c.upscaleMode || 'model', tileDenoise: c.tileDenoise ?? 0.2, tileSize: c.tileSize || 1280,
    detailer: !!c.detailer, detector: c.detector || '', detailerDenoise: c.detailerDenoise ?? 0.3,
    detailerPasses: c.detailerPasses || 3, tilePasses: c.tilePasses || 1, varyLoops: c.varyLoops || 2,
    varySubtle: c.varySubtle ?? 0.3, varyStrong: c.varyStrong ?? 0.65,
    styles: presets.map((p) => ({ id: p.id, name: p.name, saved: true, ...styleDraft(p) })),
    defaultStyle: c.defaultPreset || presets[0].id,
  };
}

// One style as Save sends it (P9-04b; the fields as the single form sent them).
function styleBody(s) {
  return {
    // A new style has no id yet: the server makes one from its name.
    ...(s.saved ? { id: s.id } : {}),
    name: s.name.trim(),
    model: s.model || null, kind: s.kind, family: s.family || null,
    clip1: s.kind === 'unet' ? s.clip1 || null : null,
    clip2: s.kind === 'unet' && s.family === 'flux' ? s.clip2 || null : null,
    vae: s.kind === 'unet' ? s.vae || null : null,
    // Advanced (P3-31): blanks go back to the model type's defaults.
    sampler: s.sampler || null,
    scheduler: s.scheduler || null,
    cfgScale: numOrNull(s.cfgScale),
    steps: { draft: numOrNull(s.steps.draft), standard: numOrNull(s.steps.standard), high: numOrNull(s.steps.high) },
    negative: s.negative.trim() || null,
    promptPrefix: s.promptPrefix.trim() || null,
    // P9-08: blank = the model type's default.
    clipSkip: s.clipSkip ? Number(s.clipSkip) : null,
    hiresSteps: numOrNull(s.hiresSteps),
    // Custom workflows (P3-34): the boxes are kept even while Built-in is chosen.
    workflowMode: s.workflowMode,
    workflow: s.workflow.trim() || null,
    upscaleWorkflow: s.upscaleWorkflow.trim() || null,
    img2imgWorkflow: s.img2imgWorkflow.trim() || null,
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
        enabled: comfy.enabled, url: comfy.url, tier: comfy.tier,
        hires: comfy.hires,
        hiresDenoise: Number(comfy.hiresDenoise), // P9-08
        upscaler: comfy.upscaler || null,
        upscaleMode: comfy.upscaleMode,
        ...(comfy.upscaleMode === 'tiled' ? { tileDenoise: Number(comfy.tileDenoise), tileSize: Number(comfy.tileSize), tilePasses: Number(comfy.tilePasses) } : {}),
        varyLoops: Number(comfy.varyLoops),
        varySubtle: Number(comfy.varySubtle),
        varyStrong: Number(comfy.varyStrong),
        detailer: comfy.detailer,
        detector: comfy.detector || null,
        ...(comfy.detailer ? { detailerDenoise: Number(comfy.detailerDenoise), detailerPasses: Number(comfy.detailerPasses) } : {}),
        // Style presets (P9-04b): every style, and which is the default.
        presets: comfy.styles.map(styleBody),
        defaultPreset: comfy.defaultStyle,
      },
      kie: {
        enabled: kie.enabled,
        model: kie.model || undefined,
        customModel: kie.customModel,
        pictureModel: kie.pictureModel || null, // P9-05b
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
  const [comfyAll, setComfyAll] = useState(null); // the ComfyUI draft: shared settings, `styles`, `defaultStyle`
  const [editingId, setEditingId] = useState(null); // the style the pages edit (P9-04b)
  const editingRef = useRef(null);
  editingRef.current = editingId;
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
      kie: { enabled: !!k.enabled, model: k.model || '', customModel: k.customModel || '', pictureModel: k.pictureModel || '', monthlyCredits: k.monthlyCredits ?? '' },
      kieKey: '',
      defaultEngine: view.defaultEngine,
      general: { dailyLimit: view.dailyLimit, permissive: !!view.permissive },
    };
    setComfyAll(drafts.comfy);
    // Keep editing the same style (by name: a new one just got its id), else the default.
    setEditingId((id) => {
      const before = comfyRef.current?.styles?.find((s) => s.id === id);
      const same = drafts.comfy.styles.find((s) => s.id === id) || (before && drafts.comfy.styles.find((s) => s.name === before.name));
      return same ? same.id : drafts.comfy.defaultStyle;
    });
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

  // The pages see one flat ComfyUI draft: the shared settings plus the style
  // being edited; their changes go back to the right place (P9-04b).
  const comfyRef = useRef(null);
  comfyRef.current = comfyAll;
  const editing = comfyAll && (comfyAll.styles.find((s) => s.id === editingId) || comfyAll.styles[0]);
  const comfy = comfyAll && { ...omit(comfyAll, ['styles', 'defaultStyle']), ...pick(editing, STYLE_FIELDS) };
  const setComfy = (update) =>
    setComfyAll((all) => {
      const style = all.styles.find((s) => s.id === editingRef.current) || all.styles[0];
      const flat = { ...omit(all, ['styles', 'defaultStyle']), ...pick(style, STYLE_FIELDS) };
      const next = typeof update === 'function' ? update(flat) : update;
      return {
        ...all,
        ...omit(next, STYLE_FIELDS),
        styles: all.styles.map((s) => (s.id === style.id ? { ...s, ...pick(next, STYLE_FIELDS) } : s)),
      };
    });

  // ---- The style list (P9-04b) ----
  const uniqueName = (base, styles) => {
    let name = base;
    for (let n = 2; styles.some((s) => s.name.toLowerCase() === name.toLowerCase()); n++) name = `${base} ${n}`;
    return name;
  };
  const newIds = useRef(0);
  const styleActions = {
    edit: (id) => setEditingId(id),
    add: () => {
      const id = `new-${++newIds.current}`;
      setComfyAll((all) => ({ ...all, styles: [...all.styles, { id, name: uniqueName('New style', all.styles), saved: false, ...styleDraft() }] }));
      setEditingId(id);
    },
    duplicate: (id) => {
      const copyId = `new-${++newIds.current}`;
      setComfyAll((all) => {
        const src = all.styles.find((s) => s.id === id);
        const i = all.styles.indexOf(src);
        const copy = { ...src, id: copyId, saved: false, name: uniqueName(`${src.name} copy`, all.styles) };
        return { ...all, styles: [...all.styles.slice(0, i + 1), copy, ...all.styles.slice(i + 1)] };
      });
      setEditingId(copyId);
    },
    rename: (id, name) => setComfyAll((all) => ({ ...all, styles: all.styles.map((s) => (s.id === id ? { ...s, name } : s)) })),
    makeDefault: (id) => setComfyAll((all) => ({ ...all, defaultStyle: id })),
    remove: (id) => {
      setComfyAll((all) => {
        if (all.styles.length < 2) return all;
        const styles = all.styles.filter((s) => s.id !== id);
        return { ...all, styles, defaultStyle: all.defaultStyle === id ? styles[0].id : all.defaultStyle };
      });
      setEditingId((e) => (e === id ? null : e));
    },
  };

  const current = comfyAll && { comfy: comfyAll, kie, kieKey, defaultEngine, general };
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
      const view = await api.saveImagineSettings(saveBody({ comfy: comfyAll, kie, kieKey, defaultEngine, general, savedDefault: data.defaultEngine }));
      adopt(view);
      setSaved(true);
    } catch (err) {
      setError(err.message || 'Could not save');
      // "Anime: …" — show the style the problem is in.
      const named = comfyAll.styles.find((s) => (err.message || '').startsWith(`${s.name}: `));
      if (named) {
        setEditingId(named.id);
        onNavigate?.('imagine-styles'); // P10-05: where that style's settings are
      }
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setComfyAll(baseline.comfy);
    setEditingId((id) => (baseline.comfy.styles.some((s) => s.id === id) ? id : baseline.comfy.defaultStyle));
    setKie(baseline.kie);
    setKieKey('');
    setDefaultEngine(baseline.defaultEngine);
    setGeneral(baseline.general);
    setError('');
  }

  const value = {
    ready: !!(data && comfy), loadError: !data ? error : '', data,
    comfy, setComfy, kie, setKie,
    styles: comfyAll?.styles || [], defaultStyle: comfyAll?.defaultStyle, editingStyle: editing, styleActions, kieKey, setKieKey, kieNote, defaultEngine, setDefaultEngine, general, setGeneral,
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
