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
    expect(api.saveImagineSettings).toHaveBeenCalledWith({
      engines: { comfyui: { enabled: true, url: 'http://127.0.0.1:8188', model: MODELS[0].name, family: 'flux', tier: 'high' } },
      defaultEngine: 'comfyui',
      dailyLimit: 8,
      permissive: false,
    })
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
  expect(await screen.findByText('Save an address and a model first.')).toBeTruthy();
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
