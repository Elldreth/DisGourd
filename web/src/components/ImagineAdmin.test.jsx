import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const MODELS = [
  { name: 'Flux\\flux1-dev-fp8.safetensors', family: 'flux' },
  { name: 'Illustrious\\Illustrious-XL-v2.0.safetensors', family: 'sdxl' },
  { name: 'SD1\\absolutereality_v16.safetensors', family: 'sd15' },
];
const view = (comfy = {}) => ({
  defaultEngine: null,
  permissive: false,
  dailyLimit: 20,
  dailyCeiling: 100,
  engines: [{ id: 'comfyui', name: 'ComfyUI (local)', config: { enabled: false, url: '', model: null, family: null, tier: 'medium', ...comfy } }],
});
vi.mock('../api.js', () => ({
  getImagineSettings: vi.fn(),
  testKie: vi.fn(),
  saveImagineSettings: vi.fn(),
  testComfyUI: vi.fn(),
  tryImagine: vi.fn(),
}));
const api = await import('../api.js');
const { default: ImagineAdmin } = await import('./ImagineAdmin.jsx');

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
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(api.saveImagineSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        engines: expect.objectContaining({
          comfyui: { enabled: true, url: 'http://127.0.0.1:8188', model: MODELS[0].name, kind: 'checkpoint', family: 'flux', tier: 'high', clip1: null, clip2: null, vae: null, hires: true, upscaler: null },
        }),
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
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
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
  { id: 'flux-2/pro-text-to-image', name: 'Flux-2 Pro', note: 'High quality.', filterable: true, price: { credits: 5.5, estimate: false } },
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
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(api.saveImagineSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        engines: expect.objectContaining({ kie: { enabled: true, model: 'flux-2/pro-text-to-image', customModel: '', monthlyCredits: 500, apiKey: 'new-key-9999' } }),
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
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
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
  expect(within(screen.getByLabelText('Model type')).getAllByRole('option').map((o) => o.value)).toEqual(['flux', 'zimage']);
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
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(api.saveImagineSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        engines: expect.objectContaining({
          comfyui: { enabled: true, url: 'http://127.0.0.1:8188', model: 'mystery.safetensors', kind: 'unet', family: 'flux', tier: 'medium', clip1: SPLIT.clips[0], clip2: SPLIT.clips[1], vae: SPLIT.vaes[1], hires: true, upscaler: null },
        }),
      })
    )
  );
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
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.saveImagineSettings.mock.calls.at(-1)[0].engines.comfyui).toMatchObject({ hires: true, upscaler: '4x-AnimeSharp.pth' }));
  fireEvent.click(hires);
  expect(screen.queryByLabelText('Upscale model')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.saveImagineSettings.mock.calls.at(-1)[0].engines.comfyui).toMatchObject({ hires: false }));
});
