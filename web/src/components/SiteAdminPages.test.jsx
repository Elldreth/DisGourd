// P5-03: Site admin › Image generation as short pages sharing one draft and a
// save bar; Settings asks before closing with unsaved changes.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const view = (comfy = {}, extra = {}) => ({
  defaultEngine: 'comfyui',
  permissive: false,
  dailyLimit: 20,
  dailyCeiling: 100,
  engines: [{ id: 'comfyui', name: 'ComfyUI (local)', config: { enabled: true, url: 'http://pc:8188', model: 'sdxl.safetensors', family: 'sdxl', tier: 'medium', ...comfy } }],
  ...extra,
});
vi.mock('../api.js', () => ({
  getMe: vi.fn(async () => ({ dmPolicy: 'friends_and_servers' })), // P11-09: Privacy & safety
  getEmailStatus: vi.fn(), // P12-01
  sendTestEmail: vi.fn(),
  getAdminRegistration: vi.fn(async () => ({ mode: 'open', maxAccounts: 0, envCodeActive: false, codes: [], admins: ['sandy'], linkPreviews: true })),
  setLinkPreviews: vi.fn(async () => ({})),
  setRegistrationMode: vi.fn(),
  createRegCode: vi.fn(),
  revokeRegCode: vi.fn(),
  setSiteAdmin: vi.fn(),
  getImagineSettings: vi.fn(),
  saveImagineSettings: vi.fn(),
  testComfyUI: vi.fn(),
  testKie: vi.fn(),
  tryImagine: vi.fn(),
  uploadFile: vi.fn(),
  updateMe: vi.fn(),
}));
const api = await import('../api.js');
const { default: ProfileDialog } = await import('./ProfileDialog.jsx');

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  api.getAdminRegistration.mockResolvedValue({ mode: 'open', maxAccounts: 0, envCodeActive: false, codes: [], admins: ['sandy'], linkPreviews: true });
  api.getImagineSettings.mockResolvedValue(view());
  // The automatic test on open suggests an upscale model.
  api.testComfyUI.mockResolvedValue({ url: 'http://pc:8188', models: [{ name: 'sdxl.safetensors', family: 'sdxl' }], upscalers: ['4x.pth'], suggested: { upscaler: '4x.pth' } });
});
afterEach(cleanup);

const admin = { username: 'sandy', email: 's@example.test', siteAdmin: true };
async function open(props = {}) {
  await act(async () => {
    render(<ProfileDialog profile={admin} onClose={() => {}} onUpdated={() => {}} initialSection="imagine" {...props} />);
  });
  await waitFor(() => expect(api.testComfyUI).toHaveBeenCalled());
}
const panelFor = (name) => document.getElementById(screen.getByRole('tab', { name }).getAttribute('aria-controls'));
const bars = () => screen.queryAllByRole('region', { name: 'Unsaved changes' });

test('Site admin lists General, Image generation and its six pages, the pages indented', async () => {
  await open();
  const tabs = within(screen.getByRole('tablist')).getAllByRole('tab').map((t) => t.textContent);
  expect(tabs.slice(5)).toEqual(['General', 'People', 'Email', 'Image generation', 'ComfyUI', 'Styles', 'Quality', 'Variations', 'kie.ai', 'Try it']); // Styles: P10-05; People: P11-09; Email: P12-01
  expect(screen.getByRole('tab', { name: 'Quality' }).className).toMatch(/\bpl-6\b/);
  // Link previews lives on General now.
  expect(within(panelFor('General')).getByText(/Link previews/)).toBeTruthy();
});

test('opening is not an edit: no save bar, even after the automatic test fills in suggestions', async () => {
  await open();
  await screen.findByText(/Reachable · 1 model/);
  expect(bars()).toHaveLength(0);
});

test('an edit on one page shows the save bar; it survives a switch to another page; Reset puts it back', async () => {
  await open();
  fireEvent.click(screen.getByRole('tab', { name: 'Variations' }));
  fireEvent.change(within(panelFor('Variations')).getByLabelText('Loops'), { target: { value: '4' } });
  expect(within(panelFor('Variations')).getByRole('region', { name: 'Unsaved changes' })).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'Quality' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Variations' }));
  expect(within(panelFor('Variations')).getByLabelText('Loops').value).toBe('4');
  fireEvent.click(within(panelFor('Variations')).getByRole('button', { name: 'Reset' }));
  expect(within(panelFor('Variations')).getByLabelText('Loops').value).toBe('2');
  expect(bars()).toHaveLength(0);
});

test('Save sends edits from several pages at once, then the bar goes and says Saved', async () => {
  api.saveImagineSettings.mockImplementation(async (body) => ({ ...view(body.engines.comfyui), dailyLimit: body.dailyLimit }));
  await open();
  fireEvent.change(within(panelFor('Image generation')).getByLabelText('Images per person per day'), { target: { value: '7' } });
  fireEvent.click(screen.getByRole('tab', { name: 'ComfyUI' }));
  fireEvent.click(within(panelFor('ComfyUI')).getByRole('radio', { name: /^High/ }));
  fireEvent.click(within(panelFor('ComfyUI')).getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(api.saveImagineSettings).toHaveBeenCalledTimes(1));
  const body = api.saveImagineSettings.mock.calls[0][0];
  expect(body.dailyLimit).toBe(7);
  expect(body.engines.comfyui).toMatchObject({ tier: 'high', upscaler: '4x.pth' });
  expect(await within(panelFor('ComfyUI')).findByText('Saved')).toBeTruthy();
  expect(bars()).toHaveLength(0);
});

test('closing with unsaved changes asks first; Discard closes, Keep editing stays', async () => {
  const onClose = vi.fn();
  await open({ onClose });
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(onClose).toHaveBeenCalledTimes(1); // nothing changed: closes at once
  fireEvent.click(within(panelFor('Image generation')).getByRole('switch', { name: /Allow unfiltered images/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(onClose).toHaveBeenCalledTimes(1);
  const confirm = screen.getByRole('dialog', { name: 'Discard changes?' });
  fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog', { name: 'Discard changes?' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Discard changes?' })).getByRole('button', { name: 'Discard' }));
  expect(onClose).toHaveBeenCalledTimes(2);
});

test('the Overview cards say how each engine stands and open its page', async () => {
  await open();
  const item = await within(panelFor('Image generation')).findByRole('listitem');
  const card = within(item).getByRole('button'); // a list of buttons (P5-00 integration: axe)
  expect(card.textContent).toMatch(/ComfyUI\s*On/);
  expect(card.textContent).toContain('sdxl.safetensors');
  fireEvent.click(card);
  expect(screen.getByRole('tab', { name: 'ComfyUI' }).getAttribute('aria-selected')).toBe('true');
});

test('Try it waits for unsaved changes to be saved', async () => {
  await open();
  fireEvent.click(screen.getByRole('tab', { name: 'Try it' }));
  const tryPanel = panelFor('Try it');
  fireEvent.change(within(tryPanel).getByLabelText('Test prompt'), { target: { value: 'a gourd' } });
  expect(within(tryPanel).getByRole('button', { name: 'Generate' }).disabled).toBe(false);
  fireEvent.change(within(panelFor('Variations')).getByLabelText('Loops'), { target: { value: '3' } });
  expect(within(tryPanel).getByRole('button', { name: 'Generate' }).disabled).toBe(true);
  expect(within(tryPanel).getByText(/save them first/)).toBeTruthy();
});

test("the overview's kie.ai card says what it has cost this month, against the cap if there is one (P7-05)", async () => {
  const kie = (config, spentThisMonth) => ({ id: 'kie', name: 'kie.ai', config: { enabled: true, model: 'z-image', keySaved: true, ...config }, models: [{ id: 'z-image', name: 'Z-Image' }], spentThisMonth });
  api.getImagineSettings.mockResolvedValue(view({}, { engines: [view().engines[0], kie({ monthlyCredits: 200 }, 12.4)] }));
  await open();
  const engines = await screen.findByRole('list', { name: 'Engines' });
  expect(within(engines).getByText('12.4 of 200 credits used this month')).toBeTruthy();
  cleanup();
  api.getImagineSettings.mockResolvedValue(view({}, { engines: [view().engines[0], kie({ monthlyCredits: null }, 1)] }));
  await open();
  expect(within(await screen.findByRole('list', { name: 'Engines' })).getByText('1 credit used this month · no cap')).toBeTruthy();
  cleanup();
  // No key yet: it says that instead.
  api.getImagineSettings.mockResolvedValue(view({}, { engines: [view().engines[0], kie({ keySaved: false }, 0)] }));
  await open();
  const noKey = await screen.findByRole('list', { name: 'Engines' });
  expect(within(noKey).getByText('No API key yet')).toBeTruthy();
  expect(within(noKey).queryByText(/used this month/)).toBeNull();
});
