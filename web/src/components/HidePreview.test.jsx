// P3-20c: the × on a link card — shown to the author (and, in channels, to
// anyone who may delete the message), and it asks to remove the cards.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import Embed from './Embed.jsx';
import MessageList from './MessageList.jsx';

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

const card = { url: 'https://example.com/a', title: 'An article', siteName: 'Example' };
const msg = (id, author) => ({ id, author, content: `see https://example.com/a (${id})`, timestamp: 1700000000000 + id * 60000, reactions: [], embeds: [card] });

test('a card has no remove button unless onHide is given; the button calls it', () => {
  render(<Embed embed={card} />);
  expect(screen.queryByRole('button', { name: 'Remove preview' })).toBeNull();
  cleanup();
  const onHide = vi.fn();
  render(<Embed embed={card} onHide={onHide} />);
  fireEvent.click(screen.getByRole('button', { name: 'Remove preview' }));
  expect(onHide).toHaveBeenCalledTimes(1);
});

test('in a channel: on your own messages, and on others’ only when you may moderate them', () => {
  const onHidePreview = vi.fn();
  const messages = [msg(1, 'sandy'), msg(2, 'bob'), msg(3, 'cara')];
  render(
    <MessageList messages={messages} channel="general" currentUser="sandy" onDelete={() => {}} onHidePreview={onHidePreview} canModerate={(author) => author === 'bob'} />
  );
  const rows = screen.getAllByRole('article').filter((a) => a.hasAttribute('data-msg-row'));
  expect(within(rows[0]).getByRole('button', { name: 'Remove preview' })).toBeTruthy(); // mine
  expect(within(rows[1]).getByRole('button', { name: 'Remove preview' })).toBeTruthy(); // bob: I may moderate
  expect(within(rows[2]).queryByRole('button', { name: 'Remove preview' })).toBeNull(); // cara: no
  fireEvent.click(within(rows[1]).getByRole('button', { name: 'Remove preview' }));
  expect(onHidePreview).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
});

test('in a DM (no moderation): only on your own messages', () => {
  render(<MessageList messages={[msg(1, 'sandy'), msg(2, 'bob')]} currentUser="sandy" simple onHidePreview={() => {}} />);
  const rows = screen.getAllByRole('article').filter((a) => a.hasAttribute('data-msg-row'));
  expect(within(rows[0]).getByRole('button', { name: 'Remove preview' })).toBeTruthy();
  expect(within(rows[1]).queryByRole('button', { name: 'Remove preview' })).toBeNull();
});
