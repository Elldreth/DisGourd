import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../api.js', () => ({
  register: vi.fn(async () => ({ token: 'tok' })),
  setToken: vi.fn(),
  getAdminRegistration: vi.fn(async () => ({ mode: 'open', envCodeActive: false })),
  setRegistrationMode: vi.fn(async () => ({})),
  createSpace: vi.fn(async () => ({})),
  createInvite: vi.fn(async () => ({ code: 'INV123' })),
  createRegCode: vi.fn(async () => ({ code: 'REG456' })),
}));
const api = await import('../api.js');
const { default: SetupWizard } = await import('./SetupWizard.jsx');

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

// Field labels include their hint ("Password  At least 8 characters"), so match the start.
const type = (label, value) => fireEvent.change(screen.getByLabelText(new RegExp(`^${label}`)), { target: { value } });
const submit = async (name) => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
};

async function throughAccount() {
  const onAuthed = vi.fn();
  render(<SetupWizard onAuthed={onAuthed} />);
  expect(screen.getByText(/Step 1 of 4/)).toBeTruthy();
  type('Admin username', 'sandy');
  type('Email', 'sandy@example.test');
  type('Password', 'sandbox-pass-123');
  await submit('Create admin account');
  expect(api.register).toHaveBeenCalledWith('sandy', 'sandbox-pass-123', 'sandy@example.test');
  expect(api.setToken).toHaveBeenCalledWith('tok');
  expect(onAuthed).not.toHaveBeenCalled(); // the wizard keeps going
  return onAuthed;
}

test('the whole way: account, who can join, first server, then a message to send friends', async () => {
  const onAuthed = await throughAccount();

  expect(screen.getByText(/Step 2 of 4/)).toBeTruthy();
  const radios = screen.getAllByRole('radio');
  expect(radios.map((r) => r.closest('label').textContent)).toEqual([
    expect.stringMatching(/Invite code.*Recommended/s),
    expect.stringMatching(/Open/),
    expect.stringMatching(/Closed/),
  ]);
  expect(screen.getByRole('radio', { name: /Open/ }).checked).toBe(true); // the server's current mode
  fireEvent.click(screen.getByRole('radio', { name: /Invite code/ }));
  await submit('Continue');
  expect(api.setRegistrationMode).toHaveBeenCalledWith('code');

  expect(screen.getByText(/Step 3 of 4/)).toBeTruthy();
  type('Server name', 'Book Club');
  await submit('Create server');
  expect(api.createSpace).toHaveBeenCalledWith('Book Club');
  expect(api.createInvite).toHaveBeenCalledWith('Book Club');

  expect(screen.getByText(/Step 4 of 4/)).toBeTruthy();
  await submit('Create a registration code');
  expect(api.createRegCode).toHaveBeenCalled();
  const message = screen.getByLabelText('Message for your friends').value;
  expect(message).toContain(location.origin);
  expect(message).toContain('REG456');
  expect(message).toContain('INV123');
  // The invite goes out as a link that opens the Join dialog, with the code as a fallback.
  expect(message).toContain(`${location.origin}/invite/INV123`);
  expect(message).not.toMatch(/paste this invite/i);
  expect(screen.getByRole('button', { name: 'Copy message' })).toBeTruthy();

  await submit('Open DisGourd');
  expect(onAuthed).toHaveBeenCalledWith('tok');
});

test('choosing closed explains that nobody else can sign up, and saves it', async () => {
  await throughAccount();
  fireEvent.click(screen.getByRole('radio', { name: /Closed/ }));
  expect(screen.getByText(/no one else can create an account/i)).toBeTruthy();
  await submit('Continue');
  expect(api.setRegistrationMode).toHaveBeenCalledWith('closed');
});

test('keeping the current mode does not call the server', async () => {
  await throughAccount();
  await submit('Continue');
  expect(api.setRegistrationMode).not.toHaveBeenCalled();
});

test('a mode preset by the server config is shown and explained', async () => {
  api.getAdminRegistration.mockResolvedValueOnce({ mode: 'code', envCodeActive: true });
  await throughAccount();
  expect(screen.getByRole('radio', { name: /Invite code/ }).checked).toBe(true);
  expect(screen.getByText(/REGISTRATION_MODE/)).toBeTruthy();
  expect(screen.getByText(/REGISTRATION_CODE/)).toBeTruthy();
});

test('if creating the server fails, the error shows here and you can retry or skip', async () => {
  await throughAccount();
  await submit('Continue');
  api.createSpace.mockRejectedValueOnce(new Error('Server name must be 60 characters or fewer'));
  type('Server name', 'Book Club');
  await submit('Create server');
  expect(screen.getByRole('alert').textContent).toBe('Server name must be 60 characters or fewer');
  expect(screen.getByText(/Step 3 of 4/)).toBeTruthy();

  await submit('Create server'); // retry works
  expect(screen.getByText(/Step 4 of 4/)).toBeTruthy();
});

test('skipping the server still finishes, without an invite', async () => {
  await throughAccount();
  await submit('Continue');
  await submit('Skip for now');
  expect(api.createSpace).not.toHaveBeenCalled();
  expect(screen.getByText(/Step 4 of 4/)).toBeTruthy();
  expect(api.createInvite).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Message for your friends')).toBeNull();
  expect(screen.getByRole('button', { name: 'Open DisGourd' })).toBeTruthy();
});

test('an account error stays on step 1', async () => {
  api.register.mockRejectedValueOnce(new Error('Password must be at least 8 characters'));
  render(<SetupWizard onAuthed={() => {}} />);
  type('Admin username', 'sandy');
  type('Email', 'sandy@example.test');
  type('Password', 'short');
  await submit('Create admin account');
  expect(screen.getByRole('alert').textContent).toBe('Password must be at least 8 characters');
  expect(screen.getByText(/Step 1 of 4/)).toBeTruthy();
});
