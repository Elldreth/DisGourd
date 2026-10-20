import { afterEach, expect, test, vi } from 'vitest';
import { createRef, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Modal from './Modal.jsx';
import InviteDialog from './InviteDialog.jsx';
import ChannelSettingsDialog from './ChannelSettingsDialog.jsx';
import ServerSettingsDialog from './server-settings/ServerSettingsDialog.jsx';

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
  ['Server settings', () => <ServerSettingsDialog space="S" can={{ roles: true }} roles={{ roles: [], members: [], currentUser: 'me', isOwner: true, myPosition: 1e9, abilities: [] }} onClose={() => {}} />, 'Server settings'],
])('%s dialog is a modal dialog with its title as the name', (_, make, name) => {
  render(make());
  expect(screen.getByRole('dialog', { name }).getAttribute('aria-modal')).toBe('true');
});

// ---- P3-02: options for the remaining overlays, and nesting ----

test('a dialog with no visible heading can be named with `label`', () => {
  render(
    <Modal onClose={() => {}} label="Image viewer" backdropClassName="bg-black/90">
      <button>Close</button>
    </Modal>
  );
  const dialog = screen.getByRole('dialog', { name: 'Image viewer' });
  expect(screen.getByTestId('modal-backdrop').className).toContain('bg-black/90');
  expect(dialog.getAttribute('aria-labelledby')).toBeNull();
});

test('a key a control already handled (like a key-capture field) is left alone, Tab included', () => {
  const onClose = vi.fn();
  render(
    <Modal onClose={onClose}>
      <Modal.Title>T</Modal.Title>
      <button>Only</button>
    </Modal>
  );
  // Like AudioSettings while recording a push-to-talk key: a capture-phase
  // window listener swallows every key.
  const swallow = (e) => e.preventDefault();
  window.addEventListener('keydown', swallow, true);
  const only = screen.getByRole('button', { name: 'Only' });
  only.focus();
  fireEvent.keyDown(only, { key: 'Escape' });
  fireEvent.keyDown(only, { key: 'Tab' });
  window.removeEventListener('keydown', swallow, true);
  expect(onClose).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(only);
});

test('nested: Esc closes only the top dialog, and focus returns into the one below', async () => {
  const outerClose = vi.fn();
  function Outer() {
    const [inner, setInner] = useState(false);
    return (
      <Modal onClose={outerClose}>
        <Modal.Title>Settings</Modal.Title>
        <button onClick={() => setInner(true)}>Change avatar</button>
        {inner && (
          <Modal onClose={() => setInner(false)}>
            <Modal.Title>Crop</Modal.Title>
            <button>Zoom</button>
          </Modal>
        )}
      </Modal>
    );
  }
  render(<Outer />);
  const opener = screen.getByRole('button', { name: 'Change avatar' });
  opener.focus();
  fireEvent.click(opener);
  const zoom = await screen.findByRole('button', { name: 'Zoom' });
  await waitFor(() => expect(document.activeElement).toBe(zoom));
  // Tab stays in the top dialog.
  fireEvent.keyDown(zoom, { key: 'Tab' });
  expect(document.activeElement).toBe(zoom);
  fireEvent.keyDown(zoom, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Crop' })).toBeNull();
  expect(outerClose).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog', { name: 'Settings' }).contains(document.activeElement)).toBe(true);
});

test('clicking the backdrop of a nested dialog closes only that one', () => {
  const outerClose = vi.fn();
  const innerClose = vi.fn();
  render(
    <Modal onClose={outerClose}>
      <Modal.Title>Outer</Modal.Title>
      <Modal onClose={innerClose}>
        <Modal.Title>Inner</Modal.Title>
        <button>x</button>
      </Modal>
    </Modal>
  );
  const innerBackdrop = screen.getByRole('dialog', { name: 'Inner' }).parentElement;
  fireEvent.click(innerBackdrop);
  expect(innerClose).toHaveBeenCalledTimes(1);
  expect(outerClose).not.toHaveBeenCalled();
});

test('`fill`: the panel covers the screen and a click on its empty area closes', () => {
  const onClose = vi.fn();
  render(
    <Modal onClose={onClose} label="Viewer" fill>
      <img alt="cat" src="cat.png" />
    </Modal>
  );
  fireEvent.click(screen.getByAltText('cat'));
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('dialog', { name: 'Viewer' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});
