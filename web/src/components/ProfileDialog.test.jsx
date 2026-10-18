import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

// P4-02: Settings is one dialog with sections you can navigate instead of one
// long scroll. Desktop: a section list on the left; phones: a horizontal
// segmented control. Sections stay mounted while hidden, so edits survive.

vi.mock('../api.js', () => ({
  getAdminRegistration: vi.fn(async () => ({ mode: 'open', maxAccounts: 0, envCodeActive: false, codes: [], admins: ['sandy'], linkPreviews: true })),
  setLinkPreviews: vi.fn(async () => ({})),
  setRegistrationMode: vi.fn(),
  createRegCode: vi.fn(),
  revokeRegCode: vi.fn(),
  setSiteAdmin: vi.fn(),
  getImagineSettings: vi.fn(async () => ({ defaultEngine: null, permissive: false, dailyLimit: 20, dailyCeiling: 100, engines: [{ id: 'comfyui', name: 'ComfyUI (local)', config: { enabled: false, url: '', model: null, family: null, tier: 'medium' } }] })),
  saveImagineSettings: vi.fn(),
  testComfyUI: vi.fn(),
  tryImagine: vi.fn(),
  uploadFile: vi.fn(),
  updateMe: vi.fn(),
}));
vi.mock('../audio.js', async (orig) => ({ ...(await orig()), displayCaptureSupported: () => true }));
const { default: ProfileDialog } = await import('./ProfileDialog.jsx');

const profile = { username: 'sandy', email: 's@example.test' };
const noop = () => {};

beforeEach(() => {
  localStorage.clear();
});
afterEach(cleanup);

function open(props = {}) {
  return render(<ProfileDialog profile={profile} onClose={noop} onUpdated={noop} {...props} />);
}

const panelFor = (tab) => document.getElementById(tab.getAttribute('aria-controls'));

test('the sections are tabs; only the chosen one is shown and the rest stay mounted', () => {
  open();
  const list = screen.getByRole('tablist', { name: 'Settings sections' });
  const tabs = within(list).getAllByRole('tab');
  expect(tabs.map((t) => t.textContent.trim())).toEqual(['Profile', 'Voice & audio', 'Appearance', 'Notifications']);
  expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  // Panels: one visible, the others hidden but still in the DOM.
  const panels = tabs.map(panelFor);
  expect(panels.every(Boolean)).toBe(true);
  expect(panels[0].hidden).toBe(false);
  expect(panels.slice(1).every((p) => p.hidden)).toBe(true);
  expect(within(panels[2]).getByRole('radio', { name: 'Dark', hidden: true })).toBeTruthy(); // mounted while hidden

  fireEvent.click(tabs[2]);
  expect(tabs[2].getAttribute('aria-selected')).toBe('true');
  expect(tabs[0].getAttribute('aria-selected')).toBe('false');
  expect(panels[2].hidden).toBe(false);
  expect(panels[0].hidden).toBe(true);
  expect(screen.getByRole('button', { name: 'Upload avatar', hidden: true })).toBeTruthy(); // Profile still mounted
});

test('the section list is a left column on desktop and a horizontal strip on phones, with tap-sized tabs', () => {
  open();
  const list = screen.getByRole('tablist', { name: 'Settings sections' });
  expect(list.className).toMatch(/\boverflow-x-auto\b/);
  expect(list.className).toMatch(/\bmd:flex-col\b/);
  for (const tab of within(list).getAllByRole('tab')) {
    expect(tab.className).toMatch(/\btap-row\b/);
  }
});

test('arrow keys, Home and End move between tabs; Enter puts focus in the panel', () => {
  open();
  const tabs = screen.getAllByRole('tab');
  tabs[0].focus();
  fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
  expect(document.activeElement).toBe(tabs[1]);
  expect(tabs[1].getAttribute('aria-selected')).toBe('true');
  expect(tabs[1].tabIndex).toBe(0);
  expect(tabs[0].tabIndex).toBe(-1);
  fireEvent.keyDown(tabs[1], { key: 'End' });
  expect(document.activeElement).toBe(tabs[3]);
  fireEvent.keyDown(tabs[3], { key: 'ArrowRight' });
  expect(document.activeElement).toBe(tabs[0]); // wraps
  fireEvent.keyDown(tabs[0], { key: 'ArrowUp' });
  expect(document.activeElement).toBe(tabs[3]);
  fireEvent.keyDown(tabs[3], { key: 'Home' });
  expect(document.activeElement).toBe(tabs[0]);
  fireEvent.keyDown(tabs[0], { key: 'Enter' });
  expect(document.activeElement).toBe(panelFor(tabs[0]));
});

test('site admins get a second group with Registration & access; members never see it', async () => {
  open();
  expect(screen.queryByRole('tab', { name: 'Registration & access' })).toBeNull();
  expect(screen.queryByText('Site admin')).toBeNull();
  cleanup();
  await act(async () => {
    open({ profile: { ...profile, siteAdmin: true } });
  });
  expect(screen.getByText('Site admin')).toBeTruthy();
  const tab = screen.getByRole('tab', { name: 'Registration & access' });
  fireEvent.click(tab);
  expect(within(panelFor(tab)).getByRole('checkbox', { name: /Link previews/ })).toBeTruthy();
  const imagine = screen.getByRole('tab', { name: 'Image generation' });
  fireEvent.click(imagine);
  expect(await within(panelFor(imagine)).findByLabelText('ComfyUI address')).toBeTruthy();
});

test('opens at a requested section, and remembers the last one you used', () => {
  open({ initialSection: 'notifications' });
  expect(screen.getByRole('tab', { name: 'Notifications' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByRole('tab', { name: 'Appearance' }));
  cleanup();
  open();
  expect(screen.getByRole('tab', { name: 'Appearance' }).getAttribute('aria-selected')).toBe('true');
});

test('a member whose saved section is the admin one lands on Profile', () => {
  localStorage.setItem('dg.settingsSection', 'admin');
  open();
  expect(screen.getByRole('tab', { name: 'Profile' }).getAttribute('aria-selected')).toBe('true');
});
