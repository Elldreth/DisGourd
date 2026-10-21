// P14-02: one invite link. The signed-out landing page (sign up and join, or
// sign in only), Site admin › General's new settings, and the invite dialog's
// line about what its link does.
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { computeAccessibleName } from 'dom-accessibility-api';

vi.mock('../api.js', () => ({
  getAuthInfo: vi.fn(),
  getInvitePreview: vi.fn(),
  register: vi.fn(),
  login: vi.fn(),
  setToken: vi.fn(),
  getAdminRegistration: vi.fn(),
  setRegistrationMode: vi.fn(async () => ({})),
  setRegistrationSettings: vi.fn(async () => ({})),
  setLinkPreviews: vi.fn(),
  createRegCode: vi.fn(),
  revokeRegCode: vi.fn(),
  setSiteAdmin: vi.fn(),
}));
const api = await import('../api.js');
const { default: Login } = await import('./Login.jsx');
const { default: RegistrationAdmin } = await import('./RegistrationAdmin.jsx');
const { default: InviteDialog } = await import('./InviteDialog.jsx');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const unnamed = () => [...document.body.querySelectorAll('button, input, select')].filter((el) => !/\p{L}/u.test(computeAccessibleName(el))).map((el) => el.outerHTML.slice(0, 90));

test('an invite that can create accounts: "You’re invited to …", sign-up with no code field, and the invite goes with it', async () => {
  api.getAuthInfo.mockResolvedValue({ registration: 'invite', emailRequired: false });
  api.getInvitePreview.mockResolvedValue({ space: 'Den of Thieves', icon: null, inviter: 'elldreth', members: 3, signUp: true });
  api.register.mockResolvedValue({ token: 't1', joined: 'Den of Thieves' });
  const onAuthed = vi.fn();
  render(<Login inviteCode="K7MPQ-X3HRT" onAuthed={onAuthed} />);
  expect(await screen.findByRole('heading', { name: 'You’re invited to Den of Thieves' })).toBeTruthy();
  expect(screen.getByText('elldreth invited you · 3 members. Create your account to join.')).toBeTruthy();
  expect(screen.queryByPlaceholderText('Enter the code you were given')).toBeNull(); // no sign-up code needed
  fireEvent.change(screen.getByPlaceholderText('your_name'), { target: { value: 'friend' } });
  fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'f@example.com' } });
  fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'amber-lantern-orbit-58' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  await waitFor(() => expect(onAuthed).toHaveBeenCalledWith('t1'));
  expect(api.register).toHaveBeenCalledWith('friend', 'amber-lantern-orbit-58', 'f@example.com', undefined, undefined, 'K7MPQ-X3HRT');
  expect(unnamed()).toEqual([]);
});

test('an invite that can’t create accounts here: sign in only, and it says why', async () => {
  api.getAuthInfo.mockResolvedValue({ registration: 'invite' });
  api.getInvitePreview.mockResolvedValue({ space: 'Sams Place', icon: null, inviter: 'sam', members: 1, signUp: false });
  render(<Login inviteCode="AAAAA-BBBBB" onAuthed={() => {}} />);
  expect(await screen.findByRole('heading', { name: 'You’re invited to Sams Place' })).toBeTruthy();
  expect(screen.getByText('sam invited you · 1 member. Sign in to join.')).toBeTruthy();
  expect(screen.getByText(/This link can’t create new accounts here, so sign in to join/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Register' })).toBeNull();
});

test('a dead invite: says so, forgets it, and shows the normal sign-in', async () => {
  api.getAuthInfo.mockResolvedValue({ registration: 'open' });
  api.getInvitePreview.mockRejectedValue(new Error('This invite is invalid or has expired'));
  const onInviteGone = vi.fn();
  render(<Login inviteCode="NOPE2-NOPE3" onAuthed={() => {}} onInviteGone={onInviteGone} />);
  expect(await screen.findByText('This invite is invalid or has expired.')).toBeTruthy();
  expect(onInviteGone).toHaveBeenCalled();
  expect(screen.getByRole('heading', { name: 'Welcome to DisGourd' })).toBeTruthy();
});

test('Site admin › General: Invite only, "who can bring in new people", and Closed’s switch', async () => {
  const data = { mode: 'invite', maxAccounts: 0, envCodeActive: false, codes: [], admins: ['elldreth'], linkPreviews: true, closedAllowsInvites: false, invitesCreateAccounts: 'site_admins' };
  api.getAdminRegistration.mockResolvedValue(data);
  render(<RegistrationAdmin />);
  const who = await screen.findByRole('combobox', { name: 'Who can bring in new people with their invites' });
  expect(who.value).toBe('site_admins');
  expect(screen.getByText(/Only invites made by a site admin bring in new people/)).toBeTruthy();
  expect(screen.getByText('Sign-up codes')).toBeTruthy();
  fireEvent.change(who, { target: { value: 'inviters' } });
  expect(api.setRegistrationSettings).toHaveBeenCalledWith({ invitesCreateAccounts: 'inviters' });
  expect(screen.getByText(/Pair it with “Require a confirmed email”/)).toBeTruthy();
  // Closed: the switch; "who" stays hidden until it's on.
  fireEvent.change(screen.getByRole('combobox', { name: 'Who can create an account' }), { target: { value: 'closed' } });
  await waitFor(() => expect(api.setRegistrationMode).toHaveBeenCalledWith('closed'));
  expect(screen.queryByRole('combobox', { name: 'Who can bring in new people with their invites' })).toBeNull();
  fireEvent.click(screen.getByRole('switch', { name: 'Invite links still let people sign up' }));
  expect(api.setRegistrationSettings).toHaveBeenCalledWith({ closedAllowsInvites: true });
  expect(screen.getByRole('combobox', { name: 'Who can bring in new people with their invites' })).toBeTruthy();
  expect(unnamed()).toEqual([]);
});

test('the invite dialog says whether its link can create accounts', async () => {
  api.getInvitePreview.mockResolvedValueOnce({ space: 'Den', signUp: true }).mockResolvedValueOnce({ space: 'Den', signUp: false });
  const { rerender } = render(<InviteDialog space="Den" code="AAAAA-BBBBB" onClose={() => {}} />);
  expect(await screen.findByText('New people can create an account with this link.')).toBeTruthy();
  rerender(<InviteDialog space="Den" code="CCCCC-DDDDD" onClose={() => {}} />);
  expect(await screen.findByText('Only people who already have an account can use this link.')).toBeTruthy();
});
