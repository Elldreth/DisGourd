// P9-02: Server settings › Overview › Transfer ownership… — the owner picks a
// member, types the server's name, and hands it over.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../api.js', () => ({ transferServer: vi.fn(async () => ({ owner: 'bob', yourRole: 'Admin' })) }));
const api = await import('../api.js');
const { default: OverviewSection } = await import('./server-settings/OverviewSection.jsx');
const { describeEntry } = await import('./server-settings/ModLogSection.jsx');

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const members = [{ username: 'sandy' }, { username: 'bob' }, { username: 'cara' }, { username: 'Imagine', bot: true }];
function overview(props = {}) {
  return render(<OverviewSection space="Tx" canEdit isOwner members={members} currentUser="sandy" onRename={() => {}} onDelete={() => {}} {...props} />);
}
const openDialog = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Transfer ownership…' }));
  return screen.getByRole('dialog', { name: 'Transfer ownership of Tx' });
};

test('only the owner sees Transfer ownership…, in the danger zone', () => {
  overview({ isOwner: false });
  expect(screen.queryByRole('button', { name: 'Transfer ownership…' })).toBeNull();
  cleanup();
  overview();
  const zone = screen.getByRole('region', { name: 'Danger zone' });
  expect(within(zone).getByRole('button', { name: 'Transfer ownership…' })).toBeTruthy();
});

test('the picker lists other members (not me, not the bot) and searches', () => {
  overview();
  const dialog = openDialog();
  const group = within(dialog).getByRole('radiogroup', { name: 'New owner' });
  expect(within(group).getAllByRole('radio').map((r) => r.value)).toEqual(['bob', 'cara']);
  fireEvent.change(within(dialog).getByPlaceholderText('Search members'), { target: { value: 'CA' } });
  expect(within(group).getAllByRole('radio').map((r) => r.value)).toEqual(['cara']);
  fireEvent.change(within(dialog).getByPlaceholderText('Search members'), { target: { value: 'zz' } });
  expect(within(group).getByText('No members match.')).toBeTruthy();
});

test('Transfer needs a member and the exact server name; then it hands over and reports back', async () => {
  const onTransferred = vi.fn();
  overview({ onTransferred });
  const dialog = openDialog();
  const go = () => within(dialog).getByRole('button', { name: /^Transfer/ });
  expect(go().disabled).toBe(true);
  fireEvent.click(within(dialog).getByRole('radio', { name: 'bob' }));
  expect(go().textContent).toBe('Transfer to bob');
  fireEvent.change(within(dialog).getByLabelText(/to confirm/), { target: { value: 'tx' } });
  expect(go().disabled).toBe(true);
  fireEvent.change(within(dialog).getByLabelText(/to confirm/), { target: { value: 'Tx' } });
  expect(go().disabled).toBe(false);
  fireEvent.click(go());
  await waitFor(() => expect(api.transferServer).toHaveBeenCalledWith('Tx', 'bob', 'Tx'));
  await waitFor(() => expect(onTransferred).toHaveBeenCalledWith('bob'));
  expect(screen.queryByRole('dialog', { name: 'Transfer ownership of Tx' })).toBeNull();
});

test("the server's refusal shows in the dialog", async () => {
  api.transferServer.mockRejectedValueOnce(new Error('Member not found'));
  overview();
  const dialog = openDialog();
  fireEvent.click(within(dialog).getByRole('radio', { name: 'cara' }));
  fireEvent.change(within(dialog).getByLabelText(/to confirm/), { target: { value: 'Tx' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Transfer to cara' }));
  expect((await within(dialog).findByRole('alert')).textContent).toBe('Member not found');
});

test('the moderation log says who handed the server to whom', () => {
  const { container } = render(<div>{describeEntry({ action: 'ownership_transfer', actor: 'sandy', target: 'bob', details: { role: 'Admin' } })}</div>);
  expect(container.textContent).toBe('sandy handed the server to bob');
});
