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
  expect(within(model).getAllByRole('option').map((o) => o.value)).toEqual(['', ...MODELS.map((m) => m.name)]);
  fireEvent.change(model, { target: { value: MODELS[0].name } });
  expect(screen.getByLabelText('Model type').value).toBe('flux');
  fireEvent.click(screen.getByLabelText('Use my ComfyUI (local, free)'));
  fireEvent.click(screen.getByRole('radio', { name: /High/ }));
  fireEvent.change(screen.getByLabelText('Images per person per day'), { target: { value: '8' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(api.saveImagineSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        engines: expect.objectContaining({ comfyui: { enabled: true, url: 'http://127.0.0.1:8188', model: MODELS[0].name, family: 'flux', tier: 'high' } }),
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
  expect(screen.getByLabelText('Model').value).toBe(MODELS[1].name);
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
