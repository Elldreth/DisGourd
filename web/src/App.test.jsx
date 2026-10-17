// Smoke test: the whole app renders, signed in and signed out, without throwing
// or logging errors. It catches bugs `vite build` can't, such as a value read
// before it's declared (which blanked the app in P1-13).
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

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
vi.mock('./api.js', () => ({
  getToken: () => (signedIn ? 'token' : ''),
  decodeToken: (t) => (t ? { sub: 1, name: 'tester' } : null),
  setUnauthorizedHandler: () => {},
  clearToken: () => {},
  getAuthInfo: () => Promise.resolve({ registration: 'open', setup: false }),
  getSpaces: () => Promise.resolve([SPACE]),
  getMe: () => Promise.resolve({ id: 1, username: 'tester', avatar: null }),
  getMembers: () => Promise.resolve({ members: [{ username: 'tester', role: 'owner', online: true }] }),
  getMessages: () =>
    Promise.resolve([{ id: 1, author: 'tester', content: 'hello from the smoke test', timestamp: Date.now(), reactions: [], thread: smokeThread }]),
  getDms: () => Promise.resolve([]),
  getDmMessages: () => Promise.resolve([]),
  previewInvite: () => Promise.resolve({ space: 'Book Club', members: 3, alreadyMember: false }),
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

test('invite link: signed out, the code waits through sign-in; signed in, Join opens prefilled and the URL is cleaned', async () => {
  window.history.replaceState(null, '', '/invite/abc123');
  signedIn = false;
  await renderApp();
  expect(await screen.findByText(/sign in/i, { selector: 'button' })).toBeTruthy();
  cleanup();

  // Signing in reloads nothing, but a fresh render stands in for the signed-in app.
  window.history.replaceState(null, '', '/');
  signedIn = true;
  await renderApp();
  expect(screen.getByRole('dialog', { name: 'Add a server' })).toBeTruthy();
  expect(screen.getByRole('textbox', { name: 'Invite code or link' }).value).toBe('abc123');
  expect(await screen.findByText('Book Club')).toBeTruthy();
  expect(window.location.pathname).toBe('/');
  expect(sessionStorage.length).toBe(0);
  expect(errors).toEqual([]);
});

test('invite link while already signed in: Join opens prefilled and the URL is cleaned', async () => {
  window.history.replaceState(null, '', '/?invite=abc123');
  signedIn = true;
  await renderApp();
  expect(screen.getByRole('textbox', { name: 'Invite code or link' }).value).toBe('abc123');
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
