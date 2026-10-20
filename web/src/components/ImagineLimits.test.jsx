// P3-21: saying where the /imagine daily limit comes from — in the chat
// panel, in Settings (servers with their own limit) and in the server dialog.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('../api.js', () => ({
  getImagineSettings: vi.fn(),
  saveImagineSettings: vi.fn(),
  testComfyUI: vi.fn(),
  testKie: vi.fn(),
  tryImagine: vi.fn(),
  setServerImagine: vi.fn(),
}));
const api = await import('../api.js');
const { imagineFor, imagineState, limitSourceText } = await import('./ImaginePanel.jsx');
// P5-03: the single form is now pages; this renders them all at once.
const { default: ImagineAdmin } = await import('./admin/imagine/allPages.testutil.jsx');
const { default: ServerImagineDialog } = await import('./server-settings/ImagineSection.jsx');

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const info = (over = {}) => ({ serverEnabled: true, canUse: true, dailyLimit: 10, usedToday: 10, limitSource: 'server', instanceLimit: 30, engines: [{ id: 'comfyui', name: 'ComfyUI' }], ...over });

test('the used-up reason names where the limit is set', () => {
  expect(imagineFor([{ name: 'Tx Check', imagine: info() }], 'Tx Check', 'general', vi.fn()).reason).toBe(
    'You’ve used all 10 images for today. Tx Check sets its own limit of 10 a day (Server settings → Image generation).'
  );
  expect(imagineState(info({ dailyLimit: 30, usedToday: 30, limitSource: 'instance' }), vi.fn(), 'Tx Check').reason).toBe(
    'You’ve used all 30 images for today. This instance allows 30 a day (Settings → Image generation).'
  );
  expect(limitSourceText({ dailyLimit: 100, limitSource: 'ceiling' })).toBe("That's this instance's maximum of 100 a day.");
});

const view = (serverLimits) => ({
  defaultEngine: 'comfyui', permissive: false, dailyLimit: 30, dailyCeiling: 100, serverLimits,
  engines: [{ id: 'comfyui', name: 'ComfyUI (local)', config: { enabled: true, url: '', model: null, family: null, tier: 'medium' } }],
});

test('Settings lists the servers whose own limit takes priority, and nothing when there are none', async () => {
  api.getImagineSettings.mockResolvedValue(view([{ space: 'Tx Check', limit: 10 }, { space: 'Smoke Test', limit: 50 }]));
  render(<ImagineAdmin />);
  const box = await screen.findByLabelText('Servers with their own limit');
  expect(box.textContent).toContain('These servers set their own limit, which takes priority:');
  expect(box.textContent).toContain('Tx Check — 10 a day');
  expect(box.textContent).toContain('Smoke Test — 50 a day');
  expect(screen.getByText(/A server can set its own number \(up to 100\), which takes priority/)).toBeTruthy();
  cleanup();
  api.getImagineSettings.mockResolvedValue(view([]));
  render(<ImagineAdmin />);
  await screen.findByLabelText('Images per person per day');
  expect(screen.queryByLabelText('Servers with their own limit')).toBeNull();
});

test('the server dialog says what blank means, with the instance default even when the server has its own', () => {
  render(<ServerImagineDialog space="Tx Check" info={info()} onClose={() => {}} />);
  expect(screen.getByLabelText('Images per person per day').value).toBe('');
  expect(screen.getByLabelText('Images per person per day').getAttribute('placeholder')).toBe('Instance default (30)');
  expect(screen.getByText(/Leave blank to use the instance’s default \(30 a day, set in Settings → Image generation\)\. A\s+number here takes priority over it\./)).toBeTruthy();
});
