// Smoke test: the whole app renders, signed in and signed out, without throwing
// or logging errors. It catches bugs `vite build` can't, such as a value read
// before it's declared (which blanked the app in P1-13).
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const SPACE = {
  name: 'Smoke',
  channels: ['general'],
  voiceChannels: ['lounge'],
  role: 'owner',
  permissions: { delete_others_messages: 2 },
  channelMeta: { general: { type: 'text', view: 1, post: 1 }, lounge: { type: 'voice', view: 1, post: 1 } },
};

// A fake server API; each test sets whether we're signed in.
let signedIn = true;
let smokeThread = null; // a thread summary on the smoke message, when a test wants one
let spaces = []; // what getSpaces returns; createSpace adds to it
vi.mock('./api.js', () => ({
  getVoiceIce: vi.fn(async () => ({ iceServers: [{ urls: 'stun:stun.example.org' }], relayOnly: false, expiresAt: null })), // P11-11
  getToken: () => (signedIn ? 'token' : ''),
  decodeToken: (t) => (t ? { sub: 1, name: 'tester' } : null),
  setUnauthorizedHandler: () => {},
  setEmailUnconfirmedHandler: () => {}, // P12-02
  clearToken: () => {},
  getAuthInfo: () => Promise.resolve({ registration: 'open', setup: false }),
  getSpaces: () => Promise.resolve(spaces),
  createSpace: (name) => {
    spaces = [...spaces, { ...SPACE, name, channels: ['general'], voiceChannels: [] }];
    return Promise.resolve({ name });
  },
  getMe: () => Promise.resolve({ id: 1, username: 'tester', avatar: null }),
  getMembers: () => Promise.resolve({ members: [{ username: 'tester', role: 'owner', online: true }] }),
  getRoles: () => Promise.resolve({ roles: [{ id: 1, name: '@everyone', color: null, position: 0, isDefault: true, permissions: ['invite'], members: [] }] }),
  getMessages: () =>
    Promise.resolve([{ id: 1, author: 'tester', content: 'hello from the smoke test', timestamp: Date.now(), reactions: [], thread: smokeThread }]),
  getDms: () => Promise.resolve([]),
  getBlocks: () => Promise.resolve([]), // P9-07b
  getDmMessages: () => Promise.resolve([]),
  previewInvite: () => Promise.resolve({ space: 'Book Club', members: 3, alreadyMember: false }),
  // P14-02: the public preview, and joining (which adds the server to the list).
  getInvitePreview: vi.fn(() => Promise.resolve({ space: 'Book Club', icon: null, inviter: 'ann', members: 3, signUp: true })),
  joinInvite: vi.fn((code) => {
    if (!spaces.some((s) => s.name === 'Book Club')) spaces = [...spaces, { ...SPACE, name: 'Book Club', channels: ['general'], voiceChannels: [] }];
    return Promise.resolve({ name: 'Book Club', code });
  }),
}));

// A WebSocket that never connects anywhere.
class FakeSocket {
  static OPEN = 1;
  constructor() {
    this.readyState = 0;
  }
  send() {}
  close() {}
}

let errors;
beforeEach(() => {
  errors = [];
  spaces = [SPACE];
  vi.stubGlobal('WebSocket', FakeSocket);
  // jsdom has no layout, so these browser APIs are missing.
  Element.prototype.scrollIntoView = () => {};
  vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args.map(String).join(' ')));
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderApp() {
  const { default: App } = await import('./App.jsx');
  await act(async () => {
    render(<App />);
  });
  // Let the initial loads (spaces, members, messages) resolve and re-render.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
}

test('signed in: renders the server, its channels and the message list', async () => {
  signedIn = true;
  await renderApp();
  expect(await screen.findByText('hello from the smoke test')).toBeTruthy();
  expect(screen.getByRole('log', { name: 'Messages in #general' })).toBeTruthy();
  expect(screen.getByText('lounge')).toBeTruthy();
  expect(errors).toEqual([]);
});

test('signed out: renders the sign-in screen', async () => {
  signedIn = false;
  await renderApp();
  expect(await screen.findByText(/sign in/i, { selector: 'button' })).toBeTruthy();
  expect(errors).toEqual([]);
});

test('invite link: signed out, it is the invite’s landing page; once signed in, the server is joined and opened', async () => {
  const api = await import('./api.js');
  window.history.replaceState(null, '', '/invite/abc123');
  signedIn = false;
  await renderApp();
  expect(await screen.findByRole('heading', { name: 'You’re invited to Book Club' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Create account' })).toBeTruthy(); // this link can create an account
  expect(api.getInvitePreview).toHaveBeenCalledWith('abc123');
  cleanup();

  // Signing in reloads nothing, but a fresh render stands in for the signed-in app.
  window.history.replaceState(null, '', '/');
  signedIn = true;
  spaces = [];
  await renderApp();
  await waitFor(() => expect(api.joinInvite).toHaveBeenCalledWith('abc123'));
  // Joined and in the rail (this test renders without the toast layer, so no "Welcome" toast).
  expect((await screen.findAllByRole('button', { name: /^Book Club/ })).length).toBeGreaterThan(0);
  expect(screen.queryByRole('dialog', { name: 'Add a server' })).toBeNull(); // no Join step any more
  expect(window.location.pathname).toBe('/');
  expect(sessionStorage.length).toBe(0);
  expect(errors).toEqual([]);
});

test('invite link while already signed in: joined and opened at once, and the URL is cleaned', async () => {
  const api = await import('./api.js');
  api.joinInvite.mockClear();
  window.history.replaceState(null, '', '/?invite=abc123');
  signedIn = true;
  spaces = [];
  await renderApp();
  await waitFor(() => expect(api.joinInvite).toHaveBeenCalledWith('abc123'));
  expect((await screen.findAllByRole('button', { name: /^Book Club/ })).length).toBeGreaterThan(0);
  expect(window.location.search).toBe('');
  expect(errors).toEqual([]);
});

test('threads: the summary opens the side panel, and Esc closes it and gives focus back to the summary', async () => {
  signedIn = true;
  smokeThread = { id: 3, channel: '~t1', name: 'Weekend plans', messageCount: 1, lastActivityAt: Date.now() };
  try {
    await renderApp();
    const summary = await screen.findByRole('button', { name: 'Open thread Weekend plans, 1 reply' });
    await act(async () => {
      summary.click();
    });
    const panel = screen.getByRole('complementary', { name: 'Thread: Weekend plans' });
    expect(panel.textContent).toContain('#general');
    await act(async () => {
      fireEvent.keyDown(panel, { key: 'Escape' });
    });
    expect(screen.queryByRole('complementary', { name: 'Thread: Weekend plans' })).toBeNull();
    expect(document.activeElement).toBe(summary);
    expect(errors).toEqual([]);
  } finally {
    smokeThread = null;
  }
});

test('creating a server from the DM view lands you in it (P3-16)', async () => {
  signedIn = true;
  await renderApp();
  await act(async () => {
    screen.getByRole('button', { name: /^Direct Messages/ }).click();
  });
  expect(screen.queryByRole('log', { name: 'Messages in #general' })).toBeNull(); // the DM view
  await act(async () => {
    screen.getByRole('button', { name: 'Create a server' }).click();
  });
  const dialog = screen.getByRole('dialog', { name: 'Add a server' });
  fireEvent.change(screen.getByPlaceholderText('My friends'), { target: { value: 'Split Check' } });
  await act(async () => {
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await new Promise((r) => setTimeout(r, 50));
  });
  expect(await screen.findByRole('heading', { name: 'Split Check' })).toBeTruthy();
  expect(screen.getByRole('log', { name: 'Messages in #general' })).toBeTruthy();
  expect(errors).toEqual([]);
});
