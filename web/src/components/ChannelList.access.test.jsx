import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

// P3-18: the channel list's shield follows the role overrides (`private` /
// `readOnly` in channelMeta), not the legacy view/post tier columns.

vi.mock('../api.js', () => ({ getMessages: vi.fn() }));

const { default: ChannelList } = await import('./ChannelList.jsx');

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

const list = (channelMeta) =>
  render(
    <ChannelList space="S" channels={['general', 'secret', 'news', 'legacy']} currentChannel="general" channelMeta={channelMeta} voiceChannels={[]} voiceParticipants={{}} activeVoiceParticipants={[]} user="sandy" status="open" selfId={1} onSelect={() => {}} />
  );
const shieldOf = (container, name) => {
  const row = [...container.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(name));
  return row.querySelector('span[title]');
};

test('private and read-only channels get a shield titled to match; plain ones none', () => {
  const { container } = list({
    general: { type: 'text', view: 1, post: 1, private: false, readOnly: false },
    secret: { type: 'text', view: 1, post: 1, private: true, readOnly: false },
    news: { type: 'text', view: 1, post: 1, private: false, readOnly: true },
    legacy: { type: 'text', view: 1, post: 1 },
  });
  expect(shieldOf(container, 'general')).toBeNull();
  expect(shieldOf(container, 'secret').getAttribute('title')).toBe('Private');
  expect(shieldOf(container, 'news').getAttribute('title')).toBe('Read-only');
});

test('the old tier columns alone no longer show a shield', () => {
  const { container } = list({
    general: { type: 'text', view: 1, post: 1, private: false, readOnly: false },
    legacy: { type: 'text', view: 2, post: 3, private: false, readOnly: false },
  });
  expect(shieldOf(container, 'legacy')).toBeNull();
});
