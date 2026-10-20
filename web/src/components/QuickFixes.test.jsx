// P5-01: the member menu closes on Esc and on a click outside it, and
// pictures in messages are never wider than their column.
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import MemberList from './MemberList.jsx';
import Album from './Album.jsx';
import Attachment from './Attachment.jsx';

afterEach(cleanup);

const members = [
  { username: 'sandy', online: true, role: 'owner' },
  { username: 'bob', online: true, role: 'member' },
];

function setup(props = {}) {
  const onClose = vi.fn();
  render(
    <>
      <MemberList members={members} currentUser="sandy" myRole="owner" canKickMembers myPosition={1e9} onMessageUser={() => {}} onToggleRole={() => {}} onKick={() => {}} onClose={onClose} {...props} />
      <button type="button">elsewhere</button>
    </>
  );
  return { onClose };
}

const bobRow = () => screen.getAllByText('bob')[0].closest('button'); // the row (the open menu's header names bob too)
const menuOpen = () => screen.queryByRole('button', { name: 'Message' }) !== null;

test('Esc closes the member menu and puts focus back on the member', () => {
  setup();
  fireEvent.click(bobRow());
  expect(menuOpen()).toBe(true);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Message' }), { key: 'Escape' });
  expect(menuOpen()).toBe(false);
  expect(document.activeElement).toBe(bobRow());
});

test('on a phone, Esc closes only the menu, not the member drawer', () => {
  const { onClose } = setup({ open: true });
  fireEvent.click(bobRow());
  fireEvent.keyDown(document.activeElement || document, { key: 'Escape' });
  expect(menuOpen()).toBe(false);
  expect(onClose).not.toHaveBeenCalled();
  // A second Esc, with no menu open, closes the drawer as before.
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('a click outside closes the member menu; a click inside it does not', () => {
  setup();
  fireEvent.click(bobRow());
  fireEvent.mouseDown(screen.getByRole('button', { name: 'Message' }));
  expect(menuOpen()).toBe(true);
  fireEvent.mouseDown(screen.getByRole('button', { name: 'elsewhere' }));
  expect(menuOpen()).toBe(false);
});

test('clicking the member again still toggles the menu closed', () => {
  setup();
  fireEvent.mouseDown(bobRow());
  fireEvent.click(bobRow());
  fireEvent.mouseDown(bobRow());
  fireEvent.click(bobRow());
  expect(menuOpen()).toBe(false);
});

// jsdom has no layout, so this checks the cap itself: 448 px or the column,
// whichever is smaller (the sandbox check measures the real overflow).
const fitsColumn = (el) => expect(el.className).toMatch(/max-w-\[min\(28rem,100%\)\]/);

test('a single picture or video is capped at the column width', () => {
  const { container } = render(<Album items={['/uploads/a.png']} />);
  fitsColumn(container.querySelector('img'));
  cleanup();
  const v = render(<Album items={['/uploads/a.mp4']} />);
  fitsColumn(v.container.querySelector('video'));
});

test('a picture grid is capped at the column width', () => {
  const { container } = render(<Album items={['/uploads/a.png', '/uploads/b.png']} />);
  fitsColumn(container.querySelector('.grid'));
});

test('a spoiler picture and a file card are capped at the column width', () => {
  const { container } = render(<Attachment url="/uploads/a.png" spoiler />);
  fitsColumn(container.querySelector('img'));
  cleanup();
  const f = render(<Attachment url="/uploads/notes.pdf" />);
  fitsColumn(f.container.querySelector('a'));
});
