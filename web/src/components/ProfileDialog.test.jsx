import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

// P4-02: Settings is one dialog with sections you can navigate instead of one
// long scroll. Sections stay mounted while hidden, so edits survive.
// P5-02: a fixed-size window on the settings kit (a list then a page on
// phones), My account with status and Sign out, switches for on/off settings.

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
  expect(tabs.map((t) => t.textContent.trim())).toEqual(['My account', 'Voice & audio', 'Notifications', 'Appearance']);
  expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  // Panels: one visible, the others hidden but still in the DOM.
  const panels = tabs.map(panelFor);
  expect(panels.every(Boolean)).toBe(true);
  expect(panels[0].hidden).toBe(false);
  expect(panels.slice(1).every((p) => p.hidden)).toBe(true);
  expect(within(panels[3]).getByRole('radio', { name: 'Dark', hidden: true })).toBeTruthy(); // mounted while hidden

  fireEvent.click(tabs[3]);
  expect(tabs[3].getAttribute('aria-selected')).toBe('true');
  expect(tabs[0].getAttribute('aria-selected')).toBe('false');
  expect(panels[3].hidden).toBe(false);
  expect(panels[0].hidden).toBe(true);
  expect(screen.getByRole('button', { name: 'Upload avatar', hidden: true })).toBeTruthy(); // Profile still mounted
});

test('a fixed-size window on desktop, full screen on phones, with tap-sized tabs', () => {
  open();
  const dialog = screen.getByRole('dialog', { name: 'Settings' });
  // The height doesn't follow the section, so the list never moves (P5-02 AC-1).
  expect(dialog.className).toMatch(/md:h-\[min\(680px,85vh\)\]/);
  expect(dialog.className).toMatch(/\bh-dvh\b/);
  const list = screen.getByRole('tablist', { name: 'Settings sections' });
  for (const tab of within(list).getAllByRole('tab')) {
    expect(tab.className).toMatch(/\btap-row\b/);
  }
  expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
});

test('My account: who you are, your status, Edit status and Sign out', () => {
  const onLogout = vi.fn();
  const onEditStatus = vi.fn();
  open({ profile: { ...profile, statusEmoji: '🎧', statusText: 'Deep work' }, presence: 'dnd', onLogout, onEditStatus });
  const panel = panelFor(screen.getByRole('tab', { name: 'My account' }));
  expect(within(panel).getByText('s@example.test')).toBeTruthy();
  expect(within(panel).getByText('🎧 Deep work')).toBeTruthy();
  expect(within(panel).getByText('Do Not Disturb')).toBeTruthy();
  fireEvent.click(within(panel).getByRole('button', { name: 'Edit status' }));
  expect(onEditStatus).toHaveBeenCalledTimes(1);
  fireEvent.click(within(panel).getByRole('button', { name: 'Sign out' }));
  expect(onLogout).toHaveBeenCalledTimes(1);
});

test('on/off settings are switches', async () => {
  await act(async () => {
    open();
  });
  for (const name of ['Join/leave sounds', 'Push-to-talk', 'Message sounds']) {
    expect(screen.getByRole('switch', { name, hidden: true })).toBeTruthy();
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

test('site admins get a second group with General and Image generation; members never see it', async () => {
  open();
  expect(screen.queryByRole('tab', { name: 'General' })).toBeNull();
  expect(screen.queryByText('Site admin')).toBeNull();
  cleanup();
  await act(async () => {
    open({ profile: { ...profile, siteAdmin: true } });
  });
  expect(screen.getByText('Site admin')).toBeTruthy();
  const tab = screen.getByRole('tab', { name: 'General' });
  fireEvent.click(tab);
  expect(within(panelFor(tab)).getByRole('switch', { name: /Link previews/ })).toBeTruthy();
  const imagine = screen.getByRole('tab', { name: 'Image generation' });
  fireEvent.click(imagine);
  expect(await within(panelFor(imagine)).findByLabelText('Images per person per day')).toBeTruthy();
  // P5-03: the rest of Image generation is in short pages under it.
  const pages = ['ComfyUI', 'Quality', 'Variations', 'kie.ai', 'Try it'].map((name) => screen.getByRole('tab', { name }));
  fireEvent.click(pages[0]);
  expect(within(panelFor(pages[0])).getByLabelText('ComfyUI address')).toBeTruthy();
});

test('opens at a requested section, and remembers the last one you used', () => {
  open({ initialSection: 'notifications' });
  expect(screen.getByRole('tab', { name: 'Notifications' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByRole('tab', { name: 'Appearance' }));
  cleanup();
  open();
  expect(screen.getByRole('tab', { name: 'Appearance' }).getAttribute('aria-selected')).toBe('true');
});

test('a member whose saved section is the admin one lands on My account', () => {
  localStorage.setItem('dg.settingsSection', 'admin');
  open();
  expect(screen.getByRole('tab', { name: 'My account' }).getAttribute('aria-selected')).toBe('true');
});
