import { afterEach, expect, test, vi } from 'vitest';
import { createRef } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Modal from './Modal.jsx';
import InviteDialog from './InviteDialog.jsx';
import ChannelSettingsDialog from './ChannelSettingsDialog.jsx';
import ServerPermissionsDialog from './ServerPermissionsDialog.jsx';

afterEach(cleanup);

function Example({ onClose = () => {}, ...props }) {
  return (
    <Modal onClose={onClose} panelClassName="panel" {...props}>
      <Modal.Title>Settings</Modal.Title>
      <button>First</button>
      <input aria-label="Middle" />
      <button>Last</button>
    </Modal>
  );
}

test('is an accessible dialog named by its title', () => {
  render(<Example />);
  const dialog = screen.getByRole('dialog', { name: 'Settings' });
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  expect(dialog.className).toContain('panel');
});

test('renders outside the app (a portal on <body>)', () => {
  const { container } = render(<Example />);
  expect(container.querySelector('[role=dialog]')).toBeNull();
  expect(document.body.querySelector('[role=dialog]')).toBeTruthy();
});

test('focus starts on the first control, or on initialFocusRef', async () => {
  const { unmount } = render(<Example />);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' })));
  unmount();
  const ref = createRef();
  render(
    <Modal onClose={() => {}} initialFocusRef={ref}>
      <Modal.Title>T</Modal.Title>
      <button>Close</button>
      <input ref={ref} aria-label="Name" />
    </Modal>
  );
  await waitFor(() => expect(document.activeElement).toBe(ref.current));
});

test('Tab and Shift+Tab cycle inside the dialog', async () => {
  render(<Example />);
  const first = screen.getByRole('button', { name: 'First' });
  const last = screen.getByRole('button', { name: 'Last' });
  await waitFor(() => expect(document.activeElement).toBe(first));
  last.focus();
  fireEvent.keyDown(last, { key: 'Tab' });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(last);
});

test('Esc closes, unless something inside already handled it', () => {
  const onClose = vi.fn();
  render(
    <Modal onClose={onClose}>
      <Modal.Title>T</Modal.Title>
      <input aria-label="Key capture" onKeyDown={(e) => e.key === 'Escape' && e.preventDefault()} />
      <button>Other</button>
    </Modal>
  );
  fireEvent.keyDown(screen.getByLabelText('Key capture'), { key: 'Escape' });
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Other' }), { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('clicking the backdrop closes; clicking inside does not; closeOnBackdrop=false opts out', () => {
  const onClose = vi.fn();
  const { unmount } = render(<Example onClose={onClose} />);
  fireEvent.click(screen.getByRole('button', { name: 'First' }));
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId('modal-backdrop'));
  expect(onClose).toHaveBeenCalledTimes(1);
  unmount();
  const onClose2 = vi.fn();
  render(<Example onClose={onClose2} closeOnBackdrop={false} />);
  fireEvent.click(screen.getByTestId('modal-backdrop'));
  expect(onClose2).not.toHaveBeenCalled();
});

test('focus goes back to the opener, and page scroll is locked while open', async () => {
  const opener = document.createElement('button');
  document.body.appendChild(opener);
  opener.focus();
  const { unmount } = render(<Example />);
  expect(document.body.style.overflow).toBe('hidden');
  await waitFor(() => expect(document.activeElement).not.toBe(opener));
  unmount();
  expect(document.activeElement).toBe(opener);
  expect(document.body.style.overflow).toBe('');
  opener.remove();
});

// The three migrated dialogs.
test.each([
  ['Invite', () => <InviteDialog space="Tx Check" code="abc123" onClose={() => {}} />, 'Invite people to Tx Check'],
  ['Channel settings', () => <ChannelSettingsDialog space="S" channel="general" meta={{ type: 'text', view: 0, post: 1 }} onClose={() => {}} onSaved={() => {}} />, '#general settings'],
  ['Server permissions', () => <ServerPermissionsDialog space="S" permissions={{}} onClose={() => {}} onSaved={() => {}} />, 'Server permissions — S'],
])('%s dialog is a modal dialog with its title as the name', (_, make, name) => {
  render(make());
  expect(screen.getByRole('dialog', { name }).getAttribute('aria-modal')).toBe('true');
});
