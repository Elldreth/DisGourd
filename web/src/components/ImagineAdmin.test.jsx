import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const MODELS = [
  { name: 'Flux\\flux1-dev-fp8.safetensors', family: 'flux' },
  { name: 'Illustrious\\Illustrious-XL-v2.0.safetensors', family: 'sdxl' },
  { name: 'SD1\\absolutereality_v16.safetensors', family: 'sd15' },
];
// What Save sends when nothing in Advanced was touched (P3-31).
const NO_ADVANCED = { promptPrefix: null, clipSkip: null, hiresSteps: null, hiresDenoise: 0.45, sampler: null, scheduler: null, cfgScale: null, steps: { draft: null, standard: null, high: null }, negative: null, varyLoops: 2, varySubtle: 0.3, varyStrong: 0.65, detailer: false, detector: null, workflowMode: 'builtin', workflow: null, upscaleWorkflow: null, img2imgWorkflow: null };
// Like the server (P9-04a): the default style's fields also flat, beside `presets`.
const asServer = (comfy) => {
  if (!comfy.presets) return comfy;
  const def = comfy.presets.find((p) => p.id === comfy.defaultPreset) || comfy.presets[0];
  const presets = comfy.presets.map((p, i) => ({ ...p, id: p.id || p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || `style-${i}` }));
  return { ...comfy, ...def, presets, defaultPreset: presets[comfy.presets.indexOf(def)].id };
};
const view = (comfy = {}) => ({
  defaultEngine: null,
  permissive: false,
  dailyLimit: 20,
  dailyCeiling: 100,
  engines: [{ id: 'comfyui', name: 'ComfyUI (local)', config: { enabled: false, url: '', model: null, family: null, tier: 'medium', ...asServer(comfy) } }],
});
// What the last Save sent for ComfyUI, flat: the shared settings plus the
// default style's own (P9-04b sends `presets`).
const sent = (body = api.saveImagineSettings.mock.calls.at(-1)[0]) => {
  const { presets, defaultPreset, ...shared } = body.engines.comfyui;
  const { id, name, ...style } = presets.find((p) => p.id === defaultPreset) || presets[0];
  return { ...shared, ...style };
};
vi.mock('../api.js', () => ({
  getImagineSettings: vi.fn(),
  testKie: vi.fn(),
  saveImagineSettings: vi.fn(),
  testComfyUI: vi.fn(),
  tryImagine: vi.fn(),
}));
const api = await import('../api.js');
// P5-03: the single form is now pages; this renders them all at once.
const { default: ImagineAdmin } = await import('./admin/imagine/allPages.testutil.jsx');

beforeEach(() => {
  vi.clearAllMocks();
  api.getImagineSettings.mockResolvedValue(view());
  api.testComfyUI.mockResolvedValue({ url: 'http://127.0.0.1:8188', models: MODELS });
});
afterEach(cleanup);

test('Test connection lists the models; picking one guesses its type; Save sends it all', async () => {
  api.saveImagineSettings.mockImplementation(async (body) => ({ ...view(body.engines.comfyui), dailyLimit: body.dailyLimit, permissive: body.permissive, defaultEngine: 'comfyui' }));
  render(<ImagineAdmin />);
  const url = await screen.findByLabelText('ComfyUI address');
  expect(api.testComfyUI).not.toHaveBeenCalled(); // nothing saved yet, so no automatic test
  fireEvent.change(url, { target: { value: 'http://127.0.0.1:8188/' } });
  fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
  expect(await screen.findByText('Connected · 3 checkpoints')).toBeTruthy();
  expect(api.testComfyUI).toHaveBeenCalledWith('http://127.0.0.1:8188/');
  const model = screen.getByLabelText('Model');
  expect(within(model).getAllByRole('option').map((o) => o.value)).toEqual(['', ...MODELS.map((m) => `checkpoint:${m.name}`)]);
  fireEvent.change(model, { target: { value: `checkpoint:${MODELS[0].name}` } });
  expect(screen.queryByRole('group', { name: 'Model parts' })).toBeNull(); // a checkpoint has no separate parts
  expect(screen.getByLabelText('Model type').value).toBe('flux');
  fireEvent.click(screen.getByLabelText('Use my ComfyUI (local, free)'));
  fireEvent.click(screen.getByRole('radio', { name: /High/ }));
  fireEvent.change(screen.getByLabelText('Images per person per day'), { target: { value: '8' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(api.saveImagineSettings).toHaveBeenCalled());
  expect(sent()).toEqual({ enabled: true, url: 'http://127.0.0.1:8188', model: MODELS[0].name, kind: 'checkpoint', family: 'flux', tier: 'high', clip1: null, clip2: null, vae: null, hires: true, upscaler: null, upscaleMode: 'model', ...NO_ADVANCED });
  expect(api.saveImagineSettings.mock.calls.at(-1)[0].engines.comfyui.presets).toHaveLength(1);
  await waitFor(() =>
    expect(api.saveImagineSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultEngine: 'comfyui',
        dailyLimit: 8,
        permissive: false,
      })
    )
  );
  expect(await screen.findByText('Saved')).toBeTruthy();
});

test('a saved address is tested on open, and errors are shown', async () => {
  api.getImagineSettings.mockResolvedValue(view({ url: 'http://pc:8188', model: MODELS[1].name, family: 'sdxl' }));
  render(<ImagineAdmin />);
  await waitFor(() => expect(api.testComfyUI).toHaveBeenCalledWith('http://pc:8188'));
  expect(screen.getByLabelText('Model').value).toBe(`checkpoint:${MODELS[1].name}`);
  api.testComfyUI.mockRejectedValueOnce(new Error("ComfyUI isn't reachable at http://pc:8188"));
  fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
  expect(await screen.findByText("ComfyUI isn't reachable at http://pc:8188")).toBeTruthy();
  api.saveImagineSettings.mockRejectedValueOnce(new Error('Set the ComfyUI address and pick a model before turning it on'));
  fireEvent.click(screen.getByLabelText('Use my ComfyUI (local, free)')); // an edit to save (P5-03)
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect((await screen.findByRole('alert')).textContent).toMatch(/pick a model/);
});

test('a test image: needs a saved model; shows the picture with its size and time', async () => {
  render(<ImagineAdmin />);
  expect(await screen.findByText('Save an engine’s settings first.')).toBeTruthy();
  cleanup();
  api.getImagineSettings.mockResolvedValue(view({ enabled: true, url: 'http://pc:8188', model: MODELS[0].name, family: 'flux' }));
  api.tryImagine.mockResolvedValue({ url: '/uploads/abc/imagine-1.png', width: 1024, height: 576, ms: 14900 });
  render(<ImagineAdmin />);
  const form = await screen.findByRole('form', { name: 'Generate a test image' });
  fireEvent.change(within(form).getByLabelText('Test prompt'), { target: { value: 'a gourd' } });
  fireEvent.change(within(form).getByLabelText('Shape'), { target: { value: 'wide' } });
  fireEvent.change(within(form).getByLabelText('Quality'), { target: { value: 'draft' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Generate' }));
  await waitFor(() => expect(api.tryImagine).toHaveBeenCalledWith({ engine: 'comfyui', prompt: 'a gourd', shape: 'wide', quality: 'draft' }));
  const img = await within(form).findByRole('img');
  expect(img.getAttribute('src')).toBe('/uploads/abc/imagine-1.png');
  expect(within(form).getByText('1024×576 · 14.9 s')).toBeTruthy();
  api.tryImagine.mockRejectedValueOnce(new Error('Sexual content involving minors is never allowed'));
  fireEvent.click(within(form).getByRole('button', { name: 'Generate' }));
  expect((await within(form).findByRole('alert')).textContent).toMatch(/never allowed/);
});

// ---- kie.ai (P2-20c) ----
const KIE_MODELS = [
  { id: 'z-image', name: 'Z-Image', note: 'Fast and inexpensive.', filterable: true, price: { credits: 0.8, estimate: true } },
  { id: 'flux-2/pro-text-to-image', name: 'Flux-2 Pro', note: 'High quality.', filterable: true, price: { credits: 5.5, estimate: false }, picture: { model: 'flux-2/pro-image-to-image', strength: false } },
  { id: 'nano-banana-2', name: 'Nano Banana 2', note: 'Always filtered by Google.', filterable: false, price: null },
  { id: 'custom', name: 'Custom model', note: 'Sent with prompt, aspect_ratio and nsfw_checker.', filterable: true, price: null },
];
const withKie = (kie = {}, comfy = {}) => {
  const v = view(comfy);
  v.engines.push({ id: 'kie', name: 'kie.ai', models: KIE_MODELS, config: { enabled: false, model: null, customModel: '', monthlyCredits: null, keySaved: false, keyHint: null, envKey: false, ...kie } });
  return v;
};

test('kie.ai card: a saved key is never shown; Test key reports the balance; prices label the models; Save sends the new key once', async () => {
  api.getImagineSettings.mockResolvedValue(withKie({ keySaved: true, keyHint: '••••1234', model: 'z-image' }));
  api.testKie.mockResolvedValue({ credits: 123.5 });
  api.saveImagineSettings.mockImplementation(async () => withKie({ keySaved: true, keyHint: '••••9999', enabled: true, model: 'flux-2/pro-text-to-image', monthlyCredits: 500 }));
  render(<ImagineAdmin />);
  const key = await screen.findByLabelText('kie.ai API key');
  expect(key.value).toBe('');
  expect(key.getAttribute('type')).toBe('password');
  expect(key.getAttribute('placeholder')).toMatch(/A key is saved \(••••1234\)/);
  fireEvent.click(screen.getByRole('button', { name: 'Test key' }));
  expect(await screen.findByText('The key works · 123.5 credits left')).toBeTruthy();
  expect(api.testKie).toHaveBeenCalledWith(''); // blank: the server checks the saved key
  const model = screen.getByLabelText('kie.ai model');
  expect(within(model).getAllByRole('option').map((o) => o.textContent)).toEqual([
    'Pick a model…', 'Z-Image — ≈ 0.8 credits (est.)', 'Flux-2 Pro — 5.5 credits', 'Nano Banana 2 — price unknown until first use', 'Custom model ID…',
  ]);
  expect(screen.getByRole('link', { name: 'kie.ai’s pricing' }).getAttribute('href')).toBe('https://kie.ai/pricing');
  fireEvent.change(model, { target: { value: 'flux-2/pro-text-to-image' } });
  fireEvent.click(screen.getByLabelText('Use kie.ai (paid, with your API key)'));
  fireEvent.change(key, { target: { value: 'new-key-9999' } });
  fireEvent.change(screen.getByLabelText('Monthly credit cap'), { target: { value: '500' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() =>
    expect(api.saveImagineSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        engines: expect.objectContaining({ kie: { enabled: true, model: 'flux-2/pro-text-to-image', customModel: '', pictureModel: null, monthlyCredits: 500, apiKey: 'new-key-9999' } }),
        defaultEngine: 'kie',
      })
    )
  );
  await waitFor(() => expect(screen.getByLabelText('kie.ai API key').value).toBe('')); // not kept in the page
});

test('kie.ai: a custom model id; a key from the environment; the default engine when both are on; the test image engine choice', async () => {
  api.getImagineSettings.mockResolvedValue(withKie({ envKey: true, enabled: true, model: 'z-image' }, { enabled: true, url: 'http://pc:8188', model: MODELS[0].name, family: 'flux' }));
  api.saveImagineSettings.mockImplementation(async (body) => withKie({ envKey: true, ...body.engines.kie }, body.engines.comfyui));
  api.tryImagine.mockResolvedValue({ url: '/uploads/k/imagine-1.png', width: null, height: null, ms: 4200, cost: 0.8 });
  render(<ImagineAdmin />);
  expect(await screen.findByText('Using the KIEAI_API_KEY set in the server’s environment.')).toBeTruthy();
  expect(screen.queryByLabelText('kie.ai API key')).toBeNull();
  fireEvent.change(screen.getByLabelText('kie.ai model'), { target: { value: 'custom' } });
  fireEvent.change(screen.getByLabelText('Custom model ID'), { target: { value: 'vendor/new-model' } });
  fireEvent.click(screen.getByRole('radio', { name: 'kie.ai' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() =>
    expect(api.saveImagineSettings).toHaveBeenCalledWith(
      expect.objectContaining({ engines: expect.objectContaining({ kie: expect.objectContaining({ model: 'custom', customModel: 'vendor/new-model' }) }), defaultEngine: 'kie' })
    )
  );
  const form = screen.getByRole('form', { name: 'Generate a test image' });
  fireEvent.change(within(form).getByLabelText('Engine'), { target: { value: 'kie' } });
  fireEvent.change(within(form).getByLabelText('Test prompt'), { target: { value: 'a gourd' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Generate' }));
  await waitFor(() => expect(api.tryImagine).toHaveBeenCalledWith({ engine: 'kie', prompt: 'a gourd', shape: 'square', quality: 'standard' }));
  expect(await within(form).findByText('4.2 s · 0.8 credits')).toBeTruthy();
});

// P3-24: models in separate parts (a diffusion model + text encoders + VAE).
const SPLIT = {
  url: 'http://127.0.0.1:8188',
  models: [
    { name: 'sdxl_base.safetensors', kind: 'checkpoint', family: 'sdxl' },
    { name: 'flux1-dev-fp8.safetensors', kind: 'unet', family: 'flux' },
    { name: 'zturbo\\z_image_turbo_bf16.safetensors', kind: 'unet', family: 'zimage' },
    { name: 'mystery.safetensors', kind: 'unet', family: null },
  ],
  clips: ['clip_l.safetensors', 't5xxl_enconly.safetensors', 'zturbo\\qwen_3_4b.safetensors'],
  vaes: ['FLUX1\\ae.sft', 'zturbo\\ae.safetensors'],
  suggested: {
    flux: { clip1: 'clip_l.safetensors', clip2: 't5xxl_enconly.safetensors', vae: 'FLUX1\\ae.sft' },
    zimage: { clip1: 'zturbo\\qwen_3_4b.safetensors', clip2: null, vae: 'zturbo\\ae.safetensors' },
  },
};

test('split models: grouped in the list; picking one fills its text encoders and VAE; Save sends the parts', async () => {
  api.testComfyUI.mockResolvedValue(SPLIT);
  api.saveImagineSettings.mockImplementation(async (body) => ({ ...view(body.engines.comfyui), defaultEngine: 'comfyui' }));
  render(<ImagineAdmin />);
  fireEvent.change(await screen.findByLabelText('ComfyUI address'), { target: { value: 'http://127.0.0.1:8188' } });
  fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
  expect(await screen.findByText('Connected · 1 checkpoint · 3 diffusion models')).toBeTruthy();
  const model = screen.getByLabelText('Model');
  expect(within(model).getAllByRole('group').map((g) => g.getAttribute('label'))).toEqual(['Checkpoints', 'Separate parts (diffusion models)']);
  // Z-Image Turbo: one text encoder.
  fireEvent.change(model, { target: { value: `unet:${SPLIT.models[2].name}` } });
  expect(screen.getByLabelText('Model type').value).toBe('zimage');
  expect(within(screen.getByLabelText('Model type')).getAllByRole('option').map((o) => o.value)).toEqual(['flux', 'zimage', 'anima']);
  expect(screen.getByLabelText('Text encoder').value).toBe(SPLIT.clips[2]);
  expect(screen.queryByLabelText('Text encoder (T5-XXL)')).toBeNull();
  expect(screen.getByLabelText('VAE').value).toBe(SPLIT.vaes[1]);
  // An unknown model: pick its type, then the suggestions for that type fill in.
  fireEvent.change(model, { target: { value: `unet:${SPLIT.models[3].name}` } });
  expect(screen.getByLabelText('Model type').value).toBe('');
  expect(screen.queryByRole('group', { name: 'Model parts' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Model type'), { target: { value: 'flux' } });
  expect(screen.getByLabelText('Text encoder (CLIP-L)').value).toBe(SPLIT.clips[0]);
  expect(screen.getByLabelText('Text encoder (T5-XXL)').value).toBe(SPLIT.clips[1]);
  fireEvent.change(screen.getByLabelText('VAE'), { target: { value: SPLIT.vaes[1] } }); // the host's own choice
  fireEvent.click(screen.getByLabelText('Use my ComfyUI (local, free)'));
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(api.saveImagineSettings).toHaveBeenCalled());
  expect(sent()).toEqual({ enabled: true, url: 'http://127.0.0.1:8188', model: 'mystery.safetensors', kind: 'unet', family: 'flux', tier: 'medium', clip1: SPLIT.clips[0], clip2: SPLIT.clips[1], vae: SPLIT.vaes[1], hires: true, upscaler: null, upscaleMode: 'model', ...NO_ADVANCED });
});

test('a saved split model shows its parts before any test', async () => {
  api.getImagineSettings.mockResolvedValue(view({ url: '', model: 'flux1-dev-fp8.safetensors', kind: 'unet', family: 'flux', clip1: 'clip_l.safetensors', clip2: 't5.safetensors', vae: 'ae.sft' }));
  render(<ImagineAdmin />);
  expect((await screen.findByLabelText('Text encoder (T5-XXL)')).value).toBe('t5.safetensors');
  expect(screen.getByLabelText('VAE').value).toBe('ae.sft');
  expect(screen.getByLabelText('Model').value).toBe('unet:flux1-dev-fp8.safetensors');
});

test('P3-28: the hires fix switch and its upscale model (suggested after a test); Save sends both', async () => {
  api.testComfyUI.mockResolvedValue({ ...SPLIT, upscalers: ['4x-AnimeSharp.pth', '4x-UltraSharp.pth'], suggested: { ...SPLIT.suggested, upscaler: '4x-UltraSharp.pth' } });
  api.saveImagineSettings.mockImplementation(async (body) => ({ ...view(body.engines.comfyui), defaultEngine: 'comfyui' }));
  render(<ImagineAdmin />);
  const hires = await screen.findByLabelText('Hires fix for High quality');
  expect(hires.checked).toBe(true); // on unless switched off
  fireEvent.change(screen.getByLabelText('ComfyUI address'), { target: { value: 'http://127.0.0.1:8188' } });
  fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
  await screen.findByText(/Connected/);
  expect(screen.getByLabelText('Upscale model').value).toBe('4x-UltraSharp.pth');
  fireEvent.change(screen.getByLabelText('Upscale model'), { target: { value: '4x-AnimeSharp.pth' } });
  fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'checkpoint:sdxl_base.safetensors' } });
  // P9-08: the hires strength (shared), 0.45 by default.
  expect(screen.getByLabelText('Hires strength').value).toBe('0.45');
  fireEvent.change(screen.getByLabelText('Hires strength'), { target: { value: '0.4' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(sent()).toMatchObject({ hires: true, upscaler: '4x-AnimeSharp.pth', hiresDenoise: 0.4 }));
  fireEvent.click(hires);
  expect(screen.getByLabelText('Upscale model').value).toBe('4x-AnimeSharp.pth'); // still used by the Upscale button
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(sent()).toMatchObject({ hires: false }));
});

test('P3-29: the Upscale button mode; tiled needs the node, and saves its strength and tile size', async () => {
  api.testComfyUI.mockResolvedValue({ ...SPLIT, upscalers: ['4x-UltraSharp.pth'], suggested: { ...SPLIT.suggested, upscaler: '4x-UltraSharp.pth' }, tiledAvailable: false });
  api.saveImagineSettings.mockImplementation(async (body) => ({ ...view(body.engines.comfyui), defaultEngine: 'comfyui' }));
  render(<ImagineAdmin />);
  fireEvent.change(await screen.findByLabelText('ComfyUI address'), { target: { value: 'http://127.0.0.1:8188' } });
  fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
  await screen.findByText(/Connected/);
  expect(screen.getByRole('radio', { name: /Upscale model only/ }).checked).toBe(true);
  expect(screen.getByRole('radio', { name: /Tiled repaint/ }).disabled).toBe(true);
  expect(screen.getByText(/Tiled repaint needs the/).textContent).toMatch(/ComfyUI_UltimateSDUpscale custom node \(by ssitu\), which ComfyUI Manager can install/);
  cleanup();
  api.testComfyUI.mockResolvedValue({ ...SPLIT, upscalers: ['4x-UltraSharp.pth'], suggested: SPLIT.suggested, tiledAvailable: true });
  render(<ImagineAdmin />);
  fireEvent.change(await screen.findByLabelText('ComfyUI address'), { target: { value: 'http://127.0.0.1:8188' } });
  fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
  await screen.findByText(/Connected/);
  fireEvent.click(screen.getByRole('radio', { name: /Tiled repaint/ }));
  fireEvent.change(screen.getByLabelText('Repaint strength'), { target: { value: '0.25' } });
  fireEvent.change(screen.getByLabelText('Tile size'), { target: { value: '768' } });
  fireEvent.change(screen.getByLabelText('Tiled passes'), { target: { value: '2' } }); // P3-33
  fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'checkpoint:sdxl_base.safetensors' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(sent()).toMatchObject({ upscaleMode: 'tiled', tileDenoise: 0.25, tileSize: 768, tilePasses: 2, upscaler: null })); // blank upscaler = automatic
});

test('P3-31: Advanced starts closed; its lists come from the test; defaults are shown; values and blanks are saved', async () => {
  api.testComfyUI.mockResolvedValue({ ...SPLIT, upscalers: [], samplers: ['euler', 'dpmpp_2m_sde'], schedulers: ['simple', 'karras'], detectors: ['bbox/face_yolov8m.pt'], suggested: { ...SPLIT.suggested, detector: 'bbox/face_yolov8m.pt' }, detailerAvailable: true });
  api.saveImagineSettings.mockImplementation(async (body) => ({ ...view(body.engines.comfyui), defaultEngine: 'comfyui' }));
  render(<ImagineAdmin />);
  fireEvent.change(await screen.findByLabelText('ComfyUI address'), { target: { value: 'http://127.0.0.1:8188' } });
  fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
  await screen.findByText(/Connected/);
  const advanced = screen.getByRole('group', { name: 'Advanced settings' });
  expect(advanced.open).toBe(false);
  fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'checkpoint:sdxl_base.safetensors' } });
  expect(within(screen.getByLabelText('Sampler')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Default (dpmpp_2m)', 'euler', 'dpmpp_2m_sde']);
  // P9-08: the SDXL family's new defaults, and the new Advanced fields.
  expect(screen.getByLabelText('High').getAttribute('placeholder')).toBe('Default (15)');
  expect(screen.getByLabelText('CFG').getAttribute('placeholder')).toBe('Default (5)');
  expect(screen.getByLabelText('Hires steps').getAttribute('placeholder')).toBe('Default (15)');
  expect(within(screen.getByLabelText('CLIP skip')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Default (2)', '1 (off)', '2']);
  fireEvent.change(screen.getByLabelText('Hires steps'), { target: { value: '20' } });
  fireEvent.change(screen.getByLabelText('CLIP skip'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Sampler'), { target: { value: 'dpmpp_2m_sde' } });
  fireEvent.change(screen.getByLabelText('CFG'), { target: { value: '4.5' } });
  fireEvent.change(screen.getByLabelText('High'), { target: { value: '40' } });
  fireEvent.change(screen.getByLabelText('Negative prompt'), { target: { value: 'extra fingers' } });
  fireEvent.click(screen.getByLabelText('Face detailer on Standard and High'));
  expect(screen.getByLabelText('Face detector').value).toBe('bbox/face_yolov8m.pt');
  fireEvent.change(screen.getByLabelText('Face repaint strength'), { target: { value: '0.35' } });
  fireEvent.change(screen.getByLabelText('Face detailer passes'), { target: { value: '3' } }); // P3-33
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() =>
    expect(sent()).toMatchObject({
      sampler: 'dpmpp_2m_sde', scheduler: null, cfgScale: 4.5, steps: { draft: null, standard: null, high: 40 }, negative: 'extra fingers', hiresSteps: 20, clipSkip: 1,
      detailer: true, detector: 'bbox/face_yolov8m.pt', detailerDenoise: 0.35, detailerPasses: 3,
    })
  );
});

test('P3-31: the face detailer is unavailable without the Impact Pack', async () => {
  api.testComfyUI.mockResolvedValue({ ...SPLIT, detailerAvailable: false });
  render(<ImagineAdmin />);
  fireEvent.change(await screen.findByLabelText('ComfyUI address'), { target: { value: 'http://127.0.0.1:8188' } });
  fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
  await screen.findByText(/Connected/);
  expect(screen.getByLabelText('Face detailer on Standard and High').matches(':disabled')).toBe(true); // via its fieldset
  expect(screen.getByText(/Needs the/).textContent).toMatch(/ComfyUI-Impact-Pack and ComfyUI-Impact-Subpack.*face_yolov8m\.pt in models\/ultralytics\/bbox/);
});

test('P3-33: a feature that is on but missing from this ComfyUI is flagged, and says it is left out', async () => {
  api.getImagineSettings.mockResolvedValue(view({ url: 'http://127.0.0.1:8188', model: 'sdxl_base.safetensors', kind: 'checkpoint', family: 'sdxl', detailer: true, upscaleMode: 'tiled' }));
  api.testComfyUI.mockResolvedValue({ ...SPLIT, tiledAvailable: false, tiledPassesAvailable: false, detailerAvailable: false });
  render(<ImagineAdmin />);
  await screen.findByText(/Connected/); // the saved address is tested on open
  const alerts = screen.getAllByRole('alert').map((a) => a.textContent);
  expect(alerts).toContain('Tiled repaint is chosen, but this ComfyUI doesn’t have it, so the Upscale button uses the upscale model only.');
  expect(alerts).toContain('The face detailer is on, but this ComfyUI doesn’t have it, so images are made without it.');
});

// P3-34: the host's own workflow.
const SAVED_WF = JSON.stringify({ 6: {} }, null, 2);
const WF = JSON.stringify({ 6: { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}' } } });

test('P3-34: My own: paste or load a workflow, see the placeholders, and save it; built-in options say they are not used', async () => {
  api.saveImagineSettings.mockImplementation(async (body) => ({ ...view(body.engines.comfyui), defaultEngine: 'comfyui' }));
  render(<ImagineAdmin />);
  await screen.findByLabelText('ComfyUI address');
  expect(screen.queryByLabelText('Workflow (API format)')).toBeNull(); // Built-in by default
  fireEvent.click(screen.getByRole('radio', { name: /My own/ }));
  fireEvent.change(screen.getByLabelText('Workflow (API format)'), { target: { value: WF } });
  // Loading a file fills the upscale box.
  const file = new File(['{"1":{"class_type":"LoadImage","inputs":{"image":"{{image}}"}}}'], 'up.json', { type: 'application/json' });
  fireEvent.change(screen.getByLabelText('Load upscale workflow (optional) from a file'), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByLabelText('Upscale workflow (optional)').value).toContain('{{image}}'));
  expect(screen.getAllByText('{{prompt}}').length).toBeGreaterThan(0);
  expect(screen.getByLabelText('Hires fix for High quality').disabled).toBe(true);
  expect(screen.getByText('Your upscale workflow is used instead of these.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() =>
    expect(sent()).toMatchObject({
      workflowMode: 'custom', workflow: WF, upscaleWorkflow: expect.stringContaining('LoadImage'),
    })
  );
});

test('P3-34: a refused workflow shows the server’s reason; a saved one comes back into the box', async () => {
  api.getImagineSettings.mockResolvedValue(view({ workflowMode: 'custom', workflow: SAVED_WF, upscaleWorkflow: '' }));
  api.saveImagineSettings.mockRejectedValue(new Error('Workflow: your ComfyUI doesn’t have this node: MyCustomSampler'));
  render(<ImagineAdmin />);
  const box = await screen.findByLabelText('Workflow (API format)');
  expect(box.value).toBe(SAVED_WF);
  fireEvent.change(box, { target: { value: WF } }); // an edit, so there is something to save (P5-03)
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('Workflow: your ComfyUI doesn’t have this node: MyCustomSampler')).toBeTruthy();
});

test('P3-36a: Variation loops in Advanced (a loopback, explained) are saved', async () => {
  api.saveImagineSettings.mockImplementation(async (body) => ({ ...view(body.engines.comfyui), defaultEngine: 'comfyui' }));
  render(<ImagineAdmin />);
  const loops = await screen.findByLabelText('Loops');
  expect(loops.value).toBe('2');
  expect(screen.getByText(/each loop repaints the whole image/)).toBeTruthy();
  fireEvent.change(loops, { target: { value: '3' } });
  expect(screen.getByLabelText('Strong strength').value).toBe('0.65');
  fireEvent.change(screen.getByLabelText('Strong strength'), { target: { value: '0.75' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(sent()).toMatchObject({ varyLoops: 3, varySubtle: 0.3, varyStrong: 0.75 }));
});

test('P3-36b: My own has an optional image-to-image workflow box, saved with the others', async () => {
  api.saveImagineSettings.mockImplementation(async (body) => ({ ...view(body.engines.comfyui), defaultEngine: 'comfyui' }));
  render(<ImagineAdmin />);
  await screen.findByLabelText('ComfyUI address');
  fireEvent.click(screen.getByRole('radio', { name: /My own/ }));
  fireEvent.change(screen.getByLabelText('Workflow (API format)'), { target: { value: WF } });
  const box = screen.getByLabelText('Image-to-image workflow (optional)');
  fireEvent.change(box, { target: { value: '{"1":{"class_type":"LoadImage","inputs":{"image":"{{image}}"}}}' } });
  expect(screen.getAllByText('{{denoise}}').length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(sent()).toMatchObject({ img2imgWorkflow: expect.stringContaining('{{image}}') }));
});

test('P9-04b: Styles: an old setup shows as "Default"; add, rename, duplicate, make default and delete; Save sends every style', async () => {
  api.getImagineSettings.mockResolvedValue(view({ enabled: true, url: 'http://127.0.0.1:8188', model: MODELS[0].name, family: 'flux', sampler: 'euler' }));
  api.saveImagineSettings.mockImplementation(async (body) => ({ ...view(body.engines.comfyui), defaultEngine: 'comfyui' }));
  render(<ImagineAdmin />);
  const list = await screen.findByRole('list', { name: 'Styles' });
  expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual(['Defaultflux1-dev-fp8Default']);
  expect(screen.getByRole('button', { name: 'Delete' }).disabled).toBe(true); // the last style stays
  // A new style starts blank and is the one being edited.
  fireEvent.click(screen.getByRole('button', { name: 'Add style' }));
  expect(screen.getByText('Editing style: New style')).toBeTruthy();
  expect(screen.getByLabelText('Model').value).toBe('');
  fireEvent.change(screen.getByLabelText('Style name'), { target: { value: 'Photoreal' } });
  fireEvent.change(screen.getByLabelText('Model'), { target: { value: `checkpoint:${MODELS[1].name}` } });
  fireEvent.change(screen.getByLabelText('Prompt prefix (optional)'), { target: { value: ' RAW photo, ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Make default' }));
  // A duplicate name is flagged.
  fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
  expect(screen.getByLabelText('Style name').value).toBe('Photoreal copy');
  fireEvent.change(screen.getByLabelText('Style name'), { target: { value: 'photoreal' } });
  expect(screen.getByText('Another style has this name.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Style name'), { target: { value: 'Anime' } });
  // Shared settings change for every style; the first style kept its own model.
  fireEvent.click(screen.getByRole('radio', { name: /High/ }));
  fireEvent.click(within(list).getByRole('button', { name: /^Default/ }));
  expect(screen.getByLabelText('Model').value).toBe(`checkpoint:${MODELS[0].name}`);
  // Delete Anime (asks first).
  fireEvent.click(within(list).getByRole('button', { name: /^Anime/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Delete style' }));
  expect(within(list).queryByRole('button', { name: /^Anime/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(api.saveImagineSettings).toHaveBeenCalled());
  const body = api.saveImagineSettings.mock.calls.at(-1)[0].engines.comfyui;
  expect(body.tier).toBe('high');
  expect(body.model).toBeUndefined(); // style fields go only in `presets`
  expect(body.presets.map((p) => [p.id, p.name, p.model, p.promptPrefix])).toEqual([
    ['default', 'Default', MODELS[0].name, null],
    [undefined, 'Photoreal', MODELS[1].name, 'RAW photo,'], // new: the server makes its id
  ]);
  expect(body.presets[0].sampler).toBe('euler');
  // The new default is the new style, picked by name until it has an id.
  expect(body.defaultPreset).toMatch(/^new-/);
  // After saving, the styles are as saved, and the same style is still being edited.
  await waitFor(() => expect(within(list).getAllByRole('button')).toHaveLength(2));
  expect(screen.getByText('Editing style: Default')).toBeTruthy();
});

test('P9-04b: a save error that names a style shows that style; Advanced follows the chosen style (P10-05: on the Styles page)', async () => {
  api.getImagineSettings.mockResolvedValue(view({ url: 'http://127.0.0.1:8188', presets: [
    { id: 'photo', name: 'Photoreal', model: MODELS[1].name, family: 'sdxl', steps: { standard: 30 } },
    { id: 'mine', name: 'Mine', workflowMode: 'custom', workflow: '{"1":{}}' },
  ], defaultPreset: 'photo' }));
  api.saveImagineSettings.mockRejectedValueOnce(new Error('Mine: Workflow: your ComfyUI doesn’t have this node: MyCustomSampler'));
  render(<ImagineAdmin />);
  const list = await screen.findByRole('list', { name: 'Styles' });
  expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual(['PhotorealIllustrious-XL-v2.0Default', 'MineOwn workflow']);
  expect(screen.getByText('Editing style: Photoreal')).toBeTruthy();
  // P10-05: Advanced sits in the style's panel, so it shows the chosen style's values; no second picker.
  expect(screen.queryByLabelText('Style')).toBeNull();
  expect(screen.getByLabelText('Standard').value).toBe('30');
  fireEvent.click(within(list).getByRole('button', { name: /^Mine/ }));
  expect(screen.getByText('Editing style: Mine')).toBeTruthy();
  expect(screen.getByLabelText('Standard').value).toBe('');
  fireEvent.click(within(list).getByRole('button', { name: /^Photoreal/ }));
  fireEvent.change(screen.getByLabelText('Style name'), { target: { value: 'Photo' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText(/Mine: Workflow: your ComfyUI/)).toBeTruthy();
  expect(screen.getByText('Editing style: Mine')).toBeTruthy();
});

test('P9-05b: kie.ai pictures: which model they use and the upload note; Z-Image asks for a model for pictures', async () => {
  api.getImagineSettings.mockResolvedValue(withKie({ envKey: true, enabled: true, model: 'z-image' }));
  api.saveImagineSettings.mockImplementation(async (body) => withKie({ envKey: true, ...body.engines.kie }));
  render(<ImagineAdmin />);
  const picker = await screen.findByLabelText('Model for pictures');
  expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(['None (pictures use ComfyUI, if it’s on)', 'Flux-2 Pro']);
  expect(screen.getByRole('note', { name: 'Pictures on kie.ai' }).textContent).toBe('kie.ai won’t take pictures with this model.');
  fireEvent.change(picker, { target: { value: 'flux-2/pro-text-to-image' } });
  // P10-05: a one-line summary in its own Pictures part; the upload note is help text under it.
  expect(screen.getByRole('note', { name: 'Pictures on kie.ai' }).textContent).toBe('Flux-2 Pro image-to-image · no strength setting, so Variations are one button');
  expect(screen.getByRole('group', { name: 'Pictures' }).textContent).toMatch(/kie\.ai deletes it after 24 hours/);
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(api.saveImagineSettings.mock.calls.at(-1)[0].engines.kie).toMatchObject({ model: 'z-image', pictureModel: 'flux-2/pro-text-to-image' }));
  // A model with its own picture version: no picker, and the note names it.
  fireEvent.change(screen.getByLabelText('kie.ai model'), { target: { value: 'flux-2/pro-text-to-image' } });
  expect(screen.queryByLabelText('Model for pictures')).toBeNull();
  expect(screen.getByRole('note', { name: 'Pictures on kie.ai' }).textContent).toMatch(/^Flux-2 Pro image-to-image · no strength/);
  // Nano Banana here has no picture info: it can't take pictures, so the picker shows.
  fireEvent.change(screen.getByLabelText('kie.ai model'), { target: { value: 'nano-banana-2' } });
  expect(screen.getByLabelText('Model for pictures').value).toBe('flux-2/pro-text-to-image');
});

// ---- P10-05: a Styles page; ComfyUI and Quality keep the shared settings ----
test('P10-05: each page holds its own things; ComfyUI links to Styles; a save error about a style opens Styles', async () => {
  const { ImagineSettingsProvider, ImagineSaveBar } = await import('./admin/imagine/ImagineSettings.jsx');
  const { default: ComfyPage } = await import('./admin/imagine/ComfyPage.jsx');
  const { default: StylesPage } = await import('./admin/imagine/StylesPage.jsx');
  const { default: QualityPage } = await import('./admin/imagine/QualityPage.jsx');
  api.getImagineSettings.mockResolvedValue(view({ url: 'http://127.0.0.1:8188', presets: [
    { id: 'photo', name: 'Photoreal', model: MODELS[1].name, family: 'sdxl' },
    { id: 'mine', name: 'Mine', workflowMode: 'custom', workflow: '{"1":{}}' },
  ], defaultPreset: 'photo' }));
  const onNavigate = vi.fn();
  const page = (Page) => render(
    <ImagineSettingsProvider onNavigate={onNavigate}>
      <Page />
      <ImagineSaveBar />
    </ImagineSettingsProvider>
  );
  // ComfyUI: the address and memory, a summary of the styles, no model or workflow.
  page(ComfyPage);
  await screen.findByLabelText('ComfyUI address');
  expect(screen.queryByLabelText('Model')).toBeNull();
  expect(screen.queryByRole('list', { name: 'Styles' })).toBeNull();
  expect(screen.getByText(/2 styles/).textContent).toMatch(/default: Photoreal/);
  fireEvent.click(screen.getByRole('button', { name: 'Edit styles' }));
  expect(onNavigate).toHaveBeenCalledWith('imagine-styles');
  cleanup();
  // Quality: shared settings only, no per-style Advanced.
  page(QualityPage);
  await screen.findByLabelText('Upscale model');
  expect(screen.queryByRole('group', { name: 'Advanced settings' })).toBeNull();
  expect(screen.queryByLabelText('Sampler')).toBeNull();
  cleanup();
  // Styles: the list, then the chosen style's name, model (full width) and Advanced together.
  page(StylesPage);
  const list = await screen.findByRole('list', { name: 'Styles' });
  const panel = screen.getByRole('region', { name: 'Editing style: Photoreal' });
  for (const label of ['Style name', 'Model', 'Model type', 'Prompt prefix (optional)', 'Sampler', 'Negative prompt']) {
    expect(within(panel).getByLabelText(label)).toBeTruthy();
  }
  expect(within(panel).getByLabelText('Model').closest('.sm\:grid-cols-2')).toBeNull(); // not squeezed into half a row
  fireEvent.click(within(list).getByRole('button', { name: /^Mine/ }));
  expect(screen.getByRole('region', { name: 'Editing style: Mine' })).toBeTruthy();
  // A save error naming a style selects it and opens this page.
  onNavigate.mockClear();
  fireEvent.click(within(list).getByRole('button', { name: /^Photoreal/ }));
  fireEvent.change(screen.getByLabelText('Prompt prefix (optional)'), { target: { value: 'RAW photo,' } });
  api.saveImagineSettings.mockRejectedValueOnce(new Error('Mine: Workflow: your ComfyUI doesn’t have this node: X'));
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('imagine-styles'));
  expect(screen.getByRole('region', { name: 'Editing style: Mine' })).toBeTruthy();
});

test('P10-05: strengths are sliders with their value shown and a reset to the default', async () => {
  const { default: StrengthSlider } = await import('./admin/imagine/StrengthSlider.jsx');
  const onChange = vi.fn();
  render(<StrengthSlider id="s" label="Hires strength" value={0.6} onChange={onChange} min={0.1} max={0.8} defaultValue={0.45} low="closer" high="more detail" />);
  const slider = screen.getByLabelText('Hires strength');
  expect(slider.type).toBe('range');
  expect(screen.getByText('0.60')).toBeTruthy();
  fireEvent.change(slider, { target: { value: '0.3' } });
  expect(onChange).toHaveBeenCalledWith(0.3);
  fireEvent.click(screen.getByRole('button', { name: 'Reset to 0.45' }));
  expect(onChange).toHaveBeenCalledWith(0.45);
  cleanup();
  render(<StrengthSlider id="s" label="Hires strength" value={0.45} onChange={onChange} defaultValue={0.45} />);
  expect(screen.queryByRole('button', { name: /^Reset/ })).toBeNull(); // already the default
});
