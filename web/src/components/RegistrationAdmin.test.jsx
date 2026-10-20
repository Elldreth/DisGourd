import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../api.js', () => ({
  getAdminRegistration: vi.fn(async () => ({ mode: 'code', maxAccounts: 0, envCodeActive: false, codes: [], admins: ['admin'], linkPreviews: true })),
  setLinkPreviews: vi.fn(async () => ({})),
  setRegistrationMode: vi.fn(),
  createRegCode: vi.fn(),
  revokeRegCode: vi.fn(),
  setSiteAdmin: vi.fn(),
}));
const api = await import('../api.js');
const { default: RegistrationAdmin } = await import('./RegistrationAdmin.jsx');

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

test('site admins can switch link previews off and back on', async () => {
  await act(async () => {
    render(<RegistrationAdmin />);
  });
  const box = screen.getByRole('switch', { name: /Link previews/ });
  expect(box.checked).toBe(true);
  await act(async () => {
    fireEvent.click(box);
  });
  expect(api.setLinkPreviews).toHaveBeenCalledWith(false);
  expect(box.checked).toBe(false);
});
