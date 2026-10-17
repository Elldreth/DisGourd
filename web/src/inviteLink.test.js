import { afterEach, beforeEach, expect, test } from 'vitest';
import { capturePendingInvite, clearPendingInvite, inviteLink, readInviteFromLocation } from './inviteLink.js';

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});
afterEach(() => window.history.replaceState(null, '', '/'));

test('inviteLink builds <origin>/invite/<code>', () => {
  expect(inviteLink('abc123', 'https://chat.example.com')).toBe('https://chat.example.com/invite/abc123');
  expect(inviteLink('a b/c', 'http://x')).toBe('http://x/invite/a%20b%2Fc');
  expect(inviteLink('abc123')).toBe(`${window.location.origin}/invite/abc123`);
});

test('readInviteFromLocation reads /invite/<code> and ?invite=<code>', () => {
  expect(readInviteFromLocation(new URL('https://x/invite/abc123'))).toBe('abc123');
  expect(readInviteFromLocation(new URL('https://x/invite/abc123/'))).toBe('abc123');
  expect(readInviteFromLocation(new URL('https://x/invite/a%20b'))).toBe('a b');
  expect(readInviteFromLocation(new URL('https://x/?invite=abc123'))).toBe('abc123');
  expect(readInviteFromLocation(new URL('https://x/'))).toBe('');
  expect(readInviteFromLocation(new URL('https://x/something/else'))).toBe('');
});

test('a code in the URL is remembered, and still there after the URL changes (sign-in)', () => {
  window.history.replaceState(null, '', '/invite/abc123');
  expect(capturePendingInvite()).toBe('abc123');
  window.history.replaceState(null, '', '/');
  expect(capturePendingInvite()).toBe('abc123');
});

test('nothing in the URL or storage: no pending invite', () => {
  expect(capturePendingInvite()).toBe('');
});

test('clearPendingInvite forgets the code and cleans the URL', () => {
  window.history.replaceState(null, '', '/invite/abc123');
  capturePendingInvite();
  clearPendingInvite();
  expect(window.location.pathname).toBe('/');
  expect(capturePendingInvite()).toBe('');

  window.history.replaceState(null, '', '/?invite=xyz&theme=dark#top');
  capturePendingInvite();
  clearPendingInvite();
  expect(window.location.pathname + window.location.search + window.location.hash).toBe('/?theme=dark#top');
  expect(capturePendingInvite()).toBe('');
});
