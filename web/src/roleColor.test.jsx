// P2-21d: role colours stay readable (WCAG AA, 4.5:1) on every surface a
// name sits on, in both themes, and a member takes their highest coloured role.
import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, cleanup, within } from '@testing-library/react';
import { SURFACES, contrast, readableColor, memberColor, nameColors } from './roleColor.js';
import { ROLE_COLORS } from './components/RolesDialog.jsx';
import RoleName, { RoleColorsContext } from './components/RoleName.jsx';
import MemberList from './components/MemberList.jsx';

const css = readFileSync(resolve('src/index.css'), 'utf8');
const block = (re) => Object.fromEntries([...css.match(re)[1].matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()]));
const dark = block(/@theme\s*\{([\s\S]*?)\n\}/);
const light = { ...dark, ...block(/\[data-theme='light'\]\s*\{([\s\S]*?)\n\}/) };

test('the surfaces match index.css', () => {
  for (const [name, theme] of [['dark', dark], ['light', light]]) {
    expect(SURFACES[name].slice(0, 4)).toEqual(['ink-600', 'ink-700', 'ink-800', 'ink-900'].map((k) => theme[`color-${k}`]));
  }
});

const SAMPLES = [...ROLE_COLORS, '#000000', '#ffffff', '#ffff00', '#0000ff', '#ff0000', '#00ff00', '#7444f0'];
test.each(SAMPLES)('%s reads at 4.5:1 or better on every surface in both themes', (color) => {
  for (const theme of ['dark', 'light']) {
    const out = readableColor(color, theme);
    for (const s of SURFACES[theme]) expect(contrast(out, s)).toBeGreaterThanOrEqual(4.5);
  }
});

test('a colour that already reads well is left alone; a bad value gives null', () => {
  expect(readableColor('#FFC53D', 'dark')).toBe('#ffc53d');
  expect(readableColor('#1a1430', 'light')).toBe('#1a1430');
  expect(readableColor('#0000ff', 'dark')).not.toBe('#0000ff'); // too dark on dark
  expect(readableColor('red', 'dark')).toBeNull();
});

const roles = [
  { id: 5, name: 'Plain', color: null, position: 4, isDefault: false },
  { id: 4, name: 'Mods', color: '#0090ff', position: 3, isDefault: false },
  { id: 3, name: 'Helpers', color: '#46a758', position: 2, isDefault: false },
  { id: 1, name: '@everyone', color: null, position: 0, isDefault: true },
];

test('a member takes the colour of their highest coloured role', () => {
  expect(memberColor([3, 4, 5], roles)).toBe('#0090ff'); // Plain is higher but has no colour
  expect(memberColor([3], roles)).toBe('#46a758');
  expect(memberColor([5], roles)).toBeNull();
  expect(memberColor([], roles)).toBeNull();
  const map = nameColors([{ username: 'bob', roles: [4] }, { username: 'dee', roles: [] }], roles);
  expect(map.get('bob')).toEqual({ dark: readableColor('#0090ff', 'dark'), light: readableColor('#0090ff', 'light') });
  expect(map.has('dee')).toBe(false);
});

test('RoleName colours a name through the context, and leaves it plain without', () => {
  const colors = new Map([['bob', { dark: '#aabbcc', light: '#112233' }]]);
  render(
    <RoleColorsContext.Provider value={colors}>
      <RoleName name="bob" className="x" />
      <RoleName name="dee" className="x" />
    </RoleColorsContext.Provider>
  );
  const bob = screen.getByText('bob');
  expect(bob.className).toContain('role-name');
  expect(bob.style.getPropertyValue('--name-dark')).toBe('#aabbcc');
  expect(bob.style.getPropertyValue('--name-light')).toBe('#112233');
  expect(screen.getByText('dee').className).not.toContain('role-name');
  cleanup();
  render(<RoleName name="bob" />); // no provider (DMs): plain
  expect(screen.getByText('bob').className).not.toContain('role-name');
  cleanup();
});

test('the member list groups online members by highest role, then Online, then Offline', () => {
  const members = [
    { username: 'ann', role: 'owner', status: 'online', roles: [] },
    { username: 'bob', role: 'member', status: 'online', roles: [3, 4] },
    { username: 'cat', role: 'member', status: 'online', roles: [3] },
    { username: 'dan', role: 'member', status: 'offline', roles: [4] },
    { username: 'eve', role: 'member', status: 'online', roles: [5] },
  ];
  render(
    <RoleColorsContext.Provider value={nameColors(members, roles)}>
      <MemberList space="S" members={members} roles={roles} currentUser="ann" myRole="owner" onMessageUser={() => {}} onKick={() => {}} />
    </RoleColorsContext.Provider>
  );
  const list = screen.getByRole('complementary', { name: 'Members' });
  const headers = within(list).getAllByText(/ — \d+$/).map((h) => h.textContent);
  expect(headers).toEqual(['Members — 5', 'Plain — 1', 'Mods — 1', 'Helpers — 1', 'Online — 1', 'Offline — 1']);
  expect(within(list).getByText('bob').className).toContain('role-name'); // Mods' blue
  expect(within(list).getByText('eve').className).not.toContain('role-name'); // Plain has no colour
  cleanup();
});
