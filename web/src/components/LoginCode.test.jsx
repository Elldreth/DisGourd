// The registration code field must survive a phone keyboard: no capitals,
// autocorrect or spell-check on a case-sensitive code.
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../api.js', () => ({
  getAuthInfo: vi.fn(async () => ({ registration: 'code' })),
  register: vi.fn(),
  login: vi.fn(),
  setToken: vi.fn(),
}));
const { default: Login } = await import('./Login.jsx');

afterEach(cleanup);

test('the registration code field turns off auto-capitalise, autocorrect and spell-check', async () => {
  render(<Login onAuthed={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /create an account|sign up|register/i }));
  const field = await screen.findByPlaceholderText('Enter the code you were given');
  expect(field.getAttribute('autocapitalize')).toBe('none');
  expect(field.getAttribute('autocorrect')).toBe('off');
  expect(field.getAttribute('spellcheck')).toBe('false');
  expect(field.getAttribute('autocomplete')).toBe('off');
});
