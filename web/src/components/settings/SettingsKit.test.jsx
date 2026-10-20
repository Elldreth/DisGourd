// P5-02: the settings kit every settings window uses.
import { afterEach, expect, test, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import Switch from './Switch.jsx';
import SettingRow from './SettingRow.jsx';
import SaveBar from './SaveBar.jsx';
import SettingsLayout from './SettingsLayout.jsx';

afterEach(cleanup);

test('Switch is a named switch that toggles on click and reports its state', () => {
  const onChange = vi.fn();
  function Harness() {
    const [on, setOn] = useState(false);
    return (
      <Switch
        label="Join/leave sounds"
        checked={on}
        onChange={(v) => {
          onChange(v);
          setOn(v);
        }}
      />
    );
  }
  render(<Harness />);
  const sw = screen.getByRole('switch', { name: 'Join/leave sounds' });
  expect(sw.checked).toBe(false);
  fireEvent.click(sw);
  expect(onChange).toHaveBeenLastCalledWith(true);
  expect(sw.checked).toBe(true);
});

test('a disabled Switch does not toggle', () => {
  const onChange = vi.fn();
  render(<Switch label="Push" checked={false} disabled onChange={onChange} />);
  const sw = screen.getByRole('switch', { name: 'Push' });
  expect(sw.disabled).toBe(true);
});

test('SettingRow shows a label and help text, and a click on the label reaches its switch', () => {
  const onChange = vi.fn();
  render(
    <SettingRow label="Message sounds" description="A chime for mentions and DMs.">
      <Switch label="Message sounds" checked={false} onChange={onChange} />
    </SettingRow>
  );
  expect(screen.getByText('A chime for mentions and DMs.')).toBeTruthy();
  fireEvent.click(screen.getByText('Message sounds'));
  expect(onChange).toHaveBeenCalledWith(true);
});

test('SaveBar appears only with unsaved changes, and its buttons call back', () => {
  const onSave = vi.fn();
  const onReset = vi.fn();
  const { rerender } = render(<SaveBar dirty={false} onSave={onSave} onReset={onReset} />);
  expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull();
  rerender(<SaveBar dirty onSave={onSave} onReset={onReset} />);
  const bar = screen.getByRole('region', { name: 'Unsaved changes' });
  fireEvent.click(within(bar).getByRole('button', { name: 'Reset' }));
  fireEvent.click(within(bar).getByRole('button', { name: 'Save changes' }));
  expect(onReset).toHaveBeenCalledTimes(1);
  expect(onSave).toHaveBeenCalledTimes(1);
  rerender(<SaveBar dirty saving onSave={onSave} onReset={onReset} />);
  expect(screen.getByRole('button', { name: 'Saving…' }).disabled).toBe(true);
});

const SECTIONS = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta' },
  { id: 'c', label: 'Gamma', group: 'Site admin' },
  { id: 'd', label: 'Delta', group: 'Site admin', indent: true },
];

function Layout(props) {
  const [section, setSection] = useState(props.initial || 'a');
  return (
    <SettingsLayout
      label="Settings sections"
      sections={SECTIONS}
      section={section}
      onSection={setSection}
      startOnPage={props.startOnPage}
      history={false}
      renderSection={(id) => <p>content {id}</p>}
    />
  );
}

test('SettingsLayout: one tab per section with group labels; only the chosen panel shows; the panel has its heading', () => {
  render(<Layout />);
  const list = screen.getByRole('tablist', { name: 'Settings sections' });
  expect(within(list).getAllByRole('tab').map((t) => t.textContent.trim())).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta']);
  expect(within(list).getByText('Site admin')).toBeTruthy();
  const panel = screen.getByRole('tabpanel');
  expect(within(panel).getByRole('heading', { name: 'Alpha' })).toBeTruthy();
  expect(screen.getByText('content b', { selector: 'p' }).closest('[role=tabpanel]').hidden).toBe(true); // mounted while hidden
  fireEvent.click(screen.getByRole('tab', { name: 'Beta' }));
  expect(screen.getByText('content b').closest('[role=tabpanel]').hidden).toBe(false);
  expect(screen.getByText('content a').closest('[role=tabpanel]').hidden).toBe(true);
});

test('SettingsLayout: arrows, Home and End move between tabs; Enter focuses the panel', () => {
  render(<Layout />);
  const tabs = screen.getAllByRole('tab');
  tabs[0].focus();
  fireEvent.keyDown(tabs[0], { key: 'ArrowDown' });
  expect(document.activeElement).toBe(tabs[1]);
  expect(tabs[1].getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(tabs[1], { key: 'End' });
  expect(document.activeElement).toBe(tabs[3]);
  fireEvent.keyDown(tabs[3], { key: 'ArrowDown' });
  expect(document.activeElement).toBe(tabs[0]);
  fireEvent.keyDown(tabs[0], { key: 'Enter' });
  expect(document.activeElement.getAttribute('role')).toBe('tabpanel');
});

test('SettingsLayout on phones: the list first, a page with a Back button, Back returns to the list', () => {
  const { container } = render(<Layout />);
  const root = container.firstChild;
  expect(root.getAttribute('data-view')).toBe('list');
  fireEvent.click(screen.getByRole('tab', { name: 'Gamma' }));
  expect(root.getAttribute('data-view')).toBe('page');
  fireEvent.click(screen.getByRole('button', { name: 'Back to all settings' }));
  expect(root.getAttribute('data-view')).toBe('list');
  // A deep link opens straight on its page.
  cleanup();
  const deep = render(<Layout initial="b" startOnPage />);
  expect(deep.container.firstChild.getAttribute('data-view')).toBe('page');
});

test('SettingsLayout: indented items are marked as a sub-list', () => {
  render(<Layout />);
  expect(screen.getByRole('tab', { name: 'Delta' }).className).toMatch(/\bpl-6\b/);
});
